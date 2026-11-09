/**
 * A Valkey that accepts connections and never answers, as when its container is paused or
 * the network drops its packets, through the real routes against real Postgres and real
 * Valkey. Every signed-in tRPC and REST call reads its principal through the cache first,
 * and sign-in and MFA count attempts in Valkey and refuse when they can't. With nothing to
 * limit how long a Valkey command may wait, all of them waited for good: with Valkey
 * paused, a signed-in call made no progress in 8 minutes.
 *
 * Valkey sits behind a relay that a test pauses, as `docker pause` does, makes drop what's
 * sent, as a network that loses packets does, or stops, as `docker stop` does.
 */
// The callers and requests below carry their own identity. The real NextAuth stack
// needs a request scope this suite does not have, and nothing here reaches it.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { VALKEY_ANSWER_MS } from "@/lib/valkey-answer-limit";
import { db } from "@/server/db";
import { UserStatus, users } from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import {
  quietRelayTo,
  silentListener,
  type QuietRelay,
} from "./helpers/quiet-valkey";
import { seedUser } from "./helpers/seed";

// A Jest project's `testTimeout` has no effect, so this file sets its own.
jest.setTimeout(60_000);

// Loaded once VALKEY_URL points at the relay, because the cache's client is made as its
// module loads, and everything here loads the cache.
const load = async () => {
  const { createCallerFactory, createTRPCRouter } =
    await import("@/server/api/trpc");
  const { mfaRouter } = await import("@/server/api/routers/mfa");
  const { userAuthRouter } = await import("@/server/api/routers/userAuth");
  return {
    // Mounted under the names root.ts uses, because the route-capability inventory is
    // keyed by "mfa.<procedure>".
    createCaller: createCallerFactory(
      createTRPCRouter({ mfa: mfaRouter, userAuth: userAuthRouter }),
    ),
    cacheModule: await import("@/lib/cache/cache-service"),
    limiter: await import("@/lib/security/atomic-rate-limiter"),
    listServers: (await import("@/app/api/servers/route")).GET,
    storage: (await import("@/server/storage")).storage,
  };
};
let app: Awaited<ReturnType<typeof load>>;
const cache = () => app.cacheModule.cacheService;

let relay: QuietRelay;
let admin: Redis;
let valkeyUrl: string;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(
  what: string,
  done: () => boolean | Promise<boolean>,
  within = 20_000,
): Promise<void> {
  const limit = performance.now() + within;
  while (!(await done())) {
    if (performance.now() > limit)
      throw new Error(`Gave up waiting for ${what}`);
    await sleep(20);
  }
}

/** How long `call` took to settle, and how. Fails rather than wait past `limitMs`. */
async function timed<T>(
  call: Promise<T>,
  limitMs = VALKEY_ANSWER_MS * 5,
): Promise<{ ms: number; settled: { value: T } | { error: unknown } }> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const settled = await Promise.race([
    call.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    ),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`No answer in ${limitMs} ms`)),
        limitMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  return { ms: performance.now() - started, settled };
}

