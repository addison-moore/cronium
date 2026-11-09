/**
 * The MCP OAuth endpoints with Valkey stopped, and with Valkey refusing writes, on real Valkey
 * and real Postgres. A mock can't hold this: what matters is what the app's own ioredis client
 * does when its connection really goes, and what a Valkey at `maxmemory` under `noeviction`
 * really refuses. Production runs it that way, and there GET and GETDEL still work when writes
 * don't, which is how a refresh used to answer 200 with a token it never stored.
 *
 * Stopping is a relay between the app and Valkey that drops its connections and refuses new
 * ones, as `docker stop` does. The server itself stays up for the checks here and for the rest
 * of the suite. A really stopped container was measured on a production build, for the PR.
 */
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import Redis from "ioredis";
import { createHash, randomBytes } from "node:crypto";
import { format, inspect } from "node:util";
import { relayTo, type ValkeyRelay } from "./helpers/valkey-relay";

// Loaded once the relay is up, so the app's cache client connects through it.
const load = async () => ({
  token: await import("@/app/api/mcp/oauth/token/route"),
  authorize: await import("@/app/api/mcp/oauth/authorize/route"),
  store: await import("@/lib/mcp-oauth/store"),
  tokens: await import("@/lib/mcp-oauth/tokens"),
  resource: await import("@/lib/mcp-oauth/resource"),
  cache: await import("@/lib/cache/cache-service"),
  unavailable: await import("@/lib/cache/cache-unavailable"),
  check: await import("@/server/security/credential-check"),
  db: await import("@/server/db"),
  storage: await import("@/server/storage"),
  schema: await import("@/shared/schema"),
  reset: await import("./helpers/db-reset"),
});
let app: Awaited<ReturnType<typeof load>>;

const USER = "valkey-outage-user";
const CLIENT = "mcp_valkey_outage_client";
const REDIRECT = "https://client.example/callback";
const VERIFIER = "a-long-enough-pkce-verifier-for-this-test";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const BASE = "https://cronium.example.test";
const AUD = `${BASE}/api/mcp`;
const AT_ONCE = 10;
// ioredis waits up to 3 seconds between tries, so this is several of them.
const RECONNECT_LIMIT_MS = 20_000;
// A request that never gets as far as storing its new token shouldn't hold the others for long.
const HOLD_LIMIT_MS = 30_000;

