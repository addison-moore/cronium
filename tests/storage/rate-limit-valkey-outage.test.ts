/**
 * The atomic rate limiter and every caller of it, with Valkey stopped and with Valkey refusing
 * writes, on real Valkey and Postgres. The limiter fails closed, so each caller still refuses,
 * but they used to answer as if the limit had been reached: sign-in and the other auth
 * endpoints said "Too many attempts", and MCP client registration answered a 429. A mock can't
 * hold this: what matters is how the limiter's own ioredis client fails when its connection
 * really goes, and that a Valkey at `maxmemory` under `noeviction`, as production runs it,
 * really refuses the INCR the limiter starts with.
 *
 * Stopping is a relay between the app and Valkey that drops its connections and refuses new
 * ones, as `docker stop` does. The server stays up for the checks here and the rest of the
 * suite. A really stopped container was measured on a production build, for the PR.
 *
 * NextAuth's own route runs here, which reads the request from `next/headers`. The mock below
 * hands it the request being made, which is all it reads there.
 */
const mockRequest: { current: Request | null } = { current: null };

jest.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers(mockRequest.current?.headers)),
  cookies: () =>
    Promise.resolve({
      getAll: () =>
        (mockRequest.current?.headers.get("cookie") ?? "")
          .split(";")
          .map((pair) => pair.trim())
          .filter(Boolean)
          .map((pair) => ({
            name: pair.slice(0, pair.indexOf("=")),
            value: decodeURIComponent(pair.slice(pair.indexOf("=") + 1)),
          })),
    }),
}));

import Redis from "ioredis";
import { format } from "node:util";
import { NextRequest } from "next/server";
import { relayTo, type ValkeyRelay } from "./helpers/valkey-relay";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(120_000);

// Loaded once the relay is up, so the app's Valkey clients connect through it.
const load = async () => ({
  limiter: await import("@/lib/security/atomic-rate-limiter"),
  register: await import("@/app/api/mcp/oauth/register/route"),
  trpc: await import("@/app/api/trpc/[trpc]/route"),
  nextAuth: await import("@/app/api/auth/[...nextauth]/route"),
  shared: await import("@/shared/rate-limit"),
  cache: await import("@/lib/cache/cache-service"),
  encryption: await import("@/lib/encryption-service"),
  totp: await import("@/lib/security/totp"),
  storage: await import("@/server/storage"),
  db: await import("@/server/db"),
  schema: await import("@/shared/schema"),
  reset: await import("./helpers/db-reset"),
});
let app: Awaited<ReturnType<typeof load>>;

const BASE = "http://localhost:5001";
const PASSWORD = "a-long-valid-password-for-this-test";
const LIMIT_KEYS = "cronium:ratelimit:v1:*";
// ioredis waits up to 2 seconds between tries to reconnect, so this is several of them.
const RECONNECT_LIMIT_MS = 20_000;

let relay: ValkeyRelay;
let relayUp = true;
let admin: Redis; // Straight to Valkey, past the relay.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Outages -------------------------------------------------------------------------------

/** What the limiter says to a probe of its own, which no test counts against. */
async function probe(): Promise<"allowed" | "limited" | "unavailable"> {
  const result = await app.limiter.consumeAtomicRateLimit(
    "probe",
    "storage-test-probe",
    { maxRequests: Number.MAX_SAFE_INTEGER, windowMs: 60_000 },
  );
  return result.allowed ? "allowed" : result.reason;
}

async function untilTheLimiterSays(answer: "allowed" | "unavailable") {
  const limit = Date.now() + RECONNECT_LIMIT_MS;
  while ((await probe()) !== answer) {
    if (Date.now() > limit) throw new Error(`The limiter never said ${answer}`);
    await sleep(20);
  }
}

async function stopValkey(): Promise<void> {
  relayUp = false;
  await relay.stop();
}

async function startValkey(): Promise<void> {
  if (relayUp) return;
  await relay.start();
  relayUp = true;
}

interface Outage {
  begin(): Promise<void>;
  end(): Promise<void>;
}

const STOPPED: Outage = {
  async begin() {
    await stopValkey();
    await untilTheLimiterSays("unavailable");
  },
  async end() {
    await startValkey();
    await untilTheLimiterSays("allowed");
  },
};

