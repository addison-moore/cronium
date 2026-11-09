/**
 * @jest-environment node
 *
 * What a tRPC caller gets when its credentials couldn't be checked, as against being bad. The
 * route, tRPC's adapter, the context, `authenticateApiToken` and the checks on
 * `protectedProcedure` are all real. Storage and the database are mocked at their boundary,
 * failing with the wrapped error Drizzle really throws.
 */
const dbState: {
  rows: Array<Record<string, unknown>>;
  error: Error | null;
} = { rows: [], error: null };

let currentSession: unknown = null;

jest.mock("@/env.mjs", () => ({ env: { NODE_ENV: "test" } }));

jest.mock("@/server/db", () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() =>
            dbState.error
              ? Promise.reject(dbState.error)
              : Promise.resolve(dbState.rows),
          ),
        })),
      })),
    })),
  },
}));

jest.mock("@/server/storage", () => ({
  storage: {
    getApiTokenByToken: jest.fn(),
    updateApiToken: jest.fn(() => Promise.resolve()),
    getUser: jest.fn(),
  },
}));

jest.mock("@/lib/cache/cache-service", () => ({
  cacheService: {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve(true)),
    delete: jest.fn(() => Promise.resolve(true)),
  },
}));

jest.mock("@/lib/auth-cache", () => ({
  getCachedServerSession: jest.fn(() => Promise.resolve(currentSession)),
}));

jest.mock("@/lib/rate-limit-service", () => ({
  RateLimitService: { checkLimit: jest.fn(() => Promise.resolve()) },
}));

jest.mock("@server/api/root", () => {
  const { createTRPCRouter, protectedProcedure, publicProcedure } =
    jest.requireActual<typeof import("@server/api/trpc")>("@server/api/trpc");
  return {
    appRouter: createTRPCRouter({
      events: createTRPCRouter({
        getAll: protectedProcedure.query(() => ["one"]),
      }),
      staticResources: createTRPCRouter({
        getSystemConstants: publicProcedure.query(() => ({ maxRetries: 3 })),
      }),
    }),
  };
});

import { DrizzleQueryError } from "drizzle-orm/errors";
import { NextRequest } from "next/server";
import { GET } from "../[trpc]/route";
import { storage } from "@/server/storage";
import { CREDENTIAL_CHECK_FAILED_MESSAGE } from "@/server/security/credential-check";
import { TokenStatus, UserRole, UserStatus } from "@/shared/schema";

const getToken = storage.getApiTokenByToken as jest.Mock;
const getUser = storage.getUser as jest.Mock;

const databaseDown = () =>
  new DrizzleQueryError(
    "select 1",
    ["a-bound-value"],
    new Error("ECONNREFUSED"),
  );

const goodToken = {
  id: 7,
  userId: "user-1",
  status: TokenStatus.ACTIVE,
  expiresAt: null,
  scopes: ["full"],
};
const owner = {
  id: "user-1",
  email: "user@example.com",
  role: UserRole.USER,
  status: UserStatus.ACTIVE,
  sessionVersion: 1,
};
const liveRow = {
  id: "user-1",
  role: UserRole.USER,
  roleId: 2,
  status: UserStatus.ACTIVE,
  sessionVersion: 1,
  mfaEnabled: false,
};

