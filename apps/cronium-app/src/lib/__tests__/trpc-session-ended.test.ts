/**
 * @jest-environment node
 *
 * What a person reads when Cronium refuses a call because their session has gone. The
 * client, the tRPC route, tRPC's adapter and the checks on `protectedProcedure` are all
 * real. The database is mocked at the driver boundary, and `currentSession` is what
 * next-auth makes of the cookie: an expired, tampered or missing one all come to `null`.
 *
 * `UNAUTHORIZED` also covers failures that signing in again wouldn't fix, so these hold
 * both sides, and that the answer on the wire stays as it was for callers that aren't
 * this page. tests/superjson-stub.ts has the same `{ json }` wrapper as the real format.
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

// No token is valid here, and the lookup is all that needs a database.
jest.mock("@/lib/api-auth", () => ({
  getBearerToken: (headers: Headers) =>
    headers.get("authorization")?.replace("Bearer ", "") ?? null,
  authenticateApiToken: jest.fn(() => Promise.resolve(null)),
}));

jest.mock("@server/api/root", () => {
  const { TRPCError } =
    jest.requireActual<typeof import("@trpc/server")>("@trpc/server");
  const { createTRPCRouter, protectedProcedure, publicProcedure } =
    jest.requireActual<typeof import("@server/api/trpc")>("@server/api/trpc");
  return {
    appRouter: createTRPCRouter({
      events: createTRPCRouter({
        create: protectedProcedure.mutation(() => "created"),
        getAll: protectedProcedure.query(() => ["one"]),
        getById: protectedProcedure.query(() => "one"),
      }),
      // Past or apart from the session checks, and failing as it's told to.
      userAuth: createTRPCRouter({
        login: publicProcedure
          .input(
            (input: unknown) =>
              input as { code: "NOT_FOUND"; message?: string },
          )
          .mutation(({ input }) => {
            throw new TRPCError(input);
          }),
      }),
    }),
  };
});

import { TRPCClientError } from "@trpc/client";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/trpc/[trpc]/route";
import {
  SESSION_ENDED_MESSAGE,
  SESSION_REVOKED_MESSAGE,
  trpcClient,
} from "@/lib/trpc";
import { UserRole, UserStatus } from "@/shared/schema";

const realFetch = global.fetch;

/** Sends every call to the real route, and keeps what it answers. */
function reachingCronium(): Response[] {
  const answered: Response[] = [];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = init?.method === "GET" ? GET : POST;
      const response = await route(
        new NextRequest(
          new URL(String(input), "http://localhost:5001"),
          init as ConstructorParameters<typeof NextRequest>[1],
        ),
      );
      answered.push(response);
      return response;
    },
  ) as unknown as typeof fetch;
  return answered;
}

async function failureOf(
  call: Promise<unknown>,
): Promise<TRPCClientError<never>> {
  const error: unknown = await call.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(TRPCClientError);
  return error as TRPCClientError<never>;
}

const signedInAs = (claims: Record<string, unknown> = {}) => ({
  user: {
    id: "user-1",
    email: "user@example.com",
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    sessionVersion: 1,
    ...claims,
  },
  expires: new Date(Date.now() + 60_000).toISOString(),
});

const userRow = (columns: Record<string, unknown> = {}) => ({
  id: "user-1",
  role: UserRole.USER,
  roleId: 2,
  status: UserStatus.ACTIVE,
  sessionVersion: 1,
  mfaEnabled: false,
  ...columns,
});

