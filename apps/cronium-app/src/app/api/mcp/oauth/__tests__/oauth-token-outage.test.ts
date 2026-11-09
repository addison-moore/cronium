/**
 * @jest-environment node
 *
 * What the token endpoint does when it can't read a grant's owner, without loosening single
 * use to get there. This runs the real route and store on a stand-in for Valkey. The same
 * things on real Postgres and Valkey, and GETDEL under real concurrency, are in
 * tests/storage/oauth-token-outage.test.ts.
 */
process.env.AUTH_SECRET = "test-auth-secret-for-mcp-oauth";

jest.mock("@/lib/cache/cache-service", () => {
  const entries = new Map<string, unknown>();
  return {
    __entries: entries,
    cacheService: {
      get: jest.fn((key: string) => Promise.resolve(entries.get(key) ?? null)),
      set: jest.fn((key: string, value: unknown) => {
        entries.set(key, value);
        return Promise.resolve(true);
      }),
      getdel: jest.fn((key: string) => {
        const value = entries.get(key) ?? null;
        entries.delete(key);
        return Promise.resolve(value);
      }),
    },
  };
});
jest.mock("@/server/storage", () => ({ storage: { getUser: jest.fn() } }));

import { createHash } from "node:crypto";
import { format } from "node:util";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { allowRefresh, putAuthCode } from "@/lib/mcp-oauth/store";
import { mintRefreshToken, randomId } from "@/lib/mcp-oauth/tokens";
import { CREDENTIAL_CHECK_FAILED_MESSAGE } from "@/server/security/credential-check";
import { storage } from "@/server/storage";
import { POST } from "../token/route";

const cache = jest.requireMock("@/lib/cache/cache-service") as {
  __entries: Map<string, unknown>;
  cacheService: { getdel: jest.Mock };
};
const getUser = storage.getUser as jest.Mock;

const USER_ID = "user-with-a-grant";
const CLIENT = "mcp_client";
const REDIRECT = "https://client.example/callback";
const VERIFIER = "a-long-enough-pkce-verifier-for-this-test";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const GRANT = {
  sub: USER_ID,
  cid: CLIENT,
  scope: "mcp",
  aud: "https://cronium.example.com/api/mcp",
  sv: 3,
};
const LIVE_USER = { id: USER_ID, status: "ACTIVE", sessionVersion: 3 };

/** What a failed lookup really is: Drizzle's message and params carry the bound values. */
const failedQuery = () =>
  new DrizzleQueryError(
    'select "id" from "users" where "users"."id" = $1',
    [USER_ID],
    Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
      code: "ECONNREFUSED",
    }),
  );

function post(fields: Record<string, string>, signal?: AbortSignal) {
  return POST(
    new Request("https://cronium.example.com/api/mcp/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      ...(signal ? { signal } : {}),
    }),
  );
}

interface Credential {
  key: string;
  present: (
    fields?: Record<string, string>,
    signal?: AbortSignal,
  ) => Promise<Response>;
}

async function refreshToken(): Promise<Credential> {
  const jti = randomId(16);
  await allowRefresh(jti, GRANT);
  const token = mintRefreshToken({ ...GRANT, jti });
  return {
    key: `mcpoauth:rt:${jti}`,
    present: (fields, signal) =>
      post(
        { grant_type: "refresh_token", refresh_token: token, ...fields },
        signal,
      ),
  };
}

async function authorizationCode(): Promise<Credential> {
  const code = randomId();
  await putAuthCode(code, {
    sub: USER_ID,
    cid: CLIENT,
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
    scope: "mcp",
    resource: GRANT.aud,
    sv: GRANT.sv,
  });
  return {
    key: `mcpoauth:code:${code}`,
    present: (fields, signal) =>
      post(
        {
          grant_type: "authorization_code",
          code,
          client_id: CLIENT,
          redirect_uri: REDIRECT,
          code_verifier: VERIFIER,
          ...fields,
        },
        signal,
      ),
  };
}

const CREDENTIALS: [string, () => Promise<Credential>][] = [
  ["a refresh token", refreshToken],
  ["an authorization code", authorizationCode],
];

let consoleError: jest.SpyInstance;
const logged = () =>
  consoleError.mock.calls
    .map((args) => format(...(args as unknown[])))
    .join("\n");

beforeEach(() => {
  jest.clearAllMocks();
  cache.__entries.clear();
  getUser.mockReset();
  getUser.mockResolvedValue(LIVE_USER);
  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
});

afterEach(() => consoleError.mockRestore());

describe.each(CREDENTIALS)("%s when its owner can't be read", (_, issue) => {
  beforeEach(() => getUser.mockRejectedValue(failedQuery()));

  it("answers a 503 in OAuth's shape that doesn't call the token bad", async () => {
    const { present } = await issue();

    const res = await present();

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: "temporarily_unavailable",
      error_description: CREDENTIAL_CHECK_FAILED_MESSAGE,
    });
  });

  it("isn't used up, and works once, when the database is back", async () => {
    const { key, present } = await issue();

    expect((await present()).status).toBe(503);
    expect((await present()).status).toBe(503);
    expect(cache.__entries.has(key)).toBe(true);
    expect(cache.cacheService.getdel).not.toHaveBeenCalled();

    getUser.mockResolvedValue(LIVE_USER);
    const first = await present();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      token_type: "Bearer",
      scope: "mcp",
    });

    const again = await present();
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe(
      "invalid_grant",
    );
  });

  it("logs why, without the query or the user's id", async () => {
    const { present } = await issue();

    await present();

    expect(logged()).toContain("Error reading an OAuth grant's owner");
    expect(logged()).toContain("ECONNREFUSED");
    expect(logged()).not.toContain("Failed query");
    expect(logged()).not.toContain("select");
    expect(logged()).not.toContain(USER_ID);
  });
});

