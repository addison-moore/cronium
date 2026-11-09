/**
 * The limit on connections to hosts a user chose, through the real routes, against real
 * Postgres and real Valkey, with calls made at the same moment. Each route connects to
 * wherever its user typed, so one signed-in user could hold thousands of sockets at once,
 * and the answers say what listens on the app's own network.
 *
 * Servers here are TCP listeners on loopback: one that accepts and says nothing, as a
 * server whose SSH never answers, and one that closes each connection as it arrives.
 * Counting what reaches them is counting what got past the limit.
 */
// The callers and requests below carry their own identity. The real NextAuth
// stack needs a request scope this suite does not have, and nothing here reaches it.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { randomUUID } from "node:crypto";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { POST as createServerRoute } from "@/app/api/servers/route";
import { PUT as updateServerRoute } from "@/app/api/servers/[id]/route";
import { consumeAtomicRateLimitOrThrow } from "@/lib/security/atomic-rate-limiter";
import {
  CONNECTION_CHECK_LIMITS,
  resetConnectionCheckLimitsForTests,
} from "@/lib/security/connection-check-limit";
import { serversRouter } from "@/server/api/routers/servers";
import { toolsRouter } from "@/server/api/routers/tools";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { servers } from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedServer, seedUser } from "./helpers/seed";

// A Jest project's `testTimeout` has no effect, so this file sets its own.
jest.setTimeout(120_000);

const { atOnce, waiting, perMinute, valkeyAnswerMs } = CONNECTION_CHECK_LIMITS;

// Mounted under the names root.ts uses, because the route-capability inventory is keyed
// by "servers.<procedure>".
const createCaller = createCallerFactory(
  createTRPCRouter({ servers: serversRouter, tools: toolsRouter }),
);