beforeEach(() => {
  currentSession = signedInAs();
  dbState.rows = [userRow()];
  dbState.error = null;
  reachingCronium();
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("a session that has gone", () => {
  const ended: Array<[string, () => void, string]> = [
    [
      "an expired, tampered or missing cookie",
      () => {
        currentSession = null;
      },
      SESSION_ENDED_MESSAGE,
    ],
    [
      "a session from before sessionVersion",
      () => {
        currentSession = signedInAs({ sessionVersion: undefined });
      },
      SESSION_REVOKED_MESSAGE,
    ],
    [
      "a session a password or role change has revoked",
      () => {
        currentSession = signedInAs({ sessionVersion: 1 });
        dbState.rows = [userRow({ sessionVersion: 2 })];
      },
      SESSION_REVOKED_MESSAGE,
    ],
  ];

  it.each(ended)("%s says so on a save", async (_name, arrange, message) => {
    arrange();

    const error = await failureOf(trpcClient.events.create.mutate({} as never));

    expect(error.message).toBe(message);
    expect(error.data).toMatchObject({
      code: "UNAUTHORIZED",
      httpStatus: 401,
    });
  });

  it.each(ended)("%s says so on a read", async (_name, arrange, message) => {
    arrange();

    const error = await failureOf(trpcClient.events.getAll.query({} as never));

    expect(error.message).toBe(message);
    expect(error.data).toMatchObject({
      code: "UNAUTHORIZED",
      httpStatus: 401,
    });
  });

  it("says so for each call in a batch", async () => {
    const answered = reachingCronium();
    currentSession = null;

    const failures = await Promise.allSettled([
      trpcClient.events.getAll.query({} as never),
      trpcClient.events.getById.query({} as never),
    ]);

    expect(answered.map((response) => response.status)).toEqual([401]);
    expect(failures).toMatchObject([
      { status: "rejected", reason: { message: SESSION_ENDED_MESSAGE } },
      { status: "rejected", reason: { message: SESSION_ENDED_MESSAGE } },
    ]);
  });

  it("works again once the session is back, from the same page", async () => {
    currentSession = null;
    await failureOf(trpcClient.events.create.mutate({} as never));

    currentSession = signedInAs();

    await expect(trpcClient.events.create.mutate({} as never)).resolves.toBe(
      "created",
    );
  });
});

describe("a refusal signing in again wouldn't fix", () => {
  it.each<[string, () => void, string]>([
    [
      "a disabled account",
      () => {
        dbState.rows = [userRow({ status: UserStatus.DISABLED })];
      },
      "Account is not active",
    ],
    [
      "a deleted account",
      () => {
        dbState.rows = [];
      },
      "Account no longer exists",
    ],
    [
      "a database it can't reach",
      () => {
        dbState.error = new Error("database unreachable");
      },
      "Unable to verify account status",
    ],
  ])("%s keeps its own message", async (_name, arrange, message) => {
    arrange();

    const error = await failureOf(trpcClient.events.create.mutate({} as never));

    expect(error.message).toBe(message);
    expect(error.data).toMatchObject({ code: "UNAUTHORIZED", httpStatus: 401 });
  });

  it.each([
    "Invalid username/email or password",
    "Your current password is incorrect.",
    // What withErrorHandling makes of the Anthropic SDK's error for a key it refuses.
    'Failed to generate code: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    "Not authenticated",
  ])("UNAUTHORIZED saying %s keeps it", async (message) => {
    const error = await failureOf(
      trpcClient.userAuth.login.mutate({
        code: "UNAUTHORIZED",
        message,
      } as never),
    );

    expect(error.message).toBe(message);
    expect(error.data).toMatchObject({ code: "UNAUTHORIZED", httpStatus: 401 });
  });

  it.each([
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["TOO_MANY_REQUESTS", 429],
  ])("%s with no message of its own stays that", async (code, httpStatus) => {
    const error = await failureOf(
      trpcClient.userAuth.login.mutate({ code } as never),
    );

    expect(error.message).toBe(code);
    expect(error.data).toMatchObject({ code, httpStatus });
  });
});

describe("a caller that isn't this page", () => {
  const callRoute = (headers: Record<string, string>) =>
    POST(
      new NextRequest("http://localhost:5001/api/trpc/events.create", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ json: {} }),
      }),
    );

  it.each<[string, Record<string, string>]>([
    ["a token that isn't valid", { authorization: "Bearer not-a-real-token" }],
    ["no credentials at all", {}],
  ])("gets the server's answer as it was, with %s", async (_name, headers) => {
    currentSession = null;

    const response = await callRoute(headers);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: {
        json: {
          message: "UNAUTHORIZED",
          data: { code: "UNAUTHORIZED", httpStatus: 401 },
        },
      },
    });
  });
});