const call = (path: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost:5001/api/trpc/${path}`, { headers }));

const withToken = { authorization: "Bearer a-token" };

interface TrpcFailure {
  error: {
    json: { message: string; data: { code: string; httpStatus: number } };
  };
}

async function failure(response: Response) {
  const { error } = (await response.json()) as TrpcFailure;
  return { status: response.status, ...error.json };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  currentSession = null;
  dbState.rows = [liveRow];
  dbState.error = null;
  getToken.mockReset().mockResolvedValue(goodToken);
  getUser.mockReset().mockResolvedValue(owner);
});

afterEach(() => jest.restoreAllMocks());

describe("a good token", () => {
  it("reaches the procedure, as a control for everything below", async () => {
    const response = await call("events.getAll", withToken);

    expect(response.status).toBe(200);
  });
});

describe("a token that couldn't be checked", () => {
  const SERVICE_UNAVAILABLE = {
    status: 503,
    message: CREDENTIAL_CHECK_FAILED_MESSAGE,
    data: { code: "SERVICE_UNAVAILABLE", httpStatus: 503 },
  };

  it.each<[string, () => void]>([
    ["the token's lookup", () => getToken.mockRejectedValue(databaseDown())],
    ["its owner's lookup", () => getUser.mockRejectedValue(databaseDown())],
    [
      "the live check on its account",
      () => {
        dbState.error = databaseDown();
      },
    ],
  ])("is a 503 when %s fails", async (_name, arrange) => {
    arrange();

    const answer = await failure(await call("events.getAll", withToken));

    expect(answer).toMatchObject(SERVICE_UNAVAILABLE);
  });

  it("logs why, without the query's values", async () => {
    getToken.mockRejectedValue(databaseDown());

    await call("events.getAll", withToken);

    const logged = (console.error as jest.Mock).mock.calls.flat().join(" ");
    expect(logged).toContain("Error validating API token");
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).not.toContain("a-bound-value");
  });

  it("doesn't stop a public procedure, which never reads the session", async () => {
    getToken.mockRejectedValue(databaseDown());

    const response = await call(
      "staticResources.getSystemConstants",
      withToken,
    );

    expect(response.status).toBe(200);
  });

  it("gives each call in a batch its own answer", async () => {
    getToken.mockRejectedValue(databaseDown());

    const response = await call(
      "staticResources.getSystemConstants,events.getAll?batch=1&input=%7B%7D",
      withToken,
    );

    expect(response.status).toBe(207);
    const [open, closed] = (await response.json()) as [
      { result: unknown },
      TrpcFailure,
    ];
    expect(open.result).toBeDefined();
    expect(closed.error.json.data.code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("a token that was checked", () => {
  const UNAUTHORIZED = {
    status: 401,
    message: "UNAUTHORIZED",
    data: { code: "UNAUTHORIZED", httpStatus: 401 },
  };

  it.each<[string, unknown]>([
    ["unknown", undefined],
    ["revoked", { ...goodToken, status: TokenStatus.REVOKED }],
    ["expired", { ...goodToken, expiresAt: new Date(Date.now() - 1000) }],
  ])("is still a 401 when %s", async (_name, row) => {
    getToken.mockResolvedValue(row);

    const answer = await failure(await call("events.getAll", withToken));

    expect(answer).toMatchObject(UNAUTHORIZED);
  });

  it("is still a 401 when its owner is disabled", async () => {
    getUser.mockResolvedValue({ ...owner, status: UserStatus.DISABLED });

    const answer = await failure(await call("events.getAll", withToken));

    expect(answer).toMatchObject(UNAUTHORIZED);
  });

  it("is still a 401 when the live check finds its owner disabled", async () => {
    dbState.rows = [{ ...liveRow, status: UserStatus.DISABLED }];

    const answer = await failure(await call("events.getAll", withToken));

    expect(answer).toMatchObject({
      status: 401,
      message: "Account is not active",
    });
  });
});

describe("a cookie session", () => {
  it("keeps its answer when the live check fails: only this app's pages read it", async () => {
    currentSession = {
      user: { ...owner },
      expires: new Date(Date.now() + 60_000).toISOString(),
    };
    dbState.error = databaseDown();

    const answer = await failure(await call("events.getAll"));

    expect(answer).toMatchObject({
      status: 401,
      message: "Unable to verify account status",
      data: { code: "UNAUTHORIZED", httpStatus: 401 },
    });
  });

  it("isn't affected by a token it doesn't need checked", async () => {
    currentSession = {
      user: { ...owner },
      expires: new Date(Date.now() + 60_000).toISOString(),
    };
    getToken.mockRejectedValue(databaseDown());

    const response = await call("events.getAll", withToken);

    expect(response.status).toBe(200);
    expect(getToken).not.toHaveBeenCalled();
  });
});

describe("no credentials at all", () => {
  it("is a 401 whatever the database is doing", async () => {
    getToken.mockRejectedValue(databaseDown());

    const answer = await failure(await call("events.getAll"));

    expect(answer).toMatchObject({ status: 401, message: "UNAUTHORIZED" });
  });
});
