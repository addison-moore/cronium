/**
 * The MCP OAuth token endpoint on real Postgres and real Valkey. A mock can't hold this: what
 * matters is that a failure Postgres really sends, wrapped by Drizzle, leaves the token in
 * Valkey with nothing of the query in the log, and that real GETDEL lets one request through
 * however many got past the read together.
 */
import Redis from "ioredis";
import { createHash } from "node:crypto";
import { format } from "node:util";
import { POST } from "@/app/api/mcp/oauth/token/route";
import { cacheService } from "@/lib/cache/cache-service";
import { sessionFromOAuthToken } from "@/lib/mcp-oauth/resource";
import { allowRefresh, putAuthCode } from "@/lib/mcp-oauth/store";
import { mintRefreshToken, randomId } from "@/lib/mcp-oauth/tokens";
import { db, pool } from "@/server/db";
import { CREDENTIAL_CHECK_FAILED_MESSAGE } from "@/server/security/credential-check";
import { storage } from "@/server/storage";
import { users, type User } from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";

const USER = "oauth-token-outage-user";
const CLIENT = "mcp_client";
const REDIRECT = "https://client.example/callback";
const VERIFIER = "a-long-enough-pkce-verifier-for-this-test";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const AUD = "https://cronium.example.test/api/mcp";
// Fewer than the pool holds, so a slow machine's wait for a connection can't turn a refusal
// into a 503.
const AT_ONCE = 10;
// A request that never reaches a read shouldn't leave the others waiting for the test's limit.
const HOLD_LIMIT_MS = 30_000;

let admin: Redis;
let sessionVersion: number;

function post(fields: Record<string, string>) {
  return POST(
    new Request("https://cronium.example.test/api/mcp/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

interface Credential {
  key: string;
  present: () => Promise<Response>;
}

async function refreshToken(): Promise<Credential> {
  const jti = randomId(16);
  const grant = {
    sub: USER,
    cid: CLIENT,
    scope: "mcp",
    aud: AUD,
    sv: sessionVersion,
  };
  await allowRefresh(jti, grant);
  const token = mintRefreshToken({ ...grant, jti });
  return {
    key: `mcpoauth:rt:${jti}`,
    present: () =>
      post({
        grant_type: "refresh_token",
        refresh_token: token,
        client_id: CLIENT,
      }),
  };
}

async function authorizationCode(): Promise<Credential> {
  const code = randomId();
  await putAuthCode(code, {
    sub: USER,
    cid: CLIENT,
    redirectUri: REDIRECT,
    codeChallenge: CHALLENGE,
    scope: "mcp",
    resource: AUD,
    sv: sessionVersion,
  });
  return {
    key: `mcpoauth:code:${code}`,
    present: () =>
      post({
        grant_type: "authorization_code",
        code,
        client_id: CLIENT,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
      }),
  };
}

const CREDENTIALS: [string, () => Promise<Credential>][] = [
  ["a refresh token", refreshToken],
  ["an authorization code", authorizationCode],
];

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: string }).error;

const inValkey = async (key: string) => (await admin.exists(key)) === 1;

/** The two tokens that come back from a good answer. */
const tokensOf = (body: unknown) =>
  body as { access_token: string; refresh_token: string };

const refreshWith = (refresh_token: string) =>
  post({ grant_type: "refresh_token", refresh_token, client_id: CLIENT });

const accessWith = (access_token: string) =>
  sessionFromOAuthToken(
    new Headers({ authorization: `Bearer ${access_token}` }),
  );

// Rather than stop the server, which every other query here needs. A really stopped server
// was measured on a production build, for the PR.
async function withTheUsersTableGone<T>(run: () => Promise<T>): Promise<T> {
  await pool.query("ALTER TABLE users RENAME TO users_away");
  try {
    return await run();
  } finally {
    await pool.query("ALTER TABLE users_away RENAME TO users");
  }
}

/** Holds every read until `count` of them have got this far, then lets them all go at once. */
function holdReadsUntil(count: number) {
  const realGetUser = storage.getUser.bind(storage);
  let arrived = 0;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
    setTimeout(resolve, HOLD_LIMIT_MS).unref();
  });
  return jest.spyOn(storage, "getUser").mockImplementation(async (id) => {
    const user = await realGetUser(id);
    arrived += 1;
    if (arrived === count) open();
    await gate;
    return user;
  });
}

/** Does `then` just after the first read has its answer, before the request goes on. */
function afterTheNextRead(then: () => Promise<unknown>) {
  const realGetUser = storage.getUser.bind(storage);
  return jest
    .spyOn(storage, "getUser")
    .mockImplementationOnce(async (id): Promise<User | undefined> => {
      const user = await realGetUser(id);
      await then();
      return user;
    });
}

let consoleError: jest.SpyInstance;
const logged = () =>
  consoleError.mock.calls
    .map((args) => format(...(args as unknown[])))
    .join("\n");

beforeAll(async () => {
  admin = new Redis(process.env.VALKEY_URL!);
  while (!cacheService.isAvailable()) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
});

beforeEach(async () => {
  await resetDatabase();
  const [row] = await db
    .insert(users)
    .values({
      id: USER,
      email: "user@example.test",
      username: "user",
      role: "USER",
      status: "ACTIVE",
    } as never)
    .returning();
  sessionVersion = row!.sessionVersion;
  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  admin.disconnect();
  await cacheService.disconnect();
  await closePool();
});