/** As production runs out of room: `maxmemory` under `noeviction`, where reads still work. */
let saved: { policy: string; limit: string } | null = null;
const REFUSING_WRITES: Outage = {
  async begin() {
    const [, policy] = (await admin.config(
      "GET",
      "maxmemory-policy",
    )) as string[];
    const [, limit] = (await admin.config("GET", "maxmemory")) as string[];
    saved = { policy: policy!, limit: limit! };
    await admin.config("SET", "maxmemory-policy", "noeviction");
    await admin.config("SET", "maxmemory", "1");
  },
  async end() {
    if (!saved) return;
    await admin.config("SET", "maxmemory", saved.limit);
    await admin.config("SET", "maxmemory-policy", saved.policy);
    saved = null;
  },
};

async function during<T>(outage: Outage, run: () => Promise<T>): Promise<T> {
  await outage.begin();
  try {
    return await run();
  } finally {
    await outage.end();
  }
}

const OUTAGES: [string, Outage][] = [
  ["stopped", STOPPED],
  ["refusing writes", REFUSING_WRITES],
];

// --- Requests ------------------------------------------------------------------------------

const registerClient = () =>
  app.register.POST(
    new Request(`${BASE}/api/mcp/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://client.example/callback"],
        client_name: "rate limit outage test",
      }),
    }),
  );

interface TrpcFailure {
  message: string;
  data: { code: string; httpStatus: number };
}

/** One call as the app's batch link sends it, through the real route and error formatter. */
async function callTrpc(
  path: string,
  type: "query" | "mutation",
  input: unknown,
  cookie?: string,
): Promise<{
  status: number;
  error: TrpcFailure | undefined;
  data: unknown;
}> {
  const batch = JSON.stringify({ 0: { json: input } });
  const url = new URL(`${BASE}/api/trpc/${path}?batch=1`);
  if (type === "query") url.searchParams.set("input", batch);
  const req = new NextRequest(url, {
    method: type === "query" ? "GET" : "POST",
    headers: {
      ...(type === "mutation" ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(type === "mutation" ? { body: batch } : {}),
  });
  mockRequest.current = req;
  const res = await (type === "query" ? app.trpc.GET : app.trpc.POST)(req);
  const [answer] = (await res.json()) as [
    { error?: { json: TrpcFailure }; result?: { data: { json: unknown } } },
  ];
  return {
    status: res.status,
    error: answer.error?.json,
    data: answer.result?.data.json,
  };
}

const cookiesFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0]!)
    .join("; ");

interface SignInAnswer {
  status: number;
  /** NextAuth's `error` in the URL it answers with, which `signIn()` hands the form. */
  error: string | null;
  sessionCookie: string | undefined;
  contentType: string | null;
  /** Every cookie the answer sets, by name. */
  cookieNames: string[];
}

/** Signs in as the sign-in form's `signIn()` does: the CSRF token, then the callback. */
async function signIn(
  credentials: Record<string, string>,
): Promise<SignInAnswer> {
  const csrfRequest = new NextRequest(`${BASE}/api/auth/csrf`);
  mockRequest.current = csrfRequest;
  const csrf = await app.nextAuth.GET(csrfRequest, {
    params: Promise.resolve({ nextauth: ["csrf"] }),
  });
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };

  const req = new NextRequest(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookiesFrom(csrf),
    },
    body: new URLSearchParams({
      ...credentials,
      csrfToken,
      callbackUrl: `${BASE}/dashboard`,
      json: "true",
    }).toString(),
  });
  mockRequest.current = req;
  const res = await app.nextAuth.POST(req, {
    params: Promise.resolve({ nextauth: ["callback", "credentials"] }),
  });
  const { url } = (await res.json()) as { url: string };
  const cookies = res.headers.getSetCookie();
  return {
    status: res.status,
    error: new URL(url).searchParams.get("error"),
    sessionCookie: cookies
      .find((cookie) => cookie.startsWith("next-auth.session-token="))
      ?.split(";")[0],
    contentType: res.headers.get("content-type"),
    cookieNames: cookies.map((cookie) => cookie.slice(0, cookie.indexOf("="))),
  };
}

// --- Data ----------------------------------------------------------------------------------

let userId: string;
const USERNAME = "outage-user";

async function seedUser(overrides: Record<string, unknown> = {}) {
  await app.db.db.insert(app.schema.users).values({
    id: "rate-limit-outage-user",
    email: "outage-user@example.test",
    username: USERNAME,
    role: "USER",
    status: "ACTIVE",
    password: await app.encryption.encryptionService.hashPassword(PASSWORD),
    ...overrides,
  } as never);
  return "rate-limit-outage-user";
}

/** Turns on TOTP for the user and gives back a code that's good now. */
async function withTotp(): Promise<string> {
  const secret = app.totp.generateTotpSecret();
  await app.storage.storage.setPendingMfaSecret(userId, secret);
  await app.storage.storage.enableMfa(userId, []);
  return app.totp.generateTotp(secret, Math.floor(Date.now() / 1000));
}

async function limitKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await admin.scan(
      cursor,
      "MATCH",
      LIMIT_KEYS,
      "COUNT",
      1000,
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys.filter((key) => !key.includes("storage-test-probe"));
}

/** Puts a bucket at its limit, as that many requests would have. */
const exhaust = (bucketAndIdentifier: string, count: number) =>
  admin.set(`cronium:ratelimit:v1:${bucketAndIdentifier}`, count, "PX", 60_000);

const countOf = async (bucketAndIdentifier: string) =>
  admin.get(`cronium:ratelimit:v1:${bucketAndIdentifier}`);

// --- Logs ----------------------------------------------------------------------------------

let consoleError: jest.SpyInstance;
const logged = () =>
  consoleError.mock.calls
    .map((args) => format(...(args as unknown[])))
    .join("\n");

/** Each lost and made connection logs, and Valkey gets stopped a lot here. */
const quietConnectionLog = () =>
  jest.spyOn(console, "log").mockImplementation(() => undefined);

beforeAll(async () => {
  quietConnectionLog();
  relay = await relayTo(process.env.VALKEY_URL!);
  admin = new Redis(process.env.VALKEY_URL!);
  process.env.VALKEY_URL = relay.url;
  process.env.REDIS_URL = relay.url;
  process.env.NEXTAUTH_URL = BASE;
  app = await load();
  await untilTheLimiterSays("allowed");
});

beforeEach(async () => {
  await app.reset.resetDatabase();
  const keys = await limitKeys();
  if (keys.length > 0) await admin.del(...keys);
  userId = await seedUser();
  consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  quietConnectionLog();
});

afterEach(async () => {
  // A failed expectation inside an outage still has to leave Valkey working for the next.
  await REFUSING_WRITES.end();
  await startValkey();
  await untilTheLimiterSays("allowed");
  jest.restoreAllMocks();
});

afterAll(async () => {
  quietConnectionLog();
  await app.limiter.closeAtomicRateLimiter();
  await app.cache.cacheService.disconnect();
  admin.disconnect();
  await relay.stop();
  await app.reset.closePool();
  // The clients log their closed connections a moment after they go, which Jest reports as a
  // log after the tests are done once the file has gone.
  await sleep(200);
});

// --- The limiter ---------------------------------------------------------------------------

describe("consumeAtomicRateLimit", () => {
  const consume = () =>
    app.limiter.consumeAtomicRateLimit("203.0.113.7", "storage-test", {
      maxRequests: 2,
      windowMs: 60_000,
    });

  it("allows, then says the limit was reached, with a time to try again after", async () => {
    await expect(consume()).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await consume();
    const over = await consume();
    expect(over).toMatchObject({
      allowed: false,
      reason: "limited",
      remaining: 0,
    });
    expect((over as { resetAt: Date }).resetAt.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  describe.each(OUTAGES)("with Valkey %s", (_name, outage) => {
    it("refuses, says it couldn't check, and counts nothing", async () => {
      await consume();

      const answer = await during(outage, consume);

      expect(answer).toEqual({ allowed: false, reason: "unavailable" });
      expect(await countOf("storage-test:203.0.113.7")).toBe("1");
      expect(logged()).toContain(
        "Atomic rate limiter unavailable — denying request (fail closed):",
      );
    });

    it("counts again once Valkey is back", async () => {
      await during(outage, consume);

      await expect(consume()).resolves.toMatchObject({ allowed: true });
      await expect(consume()).resolves.toMatchObject({ allowed: true });
      await expect(consume()).resolves.toMatchObject({ reason: "limited" });
    });
  });

  // Without waiting for the client to see the connection go, so the command may be sent and
  // retried until ioredis gives up, rather than refused at once.
  it("says it couldn't check straight after Valkey stops", async () => {
    await stopValkey();
    await expect(consume()).resolves.toEqual({
      allowed: false,
      reason: "unavailable",
    });
  });

  it("says it couldn't check when Valkey was down before its first use", async () => {
    await stopValkey();
    await jest.isolateModulesAsync(async () => {
      const cold = await import("@/lib/security/atomic-rate-limiter");
      const firstUse = () =>
        cold.consumeAtomicRateLimit("203.0.113.8", "storage-test-cold", {
          maxRequests: 5,
          windowMs: 60_000,
        });
      try {
        await expect(firstUse()).resolves.toEqual({
          allowed: false,
          reason: "unavailable",
        });
        await startValkey();
        await expect(firstUse()).resolves.toMatchObject({ allowed: true });
      } finally {
        await cold.closeAtomicRateLimiter();
      }
    });
  });
});

// --- MCP client registration ---------------------------------------------------------------

describe("POST /api/mcp/oauth/register", () => {
  const clientKeys = async () => admin.keys("mcpoauth:client:*");

  it("still answers a real limit with the 429 it always has", async () => {
    await exhaust("mcp-dcr:unknown", 10);

    const res = await registerClient();

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "invalid_request",
      error_description: "Too many registration requests; retry later",
    });
  });

  describe.each(OUTAGES)("with Valkey %s", (_name, outage) => {
    it("answers a 503 in OAuth's shape, and registers nothing", async () => {
      const before = await clientKeys();

      const res = await during(outage, registerClient);

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: "temporarily_unavailable",
        error_description: expect.stringMatching(
          /^Cronium can't check its limit on registrations right now, usually because Valkey is down or full/,
        ) as unknown,
      });
      expect(await clientKeys()).toEqual(before);
    });

    it("registers once Valkey is back", async () => {
      await during(outage, registerClient);

      expect((await registerClient()).status).toBe(201);
    });
  });
});

// --- The tRPC auth procedures --------------------------------------------------------------

// Everything behind withAuthRateLimit, keyed by IP, which is "unknown-ip" with no trusted
// proxy. None of these inputs would succeed, which doesn't matter: the limiter goes first.
const AUTH_PROCEDURES: [string, "query" | "mutation", unknown][] = [
  [
    "userAuth.register",
    "mutation",
    { username: "someone", email: "someone@example.test", password: PASSWORD },
  ],
  ["userAuth.forgotPassword", "mutation", { email: "someone@example.test" }],
  [
    "userAuth.resetPassword",
    "mutation",
    { token: "a-reset-token", password: PASSWORD },
  ],
  ["userAuth.verifyToken", "query", { token: "a-reset-token" }],
  ["userAuth.login", "mutation", { username: USERNAME, password: PASSWORD }],
  [
    "userAuth.activateAccount",
    "mutation",
    { token: "an-invite-token", password: PASSWORD },
  ],
  ["userAuth.verifyInviteToken", "query", { token: "an-invite-token" }],
];

describe.each(AUTH_PROCEDURES)("%s", (path, type, input) => {
  it("still answers a real limit with the 429 it always has", async () => {
    await exhaust(`${path}:unknown-ip`, 20);

    const { status, error } = await callTrpc(path, type, input);

    expect(status).toBe(429);
    expect(error?.data.code).toBe("TOO_MANY_REQUESTS");
    expect(error?.message).toMatch(
      /^Too many attempts\. Please try again after \d{4}-\d\d-\d\dT[\d:.]+Z$/,
    );
  });

  it.each(OUTAGES)(
    "answers a 503 that says it couldn't check, with Valkey %s",
    async (_name, outage) => {
      const { status, error } = await during(outage, () =>
        callTrpc(path, type, input),
      );

      expect(status).toBe(503);
      expect(error?.data).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        httpStatus: 503,
      });
      expect(error?.message).toBe(app.shared.RATE_LIMIT_UNAVAILABLE_MESSAGE);
    },
  );
});

describe("userAuth.register", () => {
  it.each(OUTAGES)(
    "creates no account with Valkey %s, and does once it's back",
    async (_name, outage) => {
      const register = () =>
        callTrpc("userAuth.register", "mutation", {
          username: "newcomer",
          email: "newcomer@example.test",
          password: PASSWORD,
        });

      await during(outage, register);
      expect(
        await app.storage.storage.getUserByUsername("newcomer"),
      ).toBeUndefined();

      const { status } = await register();
      expect(status).toBe(200);
      expect(
        await app.storage.storage.getUserByUsername("newcomer"),
      ).toBeDefined();
    },
  );
});

// --- MFA -----------------------------------------------------------------------------------

describe("mfa.confirmEnrollment, behind a session", () => {
  let session: string;

  beforeEach(async () => {
    const answer = await signIn({ username: USERNAME, password: PASSWORD });
    expect(answer.status).toBe(200);
    session = answer.sessionCookie!;
    await app.storage.storage.setPendingMfaSecret(
      userId,
      app.totp.generateTotpSecret(),
    );
  });

  const confirm = () =>
    callTrpc(
      "mfa.confirmEnrollment",
      "mutation",
      { password: PASSWORD, code: "000000" },
      session,
    );

  it("still answers a real limit with the 429 it always has", async () => {
    await exhaust(`mfa:mfa.confirmEnrollment:${userId}`, 10);

    const { status, error } = await confirm();

    expect(status).toBe(429);
    expect(error?.message).toMatch(
      /^Too many attempts\. Please try again after /,
    );
  });

  it.each(OUTAGES)(
    "answers a 503 that says it couldn't check, with Valkey %s",
    async (_name, outage) => {
      const { status, error } = await during(outage, confirm);

      expect(status).toBe(503);
      expect(error?.data.code).toBe("SERVICE_UNAVAILABLE");
      expect(error?.message).toBe(app.shared.RATE_LIMIT_UNAVAILABLE_MESSAGE);
    },
  );
});

// --- NextAuth's sign-in --------------------------------------------------------------------

describe("POST /api/auth/callback/credentials", () => {
  it("signs in", async () => {
    const answer = await signIn({ username: USERNAME, password: PASSWORD });

    expect(answer).toMatchObject({ status: 200, error: null });
    expect(answer.sessionCookie).toBeDefined();
  });

  it("still answers a real limit as it always has", async () => {
    await exhaust("auth:credentials-login:unknown-ip", 10);

    const answer = await signIn({ username: USERNAME, password: PASSWORD });

    expect(answer).toMatchObject({
      status: 401,
      error: "Too many login attempts. Please try again later.",
      sessionCookie: undefined,
    });
  });

  it("still answers a wrong password as it always has", async () => {
    const answer = await signIn({ username: USERNAME, password: "wrong" });

    expect(answer).toMatchObject({
      status: 401,
      error: "CredentialsSignin",
      sessionCookie: undefined,
    });
  });

  describe.each(OUTAGES)("with Valkey %s", (_name, outage) => {
    it("answers a 503 with the limiter's own code, and no session", async () => {
      const answer = await during(outage, () =>
        signIn({ username: USERNAME, password: PASSWORD }),
      );

      expect(answer).toMatchObject({
        status: 503,
        error: app.shared.RATE_LIMIT_UNAVAILABLE,
        sessionCookie: undefined,
      });
    });

    it("changes only the status of NextAuth's answer, keeping its headers and cookies", async () => {
      // NextAuth's own answer to a refused sign-in, for its headers.
      const refused = await signIn({ username: USERNAME, password: "wrong" });
      expect(refused.cookieNames).not.toEqual([]);

      const answer = await during(outage, () =>
        signIn({ username: USERNAME, password: PASSWORD }),
      );

      expect(answer.status).toBe(503);
      expect(answer.contentType).toBe(refused.contentType);
      expect(answer.cookieNames).toEqual(refused.cookieNames);
    });

    it("signs in once Valkey is back", async () => {
      await during(outage, () =>
        signIn({ username: USERNAME, password: PASSWORD }),
      );

      await expect(
        signIn({ username: USERNAME, password: PASSWORD }),
      ).resolves.toMatchObject({ status: 200, error: null });
    });
  });

  // The login check passes and Valkey fails before the check that a TOTP code is used once.
  describe.each(OUTAGES)(
    "with a TOTP code, and Valkey %s after the password is checked",
    (_name, outage) => {
      it("answers a 503 rather than calling the code invalid, and takes the same code after", async () => {
        const code = await withTotp();
        const { storage } = app.storage;
        const getMfaSecret = storage.getMfaSecret.bind(storage);
        jest
          .spyOn(storage, "getMfaSecret")
          .mockImplementationOnce(async (id: string) => {
            await outage.begin();
            return getMfaSecret(id);
          });

        let answer: SignInAnswer;
        try {
          answer = await signIn({
            username: USERNAME,
            password: PASSWORD,
            totp: code,
          });
        } finally {
          await outage.end();
        }

        expect(answer).toMatchObject({
          status: 503,
          error: app.shared.RATE_LIMIT_UNAVAILABLE,
          sessionCookie: undefined,
        });
        expect(logged()).not.toContain(code);

        // Its use was never recorded, so it works once, and then it's a replay as before.
        const credentials = {
          username: USERNAME,
          password: PASSWORD,
          totp: code,
        };
        await expect(signIn(credentials)).resolves.toMatchObject({
          status: 200,
          error: null,
        });
        await expect(signIn(credentials)).resolves.toMatchObject({
          status: 401,
          error: "Invalid authenticator or recovery code.",
          sessionCookie: undefined,
        });
      });
    },
  );
});