let relay: ValkeyRelay;
let admin: Redis; // Straight to Valkey, past the relay.
let sessionVersion: number;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function post(fields: Record<string, string>) {
  return app.token.POST(
    new Request(`${BASE}/api/mcp/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

interface Credential {
  key: string;
  /** The part of the key that's the credential, which no log may hold. */
  secret: string;
  present: () => Promise<Response>;
}

async function refreshToken(): Promise<Credential> {
  const jti = app.tokens.randomId(16);
  const grant = {
    sub: USER,
    cid: CLIENT,
    scope: "mcp",
    aud: AUD,
    sv: sessionVersion,
  };
  await app.store.allowRefresh(jti, grant);
  const token = app.tokens.mintRefreshToken({ ...grant, jti });
  return {
    key: `mcpoauth:rt:${jti}`,
    secret: jti,
    present: () => refreshWith(token),
  };
}

async function authorizationCode(): Promise<Credential> {
  const code = app.tokens.randomId();
  await app.store.putAuthCode(code, {
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
    secret: code,
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

const refreshWith = (refresh_token: string) =>
  post({ grant_type: "refresh_token", refresh_token, client_id: CLIENT });

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: string }).error;

const tokensOf = async (res: Response) =>
  (await res.json()) as { access_token: string; refresh_token: string };

const inValkey = async (key: string) => (await admin.exists(key)) === 1;

/** What a client is told when Valkey can't be asked: keep the token and try again. */
const expectTemporarilyUnavailable = async (res: Response) => {
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({
    error: "temporarily_unavailable",
    error_description: app.check.CREDENTIAL_CHECK_FAILED_MESSAGE,
  });
};

const expectInvalidGrant = async (res: Response) => {
  expect(res.status).toBe(400);
  expect(await errorOf(res)).toBe("invalid_grant");
};

/** Every refresh token's key in Valkey, for counting what a request left behind. */
async function refreshKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor = "0";
  do {
    const [next, batch] = await admin.scan(
      cursor,
      "MATCH",
      "mcpoauth:rt:*",
      "COUNT",
      1000,
    );
    cursor = next;
    for (const key of batch) keys.add(key);
  } while (cursor !== "0");
  return keys;
}

const jtiOf = (refreshToken: string) =>
  app.tokens.verifyRefreshToken(refreshToken)!.jti;

async function untilTheAppSees(connected: boolean): Promise<void> {
  const limit = Date.now() + RECONNECT_LIMIT_MS;
  while (app.cache.cacheService.isAvailable() !== connected) {
    if (Date.now() > limit) {
      throw new Error(`The cache never became ${connected ? "up" : "down"}`);
    }
    await sleep(20);
  }
}

async function withValkeyStopped<T>(run: () => Promise<T>): Promise<T> {
  await relay.stop();
  try {
    await untilTheAppSees(false);
    return await run();
  } finally {
    await relay.start();
    await untilTheAppSees(true);
  }
}

/** As production runs out of room: `maxmemory` under `noeviction`, where reads still work. */
async function withValkeyRefusingWrites<T>(run: () => Promise<T>): Promise<T> {
  const [, policy] = (await admin.config(
    "GET",
    "maxmemory-policy",
  )) as string[];
  const [, limit] = (await admin.config("GET", "maxmemory")) as string[];
  await admin.config("SET", "maxmemory-policy", "noeviction");
  await admin.config("SET", "maxmemory", "1");
  try {
    return await run();
  } finally {
    await admin.config("SET", "maxmemory", limit!);
    await admin.config("SET", "maxmemory-policy", policy!);
  }
}

let consoleError: jest.SpyInstance;
const logged = () =>
  consoleError.mock.calls
    .map((args) => format(...(args as unknown[])))
    .join("\n");

/** The connection logs each time it's lost or made, and Valkey gets stopped a lot here. */
const quietConnectionLog = () =>
  jest.spyOn(console, "log").mockImplementation(() => undefined);

beforeAll(async () => {
  quietConnectionLog();
  relay = await relayTo(process.env.VALKEY_URL!);
  admin = new Redis(process.env.VALKEY_URL!);
  process.env.VALKEY_URL = relay.url;
  process.env.REDIS_URL = relay.url;
  app = await load();
  await untilTheAppSees(true);
});

beforeEach(async () => {
  await app.reset.resetDatabase();
  const [row] = await app.db.db
    .insert(app.schema.users)
    .values({
      id: USER,
      email: "valkey-outage@example.test",
      username: "valkey-outage",
      role: "USER",
      status: "ACTIVE",
    } as never)
    .returning();
  sessionVersion = row!.sessionVersion;
  // The connection logs every lost connection and failed reconnect too.
  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  quietConnectionLog();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  quietConnectionLog();
  admin.disconnect();
  await app.cache.cacheService.disconnect();
  await relay.stop();
  await app.reset.closePool();
  // The client logs its closed connection a moment after QUIT, which Jest reports as a log
  // after the tests are done once the file has gone.
  await sleep(200);
});

describe.each(CREDENTIALS)("%s with Valkey stopped", (name, issue) => {
  const kind = name.replace(/^an? /, "");

  it("answers a 503 in OAuth's shape, and stays in Valkey", async () => {
    const { key, present } = await issue();

    await withValkeyStopped(async () => {
      await expectTemporarilyUnavailable(await present());
    });

    expect(await inValkey(key)).toBe(true);
  });

  it("works once Valkey is back, and only once", async () => {
    const { key, present } = await issue();

    await withValkeyStopped(async () => {
      expect((await present()).status).toBe(503);
      expect((await present()).status).toBe(503);
    });

    const first = await present();
    expect(first.status).toBe(200);
    const { access_token, refresh_token } = await tokensOf(first);
    await expect(
      app.resource.sessionFromOAuthToken(
        new Headers({ authorization: `Bearer ${access_token}` }),
      ),
    ).resolves.toMatchObject({ scopes: ["mcp"] });
    expect(await inValkey(key)).toBe(false);
    await expectInvalidGrant(await present());
    expect((await refreshWith(refresh_token)).status).toBe(200);
  });

  // Without waiting for the client to see the connection go, so the command may be sent and
  // retried until ioredis gives up, rather than refused at once.
  it("answers a 503 straight after Valkey stops", async () => {
    const { key, present } = await issue();

    await relay.stop();
    try {
      await expectTemporarilyUnavailable(await present());
    } finally {
      await relay.start();
      await untilTheAppSees(true);
    }

    expect(await inValkey(key)).toBe(true);
  });

  it("logs which step failed, without the credential", async () => {
    const { secret, present } = await issue();

    await withValkeyStopped(present);

    expect(logged()).toContain(`Error reading an OAuth ${kind}`);
    expect(logged()).toContain("CacheUnavailableError");
    expect(logged()).not.toContain(secret);
    expect(logged()).not.toContain(USER);
  });

  it("survives many requests at once, and then lets one through", async () => {
    const { present } = await issue();

    await withValkeyStopped(async () => {
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
});

/** Stops Valkey once the request has stored its new refresh token, before it takes the old one. */
function stopValkeyOnceTheNewTokenIsStored() {
  const { cacheService } = app.cache;
  const realSetStrict = cacheService.setStrict.bind(cacheService);
  return jest
    .spyOn(cacheService, "setStrict")
    .mockImplementationOnce(async (key, value, options) => {
      await realSetStrict(key, value, options);
      await relay.stop();
      await untilTheAppSees(false);
    });
}

describe.each(CREDENTIALS)(
  "%s when Valkey stops between storing the new token and taking it",
  (_, issue) => {
    it("answers a 503, and works once Valkey is back", async () => {
      const { key, present } = await issue();
      stopValkeyOnceTheNewTokenIsStored();

      try {
        await expectTemporarilyUnavailable(await present());
      } finally {
        await relay.start();
        await untilTheAppSees(true);
      }

      expect(await inValkey(key)).toBe(true);
      expect((await present()).status).toBe(200);
    });
  },
);

describe.each(CREDENTIALS)("%s with Valkey refusing writes", (_, issue) => {
  it("answers a 503 in OAuth's shape, and stays in Valkey", async () => {
    const { key, present } = await issue();
    const before = await refreshKeys();

    await withValkeyRefusingWrites(async () => {
      await expectTemporarilyUnavailable(await present());
    });

    expect(await inValkey(key)).toBe(true);
    expect(await refreshKeys()).toEqual(before);
  });

  it("works once Valkey takes writes again, and gives a token that works", async () => {
    const { present } = await issue();

    await withValkeyRefusingWrites(async () => {
      expect((await present()).status).toBe(503);
    });

    const first = await present();
    expect(first.status).toBe(200);
    const { refresh_token } = await tokensOf(first);
    expect(await inValkey(`mcpoauth:rt:${jtiOf(refresh_token)}`)).toBe(true);
    expect((await refreshWith(refresh_token)).status).toBe(200);
    await expectInvalidGrant(await present());
  });

  it("logs the refused write, without the credential or what was being stored", async () => {
    const { secret, present } = await issue();

    await withValkeyRefusingWrites(present);

    expect(logged()).toContain("Error storing an OAuth refresh token");
    expect(logged()).toContain("OOM command not allowed");
    expect(logged()).not.toContain(secret);
    expect(logged()).not.toContain(USER);
    expect(logged()).not.toContain('"json"');
  });
});

describe.each(CREDENTIALS)("%s that really isn't there", (_, issue) => {
  it("gets invalid_grant once it has expired", async () => {
    const { key, present } = await issue();
    await admin.pexpire(key, 1);
    await sleep(20);

    await expectInvalidGrant(await present());
  });

  it("gets invalid_grant when Valkey has come back without it", async () => {
    const { key, present } = await issue();

    await withValkeyStopped(async () => {
      await admin.del(key);
      expect((await present()).status).toBe(503);
    });

    await expectInvalidGrant(await present());
  });
});

describe("credentials nobody issued, with Valkey up", () => {
  it("refuses a code", async () => {
    await expectInvalidGrant(
      await post({
        grant_type: "authorization_code",
        code: "made-up",
        client_id: CLIENT,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
      }),
    );
  });

  it("refuses a signed refresh token that isn't on the list", async () => {
    await expectInvalidGrant(
      await refreshWith(
        app.tokens.mintRefreshToken({
          sub: USER,
          cid: CLIENT,
          scope: "mcp",
          aud: AUD,
          sv: sessionVersion,
          jti: app.tokens.randomId(16),
        }),
      ),
    );
  });
});

/** Holds each new refresh token's write until `count` are stored, then lets them all go. */
function holdNewTokensUntil(count: number) {
  const { cacheService } = app.cache;
  const realSetStrict = cacheService.setStrict.bind(cacheService);
  let stored = 0;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
    setTimeout(resolve, HOLD_LIMIT_MS).unref();
  });
  return jest
    .spyOn(cacheService, "setStrict")
    .mockImplementation(async (key, value, options) => {
      await realSetStrict(key, value, options);
      stored += 1;
      if (stored === count) open();
      await gate;
    });
}

describe.each(CREDENTIALS)("single use of %s on real Valkey", (_, issue) => {
  it("lets one through when every request has stored its new token, and keeps only the winner's", async () => {
    const { key, present } = await issue();
    const before = await refreshKeys();
    const writes = holdNewTokensUntil(AT_ONCE);

    const answers = await Promise.all(
      Array.from({ length: AT_ONCE }, () => present()),
    );

    // Each stored a new token before any took the old one, so only GETDEL told them apart.
    expect(writes).toHaveBeenCalledTimes(AT_ONCE);
    writes.mockRestore();
    const winners = answers.filter((res) => res.status === 200);
    const losers = answers.filter((res) => res.status !== 200);
    expect(winners).toHaveLength(1);
    for (const loser of losers) await expectInvalidGrant(loser);
    expect(await inValkey(key)).toBe(false);

    const { refresh_token } = await tokensOf(winners[0]!);
    const added = [...(await refreshKeys())].filter((k) => !before.has(k));
    expect(added).toEqual([`mcpoauth:rt:${jtiOf(refresh_token)}`]);
    expect((await refreshWith(refresh_token)).status).toBe(200);
  });

  it("refuses a replay after a real success", async () => {
    const { present } = await issue();
    expect((await present()).status).toBe(200);

    await expectInvalidGrant(await present());
  });
});

describe("the authorize endpoint", () => {
  let apiToken: string;

  beforeEach(async () => {
    apiToken = `crn_valkey_outage_${randomBytes(24).toString("hex")}`;
    await app.storage.storage.createApiToken({
      userId: USER,
      name: "valkey outage",
      token: apiToken,
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 864e5),
      scopes: ["mcp"],
    } as never);
    await app.store.registerClient({
      client_id: CLIENT,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      created_at: Math.floor(Date.now() / 1000),
    });
  });

  const authorizeUrl = () =>
    `${BASE}/api/mcp/oauth/authorize?${new URLSearchParams({
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      response_type: "code",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      scope: "mcp",
      state: "the-state",
    })}`;

  const visit = (url: string) =>
    app.authorize.GET(
      new Request(url, { headers: { authorization: `Bearer ${apiToken}` } }),
    );

  /** The consent page's Approve link, as the owner's browser would follow it. */
  async function approveLink(): Promise<string> {
    const page = await visit(authorizeUrl());
    expect(page.status).toBe(200);
    const href = /href="([^"]*consent=(?!deny)[^"]*)"/.exec(await page.text())!;
    return href[1]!.replace(/&amp;/g, "&");
  }

  it("says it couldn't look the client up, not that it's unknown, with Valkey stopped", async () => {
    await withValkeyStopped(async () => {
      const page = await visit(authorizeUrl());

      expect(page.status).toBe(503);
      const text = await page.text();
      expect(text).toContain("look up this application");
      expect(text).not.toContain("Unknown client_id");
    });
    expect(logged()).toContain("Error reading an MCP OAuth client");
  });

  it("sends the client temporarily_unavailable, not a code it didn't store, with Valkey refusing writes", async () => {
    const approve = await approveLink();
    const codesBefore = await admin.keys("mcpoauth:code:*");

    const refused = await withValkeyRefusingWrites(() => visit(approve));

    expect(refused.status).toBe(302);
    const back = new URL(refused.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("error")).toBe("temporarily_unavailable");
    expect(back.searchParams.get("state")).toBe("the-state");
    expect(back.searchParams.has("code")).toBe(false);
    expect(await admin.keys("mcpoauth:code:*")).toEqual(codesBefore);
    expect(logged()).toContain("Error storing an OAuth authorization code");
    expect(logged()).toContain("OOM command not allowed");

    // The same approval works once Valkey takes writes again.
    const approved = await visit(approve);
    const code = new URL(approved.headers.get("location")!).searchParams.get(
      "code",
    )!;
    const exchanged = await post({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      code_verifier: VERIFIER,
    });
    expect(exchanged.status).toBe(200);
    expect(logged()).not.toContain(code);
  });
});

describe("registering a client with Valkey refusing writes", () => {
  it("throws rather than hand out an id it didn't store", async () => {
    const client = {
      client_id: `mcp_${app.tokens.randomId(18)}`,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none" as const,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      created_at: Math.floor(Date.now() / 1000),
    };

    await withValkeyRefusingWrites(async () => {
      await expect(app.store.registerClient(client)).rejects.toBeInstanceOf(
        app.unavailable.CacheUnavailableError,
      );
    });

    expect(await inValkey(`mcpoauth:client:${client.client_id}`)).toBe(false);
  });
});

// ioredis puts the command's arguments on its errors, so a refused write's error held the
// key and the value, and anything logging it whole would have logged the code.
describe("a refused write's error", () => {
  it("says what failed, without the code or what was being stored", async () => {
    const code = app.tokens.randomId();

    const error = await withValkeyRefusingWrites(() =>
      app.store
        .putAuthCode(code, {
          sub: USER,
          cid: CLIENT,
          redirectUri: REDIRECT,
          codeChallenge: CHALLENGE,
          scope: "mcp",
          resource: AUD,
          sv: sessionVersion,
        })
        .then(
          () => null,
          (failure: unknown) => failure,
        ),
    );

    expect(error).toBeInstanceOf(app.unavailable.CacheUnavailableError);
    const everything = inspect(error, { depth: 10, showHidden: true });
    expect(everything).toContain("OOM command not allowed");
    expect(everything).not.toContain(code);
    expect(everything).not.toContain(USER);
  });
});