function callerFor(userId: string | null) {
  return app.createCaller({
    session: userId
      ? ({
          user: { id: userId, sessionVersion: 1 },
          expires: new Date(Date.now() + 60_000).toISOString(),
        } as unknown as Session)
      : null,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

async function seedToken(userId: string): Promise<string> {
  const token = `test-token-${randomUUID()}`;
  await app.storage.createApiToken({
    userId,
    name: "ci",
    token,
    scopes: ["full"],
  } as never);
  return token;
}

const listServers = (token: string) =>
  app.listServers(
    new NextRequest("http://localhost:5001/api/servers", {
      headers: { authorization: `Bearer ${token}` },
    }),
  );

const setStatus = (userId: string, status: UserStatus) =>
  db.update(users).set({ status }).where(eq(users.id, userId));

const ONE_MINUTE = { maxRequests: 100, windowMs: 60_000 };

/** Once Valkey answers again, a write goes through and reaches the real Valkey. */
async function cacheWorks(): Promise<boolean> {
  const key = `static:probe-${randomUUID()}`;
  return (
    (await cache().set(key, true, { ttl: 60 })) &&
    (await admin.exists(key)) === 1
  );
}

const limiterWorks = async () =>
  (await app.limiter.consumeAtomicRateLimit(randomUUID(), "probe", ONE_MINUTE))
    .allowed;

/** Closes a cache's client without QUIT, which nothing answers if Valkey doesn't. */
function closeOutright(service: object): void {
  (service as { client?: Redis | null }).client?.disconnect();
}

beforeAll(async () => {
  valkeyUrl = process.env.VALKEY_URL!;
  relay = await quietRelayTo(valkeyUrl);
  admin = new Redis(valkeyUrl);
  process.env.VALKEY_URL = relay.url;
  process.env.REDIS_URL = relay.url;
  app = await load();
});

afterAll(async () => {
  // Bounded, so a cache that's stuck can't keep the file from finishing.
  await Promise.race([cache().disconnect(), sleep(5_000)]).catch(
    () => undefined,
  );
  closeOutright(cache());
  admin.disconnect();
  // The relay stays up. The limiter's client has no way to close, and would try to
  // connect again every few seconds, and log it, for the rest of the run.
  relay.resume();
  relay.restore();
  await closePool();
  // A client logs its closed connection a moment after QUIT, which Jest reports as a log
  // after the tests are done once the file has gone.
  await sleep(200);
});

let quiet: jest.SpyInstance[] = [];

beforeEach(async () => {
  await resetDatabase();
  await admin.flushdb();
  // Every timed-out command and dropped connection is logged.
  quiet = [
    jest.spyOn(console, "error").mockImplementation(() => undefined),
    jest.spyOn(console, "log").mockImplementation(() => undefined),
  ];
  await until("the cache to answer", cacheWorks);
});

afterEach(async () => {
  relay.resume();
  relay.restore();
  await relay.start().catch(() => undefined);
  // The next test starts with Valkey answering, on connections that aren't dropping.
  await until("the cache to answer again", cacheWorks);
  await until("the limiter to answer again", limiterWorks);
  for (const spy of quiet) spy.mockRestore();
});

describe("a signed-in call while Valkey doesn't answer", () => {
  it(`reads the principal from Postgres after ${VALKEY_ANSWER_MS / 1000} s, and the calls after it don't wait`, async () => {
    const userId = await seedUser();
    const caller = callerFor(userId);
    await caller.mfa.getStatus();
    expect(await admin.exists(`principal:v1:${userId}`)).toBe(1);
    // The cached principal is still active. Only Postgres knows it isn't.
    await setStatus(userId, UserStatus.DISABLED);
    await expect(caller.mfa.getStatus()).resolves.toBeDefined();

    relay.pause();
    const first = await timed(caller.mfa.getStatus());
    expect(first.settled).toEqual({
      error: expect.objectContaining({
        code: "UNAUTHORIZED",
        message: "Account is not active",
      }),
    });
    expect(first.ms).toBeGreaterThanOrEqual(VALKEY_ANSWER_MS - 50);
    expect(first.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);

    // The silent connection is closed by now, and the cache skips Valkey until a new one
    // is ready.
    await setStatus(userId, UserStatus.ACTIVE);
    for (let n = 0; n < 5; n += 1) {
      const next = await timed(caller.mfa.getStatus());
      expect(next.settled).toEqual({ value: expect.anything() });
      expect(next.ms).toBeLessThan(500);
    }
    expect(cache().isAvailable()).toBe(false);

    relay.resume();
    await until("the cache to connect again", () => cache().isAvailable());
    await admin.del(`principal:v1:${userId}`);
    await caller.mfa.getStatus();
    expect(await admin.exists(`principal:v1:${userId}`)).toBe(1);
  });

  it("over REST with a bearer token, answers from Postgres too", async () => {
    const userId = await seedUser();
    const token = await seedToken(userId);
    expect((await listServers(token)).status).toBe(200);

    relay.pause();
    const first = await timed(listServers(token));
    expect(first.settled).toEqual({
      value: expect.objectContaining({ status: 200 }),
    });
    expect(first.ms).toBeGreaterThanOrEqual(VALKEY_ANSWER_MS - 50);
    expect(first.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);

    const next = await timed(listServers(token));
    expect(next.settled).toEqual({
      value: expect.objectContaining({ status: 200 }),
    });
    expect(next.ms).toBeLessThan(500);
  });

  it("lets a change to the account finish, and the account's next call sees it", async () => {
    const userId = await seedUser();
    const caller = callerFor(userId);
    await caller.mfa.getStatus();

    relay.pause();
    // Turning MFA off ends the account's sessions and removes its cached principal, and
    // the removal waited on Valkey for good.
    const change = await timed(app.storage.disableMfa(userId));
    expect(change.settled).toEqual({ value: undefined });
    expect(change.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
    // The cached principal would still let this session in. Postgres doesn't.
    await expect(caller.mfa.getStatus()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Session is no longer valid",
    });
  });
});

describe("the cache's own connection", () => {
  /** A new cache service whose first connection goes to `url`. */
  function cacheAt(url: string) {
    const saved = process.env.VALKEY_URL;
    process.env.VALKEY_URL = url;
    try {
      return new app.cacheModule.CacheService();
    } finally {
      process.env.VALKEY_URL = saved;
    }
  }

  it("skips a Valkey that has never answered without waiting, and uses it once it does", async () => {
    relay.pause();
    const late = cacheAt(relay.url);
    try {
      await sleep(200);
      expect(late.isAvailable()).toBe(false);
      const read = await timed(late.get("static:late"));
      expect(read).toEqual({
        ms: expect.any(Number),
        settled: { value: null },
      });
      expect(read.ms).toBeLessThan(200);
      const write = await timed(late.set("static:late", 1, { ttl: 60 }));
      expect(write.settled).toEqual({ value: false });
      expect(write.ms).toBeLessThan(200);

      // Its first PING has failed by now. It used to drop its client then, for good.
      await sleep(VALKEY_ANSWER_MS + 500);
      relay.resume();
      await until("the late cache to connect", () => late.isAvailable());
      expect(await late.set("static:late", 1, { ttl: 60 })).toBe(true);
      expect(await late.get("static:late")).toBe(1);
      expect(await admin.exists("static:late")).toBe(1);
    } finally {
      relay.resume();
      closeOutright(late);
    }
  });

  it("doesn't wait on a listener that accepts and never answers", async () => {
    const silent = await silentListener();
    const mute = cacheAt(silent.url);
    try {
      await until("a connection", () => silent.accepted() > 0);
      const read = await timed(mute.get("static:anything"));
      expect(read.settled).toEqual({ value: null });
      expect(read.ms).toBeLessThan(200);
      expect(mute.isAvailable()).toBe(false);
    } finally {
      closeOutright(mute);
      await silent.close();
    }
  });

  it("doesn't send a write again on the next connection once its caller was told it failed", async () => {
    // A network that loses packets, between a cache of its own and Valkey: the write
    // never reaches Valkey, and the connection it went out on is closed for saying
    // nothing.
    const lossy = await quietRelayTo(valkeyUrl);
    const own = cacheAt(lossy.url);
    try {
      await until("its cache to connect", () => own.isAvailable());
      lossy.drop();
      const write = await timed(
        own.set("static:given-up", "stale", { ttl: 60 }),
      );
      expect(write.settled).toEqual({ value: false });
      expect(write.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);

      lossy.restore();
      await until(
        "its cache to answer",
        async () =>
          (await own.set("static:probe", true, { ttl: 60 })) &&
          (await admin.exists("static:probe")) === 1,
      );
      // ioredis sends what it resends before anything new, so it would be there by now.
      expect(await admin.exists("static:given-up")).toBe(0);
    } finally {
      closeOutright(own);
      await lossy.close();
    }
  });
});

describe("sign-in's limiter", () => {
  it(`refuses after ${VALKEY_ANSWER_MS / 1000} s when Valkey stops answering, and the login route refuses before it checks a password`, async () => {
    const id = `ip-${randomUUID()}`;
    await expect(
      app.limiter.consumeAtomicRateLimit(id, "sign-in", ONE_MINUTE),
    ).resolves.toMatchObject({ allowed: true });

    relay.pause();
    const refused = await timed(
      app.limiter.consumeAtomicRateLimit(id, "sign-in", ONE_MINUTE),
    );
    expect(refused.settled).toEqual({
      value: expect.objectContaining({ allowed: false }),
    });
    expect(refused.ms).toBeGreaterThanOrEqual(VALKEY_ANSWER_MS - 50);
    expect(refused.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);

    const lookups = jest.spyOn(app.storage, "getUserByUsername");
    try {
      const login = await timed(
        callerFor(null).userAuth.login({ username: "someone", password: "x" }),
      );
      expect(login.settled).toEqual({ error: expect.any(Error) });
      expect(login.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
      expect(lookups).not.toHaveBeenCalled();
    } finally {
      lookups.mockRestore();
    }

    relay.resume();
    await until(
      "the limiter to count again",
      async () =>
        (await app.limiter.consumeAtomicRateLimit(id, "sign-in", ONE_MINUTE))
          .allowed,
    );
  });

  it("refuses within the limit when Valkey is stopped, however long it has been down", async () => {
    const id = `ip-${randomUUID()}`;
    await app.limiter.consumeAtomicRateLimit(id, "sign-in", ONE_MINUTE);

    await relay.stop();
    // ioredis waits longer between tries the longer Valkey is down, and a request waited
    // for a try that ended its count: 10 seconds, four seconds into an outage.
    await sleep(4_500);
    const refused = await timed(
      app.limiter.consumeAtomicRateLimit(id, "sign-in", ONE_MINUTE),
    );
    expect(refused.settled).toEqual({
      value: expect.objectContaining({ allowed: false }),
    });
    expect(refused.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
  });

  it("refuses within the limit when its first connection is to a Valkey that never answers", async () => {
    const silent = await silentListener();
    const saved = {
      VALKEY_URL: process.env.VALKEY_URL,
      REDIS_URL: process.env.REDIS_URL,
    };
    process.env.VALKEY_URL = silent.url;
    process.env.REDIS_URL = silent.url;
    try {
      let fresh!: typeof import("@/lib/security/atomic-rate-limiter");
      await jest.isolateModulesAsync(async () => {
        fresh = await import("@/lib/security/atomic-rate-limiter");
      });
      // It reads VALKEY_URL when it first connects.
      const refused = await timed(
        fresh.consumeAtomicRateLimit("someone", "sign-in", ONE_MINUTE),
      );
      expect(refused.settled).toEqual({
        value: expect.objectContaining({ allowed: false }),
      });
      expect(refused.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
      expect(silent.accepted()).toBeGreaterThan(0);
    } finally {
      Object.assign(process.env, saved);
      await silent.close();
    }
  });
});
