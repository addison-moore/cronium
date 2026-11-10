/**
 * The socket security store and the execution-token revocation store while Valkey
 * accepts connections and never answers, as when its container is paused or the network
 * drops its packets, through the real routes against real Postgres and real Valkey.
 *
 * Each store has its own ioredis client, and neither had a time limit. A socket
 * handshake consumes its ticket there, and an admin's change that ends a user's sessions
 * checks the store before writing and publishes a revocation after, so both waited for
 * good. So did every job's end, on its revocation marker.
 *
 * Only these two stores go through the relay, which a test pauses, as `docker pause`
 * does, or has stop answering from a given command on. The cache stays on Valkey itself,
 * so what's timed here is these stores alone. valkey-not-answering.test.ts covers the
 * cache.
 */
// The callers here carry their own identity. The real NextAuth stack needs a request
// scope this suite does not have, and nothing here reaches it.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import type { Session } from "next-auth";
import { Server } from "socket.io";
import { io as connectSocket } from "socket.io-client";
import { VALKEY_ANSWER_MS } from "@/lib/valkey-answer-limit";
import { db } from "@/server/db";
import type { SocketSecurityEvent } from "@/server/socket-security-store";
import { JobStatus, UserRole, UserStatus, jobs, users } from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import {
  quietRelayTo,
  silentListener,
  type QuietRelay,
} from "./helpers/quiet-valkey";
import { seedEvent, seedJob, seedUser } from "./helpers/seed";

// A Jest project's `testTimeout` has no effect, so this file sets its own.
jest.setTimeout(60_000);

const CHANNEL = "cronium:socket-security:v1";

// Loaded while VALKEY_URL is still Valkey itself, so the cache, whose client is made as
// its module loads, connects there. The two stores read VALKEY_URL when first used.
const load = async () => {
  const { createCallerFactory, createTRPCRouter } =
    await import("@/server/api/trpc");
  const { adminRouter } = await import("@/server/api/routers/admin");
  const { jobsRouter } = await import("@/server/api/routers/jobs");
  return {
    // Mounted under the names root.ts uses, because the route-capability inventory is
    // keyed by "admin.<procedure>" and "jobs.<procedure>".
    createCaller: createCallerFactory(
      createTRPCRouter({ admin: adminRouter, jobs: jobsRouter }),
    ),
    cacheModule: await import("@/lib/cache/cache-service"),
    logs: await import("@/server/logs-websocket"),
    tickets: await import("@/lib/socket-ticket"),
    store: await import("@/server/socket-security-store"),
    revocation: await import("@/lib/security/execution-token-revocation"),
  };
};
let app: Awaited<ReturnType<typeof load>>;

let relay: QuietRelay;
let admin: Redis;
let valkeyUrl: string;
let io: Server;
let socketPort: number;

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