function callerFor(userId: string) {
  return createCaller({
    session: {
      user: { id: userId, sessionVersion: 1 },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as unknown as Session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

async function seedToken(userId: string): Promise<string> {
  const token = `test-token-${randomUUID()}`;
  await storage.createApiToken({
    userId,
    name: "ci",
    token,
    scopes: ["full"],
  } as never);
  return token;
}

function restRequest(
  path: string,
  method: string,
  token: string,
  body: unknown,
) {
  return new NextRequest(`http://localhost:5001/api/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

interface Listener {
  port: number;
  accepted: () => number;
  open: () => number;
  mostOpen: () => number;
  /** Closes what it holds, and every connection from now on as it arrives. */
  release: () => void;
  close: () => Promise<void>;
}

/** Accepts and says nothing, or with `hold` false, closes each connection at once. */
async function listen({ hold = true } = {}): Promise<Listener> {
  const held = new Set<net.Socket>();
  let holding = hold;
  let accepted = 0;
  let open = 0;
  let mostOpen = 0;
  const server = net.createServer((socket) => {
    accepted += 1;
    open += 1;
    mostOpen = Math.max(mostOpen, open);
    socket.on("error", () => undefined);
    socket.on("close", () => {
      open -= 1;
      held.delete(socket);
    });
    if (holding) held.add(socket);
    else socket.destroy();
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  return {
    port: (server.address() as AddressInfo).port,
    accepted: () => accepted,
    open: () => open,
    mostOpen: () => mostOpen,
    release: () => {
      holding = false;
      for (const socket of held) socket.destroy();
    },
    close: () =>
      new Promise<void>((resolve) => {
        holding = false;
        for (const socket of held) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

type Outcome<T> = { value: T } | { error: { code?: string; message: string } };

const outcome = <T>(call: Promise<T>): Promise<Outcome<T>> =>
  call.then(
    (value) => ({ value }),
    (error: { code?: string; message: string }) => ({ error }),
  );

const refusal = <T>(result: Outcome<T>) =>
  "error" in result && result.error.code === "TOO_MANY_REQUESTS"
    ? result.error.message
    : undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => boolean, within = 20_000) {
  const deadline = performance.now() + within;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Never saw ${what}`);
    await sleep(10);
  }
}

const AT_ONCE = /being checked and \d+ more waiting/;
const A_MINUTE = /connections to servers or tools a minute/;

let listeners: Listener[] = [];
let quiet: jest.SpyInstance;

beforeEach(async () => {
  await resetDatabase();
  resetConnectionCheckLimitsForTests();
  // ssh.ts and the routes say a line for every connection.
  quiet = jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(listeners.map((listener) => listener.close()));
  listeners = [];
  quiet.mockRestore();
});

afterAll(async () => {
  await closePool();
});

async function server(options?: { hold?: boolean }) {
  const listener = await listen(options);
  listeners.push(listener);
  return listener;
}

const sshTo = (port: number) => ({
  address: "127.0.0.1",
  port,
  username: "someone",
  password: "anything",
});

describe("one user's checks made at the same moment", () => {
  it(`connect ${atOnce} at a time, ${waiting} wait their turn, the rest are refused at once, and another user's goes straight through`, async () => {
    const silent = await server();
    const caller = callerFor(await seedUser());
    const settled: Outcome<unknown>[] = [];
    const calls = Array.from({ length: 100 }, () =>
      outcome(caller.servers.testConnection(sshTo(silent.port))).then(
        (result) => {
          settled.push(result);
          return result;
        },
      ),
    );

    const refusedAtOnce = 100 - atOnce - waiting;
    await until(
      `${atOnce} connected and ${refusedAtOnce} refused`,
      () => silent.open() === atOnce && settled.length === refusedAtOnce,
    );
    await sleep(300);
    expect(silent.accepted()).toBe(atOnce);
    expect(settled.map(refusal)).toEqual(
      Array.from({ length: refusedAtOnce }, () =>
        expect.stringMatching(AT_ONCE),
      ),
    );

    const someoneElse = outcome(
      callerFor(await seedUser()).servers.testConnection(sshTo(silent.port)),
    );
    await until(
      "another user's check to connect",
      () => silent.accepted() === atOnce + 1,
    );

    // Each waiting check gets its turn as one finishes, until Valkey's count stops the
    // minute's worth.
    silent.release();
    const results = await Promise.all(calls);
    expect(silent.mostOpen()).toBe(atOnce + 1);
    expect(silent.accepted()).toBe(perMinute + 1);
    const refusals = results.map(refusal);
    expect(refusals.filter((m) => m && AT_ONCE.test(m))).toHaveLength(
      refusedAtOnce,
    );
    expect(refusals.filter((m) => m && A_MINUTE.test(m))).toHaveLength(
      atOnce + waiting - perMinute,
    );
    // The rest reached the server, which closed on them.
    const answered = results.filter(
      (result): result is { value: { success: boolean } } => "value" in result,
    );
    expect(answered).toHaveLength(perMinute);
    expect(answered.every(({ value }) => !value.success)).toBe(true);
    await expect(someoneElse).resolves.toMatchObject({
      value: { success: false },
    });
  });

  it("are counted exactly by Valkey, which every app process shares", async () => {
    // Every app process asks the same key at the same moment, so this is what decides
    // whether a second process can get past the minute. withRateLimit let 163 of 1,000
    // through a limit of 10.
    const user = `user-${randomUUID()}`;
    const answers = await Promise.all(
      Array.from({ length: 1_000 }, () =>
        consumeAtomicRateLimitOrThrow(user, "connection-checks", {
          maxRequests: perMinute,
          windowMs: 60_000,
        }),
      ),
    );
    expect(answers.filter(({ allowed }) => allowed)).toHaveLength(perMinute);
  });
});

describe("what the pages check when they open", () => {
  it("tests every tool the Tools page lists at once, more than run at a time, and none is refused", async () => {
    const caller = callerFor(await seedUser());
    const postgres = new URL(process.env.DATABASE_URL!);
    const tools = [];
    for (let n = 0; n < atOnce * 2 + 4; n += 1) {
      tools.push(
        await caller.tools.create({
          name: `Database ${n}`,
          type: "sql",
          credentials: {
            dialect: "postgres",
            host: "127.0.0.1",
            port: Number(postgres.port),
            database: postgres.pathname.slice(1),
            user: decodeURIComponent(postgres.username),
            password: decodeURIComponent(postgres.password),
            ssl: "disable",
          },
        }),
      );
    }

    const results = await Promise.all(
      tools.map(({ id }) => outcome(caller.tools.testConnection({ id }))),
    );
    expect(results).toEqual(
      tools.map(() => ({ value: expect.objectContaining({ success: true }) })),
    );
  });

  it("leaves a server as it was, on every route, when a check is refused", async () => {
    const closing = await server({ hold: false });
    const userId = await seedUser();
    const caller = callerFor(userId);
    const lastChecked = new Date("2026-11-01T00:00:00Z");
    const serverId = await seedServer(userId, {
      address: "127.0.0.1",
      port: closing.port,
      online: true,
      lastChecked,
    });
    const row = async () =>
      (await db.select().from(servers).where(eq(servers.id, serverId)))[0];
    const before = await row();

    const minute = await Promise.all(
      Array.from({ length: perMinute }, () =>
        outcome(caller.servers.testConnection(sshTo(closing.port))),
      ),
    );
    expect(minute.map(refusal)).toEqual(minute.map(() => undefined));
    expect(closing.accepted()).toBe(perMinute);

    // The server's page runs this when it opens.
    expect(
      refusal(await outcome(caller.servers.checkHealth({ id: serverId }))),
    ).toMatch(A_MINUTE);
    const bulk = await caller.servers.bulkOperation({
      serverIds: [serverId],
      operation: "check_health",
    });
    expect(bulk.results).toEqual([
      { id: serverId, success: false, error: expect.stringMatching(A_MINUTE) },
    ]);
    expect(
      refusal(
        await outcome(
          caller.servers.update({ id: serverId, password: "a new one" }),
        ),
      ),
    ).toMatch(A_MINUTE);
    expect(
      refusal(
        await outcome(
          caller.servers.create({
            name: "another",
            ...sshTo(closing.port),
          } as never),
        ),
      ),
    ).toMatch(A_MINUTE);
    expect(await row()).toEqual(before);
    expect(
      await db.select().from(servers).where(eq(servers.userId, userId)),
    ).toHaveLength(1);

    // A change that doesn't connect isn't limited.
    await caller.servers.update({ id: serverId, name: "renamed" });
    expect(await row()).toEqual({
      ...before,
      name: "renamed",
      updatedAt: expect.any(Date),
    });

    const token = await seedToken(userId);
    const created = await createServerRoute(
      restRequest("servers", "POST", token, {
        name: "by api",
        address: "127.0.0.1",
        port: closing.port,
        sshKey: "a key",
      }),
    );
    expect(created.status).toBe(429);
    expect(Number(created.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(created.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
    expect(await created.json()).toEqual({
      error: "Too many connection checks",
      message: expect.stringMatching(A_MINUTE),
    });
    const updated = await updateServerRoute(
      restRequest(`servers/${serverId}`, "PUT", token, { sshKey: "a key" }),
      { params: Promise.resolve({ id: String(serverId) }) },
    );
    expect(updated.status).toBe(429);
    expect(await row()).toMatchObject({ sshKey: before!.sshKey });

    const tool = await caller.tools.create({
      name: "Database",
      type: "sql",
      credentials: {
        dialect: "postgres",
        host: "127.0.0.1",
        port: closing.port,
        database: "db",
        user: "someone",
        ssl: "disable",
      },
    });
    expect(
      refusal(await outcome(caller.tools.testConnection({ id: tool.id }))),
    ).toMatch(A_MINUTE);
    expect(
      refusal(
        await outcome(
          caller.tools.testCredentials({
            type: "sql",
            credentials: tool.credentials,
          }),
        ),
      ),
    ).toMatch(A_MINUTE);
    expect(closing.accepted()).toBe(perMinute);
  });
});

describe("while Valkey can't count", () => {
  /** The limiter and its Valkey client loaded afresh, pointed at `url`. */
  async function limiterWithValkeyAt(url: string) {
    const saved = {
      VALKEY_URL: process.env.VALKEY_URL,
      REDIS_URL: process.env.REDIS_URL,
    };
    process.env.VALKEY_URL = url;
    process.env.REDIS_URL = url;
    let limiter!: typeof import("@/lib/security/connection-check-limit");
    await jest.isolateModulesAsync(async () => {
      limiter = await import("@/lib/security/connection-check-limit");
    });
    return {
      limiter,
      restore: () => Object.assign(process.env, saved),
    };
  }

  let errors: jest.SpyInstance;
  beforeEach(() => {
    errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  const ourWarnings = () =>
    errors.mock.calls.filter(([message]) =>
      String(message).startsWith("Valkey couldn't count connection checks"),
    );

  it("counts in this process, so a minute's worth go through and the next is refused, without waiting on Valkey", async () => {
    const nothing = await server();
    const port = nothing.port;
    await nothing.close();
    listeners = listeners.filter((listener) => listener !== nothing);
    const { limiter, restore } = await limiterWithValkeyAt(
      `redis://127.0.0.1:${port}`,
    );
    try {
      const startedAt = performance.now();
      const results = await Promise.all(
        Array.from({ length: perMinute + 1 }, () =>
          outcome(
            limiter.withConnectionCheckLimit("someone", () =>
              Promise.resolve("ran"),
            ),
          ),
        ),
      );
      expect(performance.now() - startedAt).toBeLessThan(valkeyAnswerMs);
      expect(results.filter((r) => "value" in r)).toHaveLength(perMinute);
      expect(refusal(results[perMinute]!)).toMatch(A_MINUTE);
      expect(ourWarnings()).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it(`goes on after ${valkeyAnswerMs / 1000} seconds when Valkey accepts and never answers, and the next check doesn't wait`, async () => {
    const hung = await server();
    const { limiter, restore } = await limiterWithValkeyAt(
      `redis://127.0.0.1:${hung.port}`,
    );
    try {
      let startedAt = performance.now();
      await expect(
        limiter.withConnectionCheckLimit("someone", () =>
          Promise.resolve("ran"),
        ),
      ).resolves.toBe("ran");
      const firstMs = performance.now() - startedAt;
      expect(firstMs).toBeGreaterThanOrEqual(valkeyAnswerMs - 50);
      expect(firstMs).toBeLessThan(valkeyAnswerMs + 1_000);
      expect(hung.accepted()).toBeGreaterThan(0);

      startedAt = performance.now();
      await expect(
        limiter.withConnectionCheckLimit("someone", () =>
          Promise.resolve("ran"),
        ),
      ).resolves.toBe("ran");
      expect(performance.now() - startedAt).toBeLessThan(500);
      expect(ourWarnings()).toHaveLength(1);
    } finally {
      restore();
    }
  });
});