describe.each(CREDENTIALS)("%s when Postgres refuses the read", (_, issue) => {
  it("answers a 503 in OAuth's shape, and stays in Valkey", async () => {
    const { key, present } = await issue();

    await withTheUsersTableGone(async () => {
      const res = await present();

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: "temporarily_unavailable",
        error_description: CREDENTIAL_CHECK_FAILED_MESSAGE,
      });
      expect(await inValkey(key)).toBe(true);
    });
  });

  it("logs why, without the query or the user's id", async () => {
    const { present } = await issue();

    await withTheUsersTableGone(present);

    expect(logged()).toContain("Error reading an OAuth grant's owner");
    expect(logged()).toContain("42P01");
    expect(logged()).not.toContain("Failed query");
    expect(logged()).not.toContain("select");
    expect(logged()).not.toContain("params");
    expect(logged()).not.toContain(USER);
  });

  it("works once when Postgres answers again", async () => {
    const { key, present } = await issue();

    await withTheUsersTableGone(async () => {
      expect((await present()).status).toBe(503);
      expect((await present()).status).toBe(503);
    });

    const first = await present();
    expect(first.status).toBe(200);
    const { access_token } = tokensOf(await first.json());
    await expect(accessWith(access_token)).resolves.toMatchObject({
      scopes: ["mcp"],
    });
    expect(await inValkey(key)).toBe(false);

    const again = await present();
    expect(again.status).toBe(400);
    expect(await errorOf(again)).toBe("invalid_grant");
  });

  // Put back or re-written, it would get a new lifetime each time an outage touched it.
  it("isn't given more time by the attempts", async () => {
    const { key, present } = await issue();
    await admin.pexpire(key, 40_000);

    await withTheUsersTableGone(present);

    const left = await admin.pttl(key);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(40_000);
  });

  it("survives many requests at once, and then lets one through", async () => {
    const { present } = await issue();

    await withTheUsersTableGone(async () => {
      const during = await Promise.all(
        Array.from({ length: AT_ONCE }, () => present()),
      );
      expect(during.map((res) => res.status)).toEqual(
        Array.from({ length: AT_ONCE }, () => 503),
      );
    });

    const after = await Promise.all(
      Array.from({ length: AT_ONCE }, () => present()),
    );
    expect(after.filter((res) => res.status === 200)).toHaveLength(1);
    expect(after.filter((res) => res.status === 400)).toHaveLength(AT_ONCE - 1);
  });

  it("is refused without Postgres once it's been used", async () => {
    const { present } = await issue();
    expect((await present()).status).toBe(200);

    await withTheUsersTableGone(async () => {
      const replay = await present();

      expect(replay.status).toBe(400);
      expect(await errorOf(replay)).toBe("invalid_grant");
    });
    expect(logged()).toBe("");
  });

  it("doesn't need Postgres once it's been read", async () => {
    const { present } = await issue();
    afterTheNextRead(() =>
      pool.query("ALTER TABLE users RENAME TO users_away"),
    );

    try {
      expect((await present()).status).toBe(200);
    } finally {
      await pool.query("ALTER TABLE users_away RENAME TO users");
    }
  });
});

describe.each(CREDENTIALS)("single use of %s on real Valkey", (_, issue) => {
  it("lets one through when every request has passed the read", async () => {
    const { key, present } = await issue();
    const reads = holdReadsUntil(AT_ONCE);

    const answers = await Promise.all(
      Array.from({ length: AT_ONCE }, () => present()),
    );

    // Each got as far as taking it, so nothing but GETDEL can have told them apart.
    expect(reads).toHaveBeenCalledTimes(AT_ONCE);
    const winners = answers.filter((res) => res.status === 200);
    const losers = answers.filter((res) => res.status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers.map((res) => res.status)).toEqual(
      Array.from({ length: AT_ONCE - 1 }, () => 400),
    );
    for (const loser of losers) {
      expect(await errorOf(loser)).toBe("invalid_grant");
    }
    expect(await inValkey(key)).toBe(false);

    reads.mockRestore();
    const { refresh_token } = tokensOf(await winners[0]!.json());
    expect((await refreshWith(refresh_token)).status).toBe(200);
  });

  it("refuses a replay after a real success", async () => {
    const { present } = await issue();
    expect((await present()).status).toBe(200);

    const replay = await present();

    expect(replay.status).toBe(400);
    expect(await errorOf(replay)).toBe("invalid_grant");
  });
});

describe.each(CREDENTIALS)("%s of a real revoked grant", (_, issue) => {
  it.each<[string, () => Promise<unknown>]>([
    ["a session revocation", () => storage.revokeUserSessions(USER)],
    ["disabling the user", () => storage.disableUser(USER)],
    [
      "a changed password",
      () => storage.updateUser(USER, { password: "another-hash" }),
    ],
    ["deleting the user", () => storage.deleteUser(USER)],
  ])("gets invalid_grant after %s, and is used up", async (_label, revoke) => {
    const { key, present } = await issue();
    await revoke();

    const refused = await present();

    expect(refused.status).toBe(400);
    expect(await errorOf(refused)).toBe("invalid_grant");
    expect(await inValkey(key)).toBe(false);
  });

  // Reading first opens this window: the answer has already been read when the revocation
  // lands. It's why minted tokens carry the session version and each use compares it.
  it.each<[string, () => Promise<unknown>]>([
    ["a session revocation", () => storage.revokeUserSessions(USER)],
    ["disabling the user", () => storage.disableUser(USER)],
  ])(
    "can't be used for anything if %s lands between the read and the take",
    async (_label, revoke) => {
      const { key, present } = await issue();
      afterTheNextRead(revoke);

      const answer = await present();

      expect(answer.status).toBe(200);
      expect(await inValkey(key)).toBe(false);
      const { access_token, refresh_token } = tokensOf(await answer.json());
      await expect(accessWith(access_token)).resolves.toBeNull();
      const refused = await refreshWith(refresh_token);
      expect(refused.status).toBe(400);
      expect(await errorOf(refused)).toBe("invalid_grant");
    },
  );
});