function callerFor(userId: string, role: UserRole = UserRole.USER) {
  return app.createCaller({
    session: {
      user: { id: userId, role, sessionVersion: 1 },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as unknown as Session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

const toggle = (adminId: string, id: string, status: UserStatus) =>
  callerFor(adminId, UserRole.ADMIN).admin.toggleUserStatus({ id, status });

async function account(id: string) {
  const [row] = await db
    .select({ status: users.status, sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, id));
  return row;
}

/** A Socket.IO handshake on /logs, through its ticket middleware, as a browser makes. */
async function handshake(userId: string): Promise<string> {
  const { ticket } = app.tickets.mintSocketTicket(userId, "logs");
  const socket = connectSocket(`http://127.0.0.1:${socketPort}/logs`, {
    path: "/api/socketio",
    auth: { ticket },
    reconnection: false,
    transports: ["websocket"],
    forceNew: true,
  });
  try {
    return await new Promise<string>((resolve) => {
      socket.once("connect", () => resolve("connected"));
      socket.once("connect_error", (error) => resolve(error.message));
    });
  } finally {
    socket.disconnect();
  }
}

async function queuedJob(userId: string): Promise<string> {
  return seedJob(await seedEvent(userId), userId);
}

async function jobStatus(id: string) {
  const [row] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, id));
  return row?.status;
}

const marker = (jobId: string) =>
  admin.exists(app.revocation.revocationKey(jobId));

/** A subscriber as server.ts makes one, whose connections go to `url`. */
async function subscribeThrough(url: string, heard: SocketSecurityEvent[]) {
  const saved = process.env.VALKEY_URL;
  process.env.VALKEY_URL = url;
  try {
    return await app.store.subscribeToSocketSecurityEvents((event) => {
      heard.push(event);
    });
  } finally {
    process.env.VALKEY_URL = saved;
  }
}

const revocation = (userId: string) =>
  JSON.stringify({
    v: 1,
    type: "revoke-user",
    userId,
    reason: "test",
    issuedAt: new Date().toISOString(),
  });

const heardFor = (heard: SocketSecurityEvent[], userId: string) =>
  heard.some((event) => event.userId === userId);

beforeAll(async () => {
  valkeyUrl = process.env.VALKEY_URL!;
  admin = new Redis(valkeyUrl);
  relay = await quietRelayTo(valkeyUrl);
  app = await load();
  process.env.VALKEY_URL = relay.url;
  process.env.REDIS_URL = relay.url;

  // The /logs namespace as server.ts sets it up, ticket middleware and all.
  const httpServer = http.createServer();
  io = new Server(httpServer, { path: "/api/socketio" });
  app.logs.initializeLogsWebSocket(io);
  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", () => resolve()),
  );
  socketPort = (httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  relay.resume();
  relay.restore();
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await app.store.closeSocketSecurityStore();
  // Bounded, so a cache that's stuck can't keep the file from finishing.
  await Promise.race([
    app.cacheModule.cacheService.disconnect(),
    sleep(5_000),
  ]).catch(() => undefined);
  admin.disconnect();
  // The relay stays up. The revocation store's client has no way to close, and would
  // try to connect again every few seconds, and log it, for the rest of the run.
  await closePool();
  // A client logs its closed connection a moment after QUIT, which Jest reports as a log
  // after the tests are done once the file has gone.
  await sleep(200);
});

let quiet: jest.SpyInstance[] = [];

beforeEach(async () => {
  await resetDatabase();
  await admin.flushdb();
  // Every timed-out command, dropped connection and unsent revocation is logged.
  quiet = [
    jest.spyOn(console, "error").mockImplementation(() => undefined),
    jest.spyOn(console, "warn").mockImplementation(() => undefined),
    jest.spyOn(console, "log").mockImplementation(() => undefined),
  ];
});

afterEach(async () => {
  relay.resume();
  relay.restore();
  // Every connection through the relay goes, so a client left on one that stopped
  // answering connects again whatever its limits. Otherwise one test's silent
  // connection fails every later test in this hook, rather than in the test itself.
  await relay.stop();
  await relay.start();
  // The next test starts with both stores answering.
  await until("the socket store to answer again", () =>
    app.store.assertSocketSecurityStoreAvailable().then(
      () => true,
      () => false,
    ),
  );
  await until("the revocation store to answer again", async () => {
    const probe = `probe-${randomUUID()}`;
    await app.revocation.revokeJobExecutionTokens(probe);
    return (await marker(probe)) === 1;
  });
  for (const spy of quiet) spy.mockRestore();
});

describe("an admin's change that ends a user's sessions, while Valkey doesn't answer", () => {
  it(`is refused within ${VALKEY_ANSWER_MS / 1000} s with nothing written, and goes through once Valkey answers`, async () => {
    const adminId = await seedUser({ role: UserRole.ADMIN });
    const target = await seedUser({ status: UserStatus.ACTIVE });
    await toggle(adminId, target, UserStatus.DISABLED);
    const before = await account(target);

    relay.pause();
    // The change checks for the store before it writes. The first check waits on the
    // connection Valkey stopped answering, the second on the next one.
    const first = await timed(toggle(adminId, target, UserStatus.ACTIVE));
    expect(first.settled).toEqual({
      error: expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
    });
    expect(first.ms).toBeGreaterThanOrEqual(VALKEY_ANSWER_MS - 50);
    expect(first.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
    expect(await account(target)).toEqual(before);
    const second = await timed(toggle(adminId, target, UserStatus.ACTIVE));
    expect(second.settled).toEqual({
      error: expect.objectContaining({ code: "INTERNAL_SERVER_ERROR" }),
    });
    expect(second.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
    expect(await account(target)).toEqual(before);

    relay.resume();
    await until("the change to go through", () =>
      toggle(adminId, target, UserStatus.ACTIVE).then(
        () => true,
        () => false,
      ),
    );
    expect(await account(target)).toMatchObject({ status: UserStatus.ACTIVE });
  });

  it("answers once the change has committed, when only the revocation can't be sent", async () => {
    const adminId = await seedUser({ role: UserRole.ADMIN });
    const target = await seedUser({ status: UserStatus.ACTIVE });
    await toggle(adminId, target, UserStatus.ACTIVE);
    const before = await account(target);

    // The check before the write is answered, and Valkey stops answering at the
    // PUBLISH after it.
    relay.dropFrom(/PUBLISH/i);
    const change = await timed(toggle(adminId, target, UserStatus.DISABLED));
    expect(change.settled).toEqual({ value: expect.anything() });
    expect(change.ms).toBeGreaterThanOrEqual(VALKEY_ANSWER_MS - 50);
    expect(change.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
    expect(await account(target)).toEqual({
      status: UserStatus.DISABLED,
      sessionVersion: before!.sessionVersion + 1,
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `Couldn't tell socket servers to disconnect user ${target} (user authorization changed)`,
      ),
      expect.anything(),
    );
  });
});

describe("a socket handshake while Valkey doesn't answer", () => {
  it(`is refused within ${VALKEY_ANSWER_MS / 1000} s, and a new ticket connects once Valkey answers`, async () => {
    const userId = await seedUser({ status: UserStatus.ACTIVE });
    expect(await handshake(userId)).toBe("connected");

    relay.pause();
    const first = await timed(handshake(userId));
    expect(first.settled).toEqual({ value: "Authentication failed" });
    expect(first.ms).toBeGreaterThanOrEqual(VALKEY_ANSWER_MS - 50);
    expect(first.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
    const second = await timed(handshake(userId));
    expect(second.settled).toEqual({ value: "Authentication failed" });
    expect(second.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);

    relay.resume();
    await until(
      "a handshake to connect",
      async () => (await handshake(userId)) === "connected",
    );
  });
});

describe("the revocation subscriber", () => {
  it("isn't closed for being quiet, and hears what waited while Valkey didn't answer", async () => {
    const own = await quietRelayTo(valkeyUrl);
    const heard: SocketSecurityEvent[] = [];
    const unsubscribe = await subscribeThrough(own.url, heard);
    try {
      // Nothing sent for longer than socketTimeout.
      await sleep(VALKEY_ANSWER_MS * 2 + 500);
      await admin.publish(CHANNEL, revocation("after-quiet"));
      await until("the subscriber to hear", () =>
        heardFor(heard, "after-quiet"),
      );

      own.pause();
      await admin.publish(CHANNEL, revocation("while-paused"));
      await sleep(VALKEY_ANSWER_MS + 500);
      expect(heardFor(heard, "while-paused")).toBe(false);
      own.resume();
      await until("the subscriber to hear what waited", () =>
        heardFor(heard, "while-paused"),
      );
      // All of it on the connection it made first.
      expect(own.accepted()).toBe(1);
    } finally {
      await unsubscribe();
      await own.close();
    }
  });

  it("subscribes again when a new connection's SUBSCRIBE goes unanswered", async () => {
    const own = await quietRelayTo(valkeyUrl);
    const heard: SocketSecurityEvent[] = [];
    const unsubscribe = await subscribeThrough(own.url, heard);
    try {
      // The connection drops. The next one answers the ready check, then not the
      // SUBSCRIBE, and is closed for it. The one after that has to subscribe too.
      own.dropFrom(/SUBSCRIBE/i);
      await own.stop();
      await own.start();
      await until("a third connection", () => own.accepted() >= 3);
      await until("the subscriber to hear", async () => {
        await admin.publish(CHANNEL, revocation("after-reconnect"));
        await sleep(100);
        return heardFor(heard, "after-reconnect");
      });
      expect(await admin.call("PUBSUB", "NUMSUB", CHANNEL)).toEqual([
        CHANNEL,
        1,
      ]);
    } finally {
      await unsubscribe();
      await own.close();
    }
  });

  it(`fails within ${VALKEY_ANSWER_MS / 1000} s when its first SUBSCRIBE goes unanswered, and stops connecting`, async () => {
    const own = await quietRelayTo(valkeyUrl);
    try {
      own.dropFrom(/SUBSCRIBE/i);
      const refused = await timed(subscribeThrough(own.url, []));
      expect(refused.settled).toEqual({
        error: expect.objectContaining({ message: expect.any(String) }),
      });
      expect(refused.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
      const connections = own.accepted();
      await sleep(1_500);
      expect(own.accepted()).toBe(connections);
    } finally {
      await own.close();
    }
  });
});

describe("a job's end while Valkey doesn't answer", () => {
  it(`answers jobs.cancel within ${VALKEY_ANSWER_MS / 1000} s with the job cancelled`, async () => {
    const owner = await seedUser({ status: UserStatus.ACTIVE });
    const warm = await queuedJob(owner);
    const first = await queuedJob(owner);
    const second = await queuedJob(owner);
    const after = await queuedJob(owner);
    await callerFor(owner).jobs.cancel({ jobId: warm });
    expect(await marker(warm)).toBe(1);

    relay.pause();
    // The first write goes out on the connection Valkey stopped answering, the second
    // waits for one that answers.
    for (const jobId of [first, second]) {
      const cancelled = await timed(callerFor(owner).jobs.cancel({ jobId }));
      expect(cancelled.settled).toEqual({ value: expect.anything() });
      expect(cancelled.ms).toBeGreaterThanOrEqual(VALKEY_ANSWER_MS - 50);
      expect(cancelled.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
      expect(await jobStatus(jobId)).toBe(JobStatus.CANCELLED);
    }

    relay.resume();
    await callerFor(owner).jobs.cancel({ jobId: after });
    await until(
      "its revocation to be written",
      async () => (await marker(after)) === 1,
    );
  });

  it("writes a revocation its job stopped waiting for once Valkey answers again", async () => {
    const owner = await seedUser({ status: UserStatus.ACTIVE });
    const warm = await queuedJob(owner);
    const first = await queuedJob(owner);
    const second = await queuedJob(owner);
    await callerFor(owner).jobs.cancel({ jobId: warm });

    // A network that loses packets, so nothing written while it does arrives later
    // by itself, as it can from a paused Valkey's socket buffer.
    relay.drop();
    for (const jobId of [first, second]) {
      const cancelled = await timed(callerFor(owner).jobs.cancel({ jobId }));
      expect(cancelled.settled).toEqual({ value: expect.anything() });
      expect(cancelled.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
    }
    // Long enough for ioredis to fail what it had queued too: a new connection whose
    // ready check goes unanswered takes every waiting command with it.
    await sleep(VALKEY_ANSWER_MS + 500);
    expect(await marker(first)).toBe(0);
    expect(await marker(second)).toBe(0);

    relay.restore();
    await until(
      "both revocations to be written",
      async () => (await marker(first)) === 1 && (await marker(second)) === 1,
    );
  });
});

describe("a first connection to a Valkey that never answers", () => {
  it(`refuses a ticket and the check before an admin's change, and gives up a revocation write, within ${VALKEY_ANSWER_MS / 1000} s`, async () => {
    const silent = await silentListener();
    const saved = {
      VALKEY_URL: process.env.VALKEY_URL,
      REDIS_URL: process.env.REDIS_URL,
    };
    process.env.VALKEY_URL = silent.url;
    process.env.REDIS_URL = silent.url;
    let store: typeof import("@/server/socket-security-store") | undefined;
    try {
      let revocationStore!: typeof import("@/lib/security/execution-token-revocation");
      // Copies of their own, which connect when first used, to the listener.
      await jest.isolateModulesAsync(async () => {
        store = await import("@/server/socket-security-store");
        revocationStore =
          await import("@/lib/security/execution-token-revocation");
      });
      // Each took 5 s, the time a connection was given.
      const check = await timed(store!.assertSocketSecurityStoreAvailable());
      expect(check.settled).toEqual({
        error: expect.objectContaining({ message: expect.any(String) }),
      });
      expect(check.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
      const now = Math.floor(Date.now() / 1000);
      const ticket = await timed(
        store!.consumeSocketTicketOnce(randomUUID(), now + 30, now),
      );
      expect(ticket.settled).toEqual({
        error: expect.objectContaining({ message: expect.any(String) }),
      });
      expect(ticket.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
      const write = await timed(
        revocationStore.revokeJobExecutionTokens("job-first-connection"),
      );
      expect(write.settled).toEqual({ value: undefined });
      expect(write.ms).toBeLessThan(VALKEY_ANSWER_MS + 1_000);
      expect(silent.accepted()).toBeGreaterThan(0);
    } finally {
      Object.assign(process.env, saved);
      await store?.closeSocketSecurityStore();
      await silent.close();
    }
  });
});