describe.each(CREDENTIALS)("%s when the read works", (_, issue) => {
  it("is read once, before it's taken", async () => {
    const { present } = await issue();

    expect((await present()).status).toBe(200);

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getUser.mock.invocationCallOrder[0]).toBeLessThan(
      cache.cacheService.getdel.mock.invocationCallOrder[0]!,
    );
  });

  // A second read after taking it would lose the token whenever that one failed.
  it("doesn't need the database once it's been read", async () => {
    const { present } = await issue();
    getUser.mockResolvedValueOnce(LIVE_USER);
    getUser.mockRejectedValue(failedQuery());

    expect((await present()).status).toBe(200);
  });

  it("is refused and used up when the grant was revoked", async () => {
    const { key, present } = await issue();
    getUser.mockResolvedValue({ ...LIVE_USER, sessionVersion: 4 });

    const refused = await present();

    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe(
      "invalid_grant",
    );
    expect(cache.__entries.has(key)).toBe(false);

    getUser.mockResolvedValue(LIVE_USER);
    expect((await present()).status).toBe(400);
  });

  it.each<[string, Record<string, unknown> | undefined]>([
    ["disabled", { ...LIVE_USER, status: "DISABLED" }],
    ["deleted", undefined],
  ])("is refused when its owner was %s", async (_label, user) => {
    const { present } = await issue();
    getUser.mockResolvedValue(user);

    expect((await present()).status).toBe(400);
  });

  it("doesn't call any other error a failed check", async () => {
    const { present } = await issue();
    cache.cacheService.getdel.mockRejectedValueOnce(new Error("not a lookup"));

    await expect(present()).rejects.toThrow("not a lookup");
  });
});

// A frozen database can hold a read for as long as the freeze lasts. A request nobody is
// waiting for would use the token up, and nobody would get what replaces it.
describe.each(CREDENTIALS)("%s when the client gives up", (_, issue) => {
  it("stays for the client's next try if that's during the read", async () => {
    const { key, present } = await issue();
    const client = new AbortController();
    getUser.mockImplementationOnce(() => {
      client.abort();
      return Promise.resolve(LIVE_USER);
    });

    await present(undefined, client.signal);

    expect(cache.__entries.has(key)).toBe(true);
    expect(cache.cacheService.getdel).not.toHaveBeenCalled();
    expect((await present()).status).toBe(200);
  });
});

describe("a credential nobody can use", () => {
  beforeEach(() => getUser.mockRejectedValue(failedQuery()));

  it.each(CREDENTIALS)(
    "refuses %s that's been used, without asking the database",
    async (_, issue) => {
      const { present } = await issue();
      getUser.mockResolvedValueOnce(LIVE_USER);
      expect((await present()).status).toBe(200);
      getUser.mockClear();

      const replay = await present();

      expect(replay.status).toBe(400);
      expect(((await replay.json()) as { error: string }).error).toBe(
        "invalid_grant",
      );
      expect(getUser).not.toHaveBeenCalled();
    },
  );

  it("refuses a code nobody issued", async () => {
    const res = await post({
      grant_type: "authorization_code",
      code: "made-up",
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    });

    expect(res.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("refuses a signed refresh token that isn't on the list", async () => {
    const res = await post({
      grant_type: "refresh_token",
      refresh_token: mintRefreshToken({ ...GRANT, jti: randomId(16) }),
    });

    expect(res.status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("a code presented with the wrong details", () => {
  const WRONG: [string, Record<string, string>][] = [
    ["client", { client_id: "another_client" }],
    ["redirect", { redirect_uri: "https://elsewhere.example/callback" }],
    ["verifier", { code_verifier: "not-the-verifier-for-this-code" }],
  ];

  it.each(WRONG)("is used up by the wrong %s", async (_, wrong) => {
    const { key, present } = await authorizationCode();

    const refused = await present(wrong);

    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe(
      "invalid_grant",
    );
    expect(cache.__entries.has(key)).toBe(false);
    expect((await present()).status).toBe(400);
  });

  // A 503 says nothing about the verifier, so it can't be used to guess one, and a wrong
  // guess during an outage doesn't cost the real client its code.
  it.each(WRONG)(
    "keeps the code when the owner can't be read, whatever the %s",
    async (_, wrong) => {
      const { key, present } = await authorizationCode();
      getUser.mockRejectedValue(failedQuery());

      expect((await present(wrong)).status).toBe(503);
      expect(cache.__entries.has(key)).toBe(true);

      getUser.mockResolvedValue(LIVE_USER);
      expect((await present()).status).toBe(200);
    },
  );
});
