/**
 * A database connection that stops answering without closing: a lost host, a firewall
 * dropping packets, a stuck proxy. Nothing errors, so nothing that is waiting on it ever
 * stops waiting, even once the database is back. dropped-connection.test.ts has the
 * other half of this: what happens to a connection that goes.
 *
 * Real Postgres, because what a hung transaction leaves behind is the point. The last
 * section runs the bundle the image runs, through a proxy, since only that shows
 * whether each loop works again without a restart.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { driverError } from "@/lib/pg-errors";
import { closeHungConnections, db, pool } from "@/server/db";
import {
  EventStatus,
  EventTriggerType,
  EventType,
  jobs,
  JobStatus,
  jobTransitions,
  JobType,
  LeaseLossPolicy,
  ScheduleKind,
  systemSettings,
  TimeUnit,
} from "@/shared/schema";
import { hangableDatabase } from "../hangable-database";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedJob, seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(180_000);

const SETTING = "hung-connection-test";

const failureOf = (work: Promise<unknown>) =>
  work.then(
    () => {
      throw new Error("Expected this to fail");
    },
    (error: unknown) => error as Error,
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(
  what: string,
  condition: () => boolean | Promise<boolean>,
  withinMs = 60_000,
) {
  const deadline = Date.now() + withinMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(20);
  }
}

const backendsRunning = async (statement: string) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM pg_stat_activity WHERE query = $1 AND pid <> pg_backend_pid()`,
    [statement],
  );
  return rows.length;
};

const storedSetting = async () => {
  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, SETTING));
  return row?.value;
};

afterAll(async () => {
  await closePool();
});

describe("closing a hung connection", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("fails the transaction, and the next one can't commit what it had done", async () => {
    const SLOW = "SELECT pg_sleep(60)";
    await db
      .insert(systemSettings)
      .values({ key: SETTING, value: "as it was" });

    const failed = failureOf(
      db.transaction(async (tx) => {
        await tx
          .update(systemSettings)
          .set({ value: "from the transaction that failed" })
          .where(eq(systemSettings.key, SETTING));
        await tx.execute(sql.raw(SLOW));
      }),
    );
    await waitUntil(
      "the statement to be running",
      async () => (await backendsRunning(SLOW)) > 0,
    );
    const before = pool.totalCount;

    expect(closeHungConnections(0)).toBe(1);

    const error = await failed;
    expect(driverError(error).message).toMatch(/connection/i);
    expect(pool.totalCount).toBe(before - 1);

    // With query_timeout this client goes back to the pool mid-transaction, and this
    // COMMIT is the one that makes the failed transaction's update permanent.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1`);
    });
    await waitUntil(
      "the backend to stop, well short of its 60 seconds",
      async () => (await backendsRunning(SLOW)) === 0,
      20_000,
    );
    expect(await storedSetting()).toBe("as it was");
  });

  it("doesn't leave a backend waiting on a lock, to run a write nobody is waiting for", async () => {
    await db
      .insert(systemSettings)
      .values({ key: SETTING, value: "as it was" });
    const backendsOnLocks = async () => {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      return rows.length;
    };

    // Not from the pool, or closing what's checked out would close this as well.
    const lock = new Client({ connectionString: process.env.DATABASE_URL });
    await lock.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("LOCK TABLE system_settings IN ACCESS EXCLUSIVE MODE");

      // No transaction, so if this ever got the lock, its write would stand.
      const failed = failureOf(
        db
          .update(systemSettings)
          .set({ value: "written with nobody waiting for it" })
          .where(eq(systemSettings.key, SETTING)),
      );
      await waitUntil(
        "it to wait on the lock",
        async () => (await backendsOnLocks()) === 1,
      );

      expect(closeHungConnections(0)).toBe(1);

      await failed;
      await waitUntil(
        "the backend to stop waiting",
        async () => (await backendsOnLocks()) === 0,
        20_000,
      );
    } finally {
      await lock.query("ROLLBACK");
      await lock.end();
    }
    expect(await storedSetting()).toBe("as it was");
  });

  it("leaves a client alone until it has been held for the limit", async () => {
    const client = await pool.connect();
    try {
      await sleep(20);

      expect(closeHungConnections(60_000)).toBe(0);

      await expect(client.query("SELECT 1 AS one")).resolves.toMatchObject({
        rows: [{ one: 1 }],
      });
    } finally {
      client.release();
    }
  });

  it("has TCP keepalive on, which a proxy like the one below can't show", () => {
    // Measured by hand, in Linux containers with iptables dropping the packets: without
    // it a query that was waiting on an answer when they stopped never heard a thing.
    expect(pool.options).toMatchObject({
      keepAlive: true,
      keepAliveInitialDelayMillis: 30_000,
    });
  });

  it("leaves idle clients alone", async () => {
    await pool.query("SELECT 1");
    const idle = pool.idleCount;
    expect(idle).toBeGreaterThan(0);

    expect(closeHungConnections(0)).toBe(0);

    expect(pool.idleCount).toBe(idle);
  });

  describe("on a database that has stopped answering", () => {
    /** A pool of its own, since the shared one has to keep working. */
    async function withPoolOn(
      databaseUrl: string,
      run: (own: typeof import("@/server/db")) => Promise<void>,
    ) {
      const original = process.env.DATABASE_URL;
      process.env.DATABASE_URL = databaseUrl;
      try {
        await jest.isolateModulesAsync(async () => {
          const own = await import("@/server/db");
          await run(own);
          void own.pool.end().catch(() => undefined);
        });
      } finally {
        process.env.DATABASE_URL = original;
      }
    }

    it("gives back the slot of a transaction stuck on BEGIN", async () => {
      const database = await hangableDatabase(process.env.DATABASE_URL!);
      try {
        await withPoolOn(database.url, async (own) => {
          // An idle client, connected before the hang, as a busy pool always has.
          await own.pool.query("SELECT 1");
          expect(own.pool.idleCount).toBe(1);
          database.hang();

          // Drizzle runs BEGIN outside its try block, so nothing it does can release
          // this client, and no error is coming to do it either.
          const stuck = failureOf(own.db.transaction(async () => undefined));
          await sleep(100);
          expect(own.pool.totalCount).toBe(1);
          expect(own.pool.idleCount).toBe(0);

          expect(own.closeHungConnections(0)).toBe(1);

          expect((await stuck).message).toContain("Failed query: begin");
          expect(own.pool.totalCount).toBe(0);

          database.acceptNewConnections();
          await expect(
            own.db.transaction(async (tx) => {
              const { rows } = await tx.execute(sql`SELECT 1 AS one`);
              return rows;
            }),
          ).resolves.toEqual([{ one: 1 }]);
        });
      } finally {
        database.close();
      }
    });

    it("rejects a plain query on it", async () => {
      const database = await hangableDatabase(process.env.DATABASE_URL!);
      try {
        await withPoolOn(database.url, async (own) => {
          await own.pool.query("SELECT 1");
          database.hang();

          const stuck = failureOf(own.pool.query("SELECT 1"));
          await sleep(100);
          expect(own.closeHungConnections(0)).toBe(1);

          expect((await stuck).message).toBe(
            "Connection terminated unexpectedly",
          );
          expect(own.pool.totalCount).toBe(0);
        });
      } finally {
        database.close();
      }
    });
  });
});

describe("a real worker on a database that stops answering", () => {
  const APP_DIR = path.resolve(__dirname, "../../apps/cronium-app");
  const WORKER_BUNDLE = "dist/hung-connection-test-worker.cjs";

  let database: Awaited<ReturnType<typeof hangableDatabase>>;
  let worker: ChildProcess | null = null;
  let healthPort = 0;
  let output = "";
  let userId = "";

  /** Fails as soon as the worker exits, with what it said on the way out. */
  async function until(
    what: string,
    condition: () => boolean | Promise<boolean>,
    withinMs = 60_000,
  ) {
    const deadline = Date.now() + withinMs;
    while (!(await condition())) {
      if (worker!.exitCode !== null || worker!.signalCode !== null) {
        throw new Error(
          `The worker exited (${worker!.exitCode ?? worker!.signalCode}) waiting for ${what}. Its output:\n${output.slice(-4000)}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for ${what}. The worker's output:\n${output.slice(-4000)}`,
        );
      }
      await sleep(20);
    }
  }

  const freePort = () =>
    new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(port));
      });
    });

  async function startWorker(env: Record<string, string> = {}) {
    output = "";
    healthPort = await freePort();
    worker = spawn(process.execPath, [WORKER_BUNDLE], {
      cwd: APP_DIR,
      env: {
        ...process.env,
        DATABASE_URL: database.url,
        NODE_ENV: "production",
        WORKER_ID: "hung-connection-test",
        WORKER_HEALTH_PORT: String(healthPort),
        WORKER_DISPATCH_INTERVAL_MS: "100",
        WORKER_CLAIM_INTERVAL_MS: "100",
        WORKER_SWEEP_INTERVAL_MS: "100",
        WORKER_DB_CHECKOUT_LIMIT_MS: "3000",
        // Nothing here is old enough to purge, but a worker should never be
        // left with that as the only thing protecting a database.
        CRONIUM_JOB_RETENTION_DAYS: "0",
        CRONIUM_LOG_RETENTION_DAYS: "0",
        CRONIUM_WORKFLOW_RETENTION_DAYS: "0",
        CRONIUM_INCIDENT_RETENTION_DAYS: "0",
        CRONIUM_TOOL_ACTION_LOG_RETENTION_DAYS: "0",
        CRONIUM_TOOL_AUDIT_LOG_RETENTION_DAYS: "0",
        CRONIUM_WEBHOOK_RETENTION_DAYS: "0",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    worker.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    worker.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  }

  const jobStatus = async (id: string) => {
    const [job] = await db
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, id));
    return job?.status;
  };

  /** Due now, so the next dispatcher tick that works turns it into a job. */
  async function expectToDispatch() {
    const eventId = await seedEvent(userId, {
      status: EventStatus.ACTIVE,
      triggerType: EventTriggerType.SCHEDULE,
      scheduleKind: ScheduleKind.INTERVAL,
      scheduleNumber: 1,
      scheduleUnit: TimeUnit.HOURS,
      nextRunAt: new Date(),
    });
    await until(
      `the dispatcher to make a job for event ${eventId}`,
      async () =>
        (
          await db
            .select({ id: jobs.id })
            .from(jobs)
            .where(eq(jobs.eventId, eventId))
        ).length > 0,
    );
  }

  /** A job whose tool action fails at once. */
  async function queueQuickJob() {
    const eventId = await seedEvent(userId, {
      type: EventType.TOOL_ACTION,
      toolActionConfig: { toolType: "slack", actionId: "hung-connection-test" },
    });
    return seedJob(eventId, userId, { type: JobType.TOOL_ACTION, payload: {} });
  }

  async function expectToClaim() {
    const jobId = await queueQuickJob();
    await until(
      `job ${jobId} to be claimed`,
      async () => (await jobStatus(jobId)) !== JobStatus.QUEUED,
    );
  }

  /** Running, under a lease that ran out with nobody left to renew it. */
  async function expectToSweep() {
    const jobId = await seedJob(await seedEvent(userId), userId, {
      status: JobStatus.RUNNING,
      orchestratorId: "gone",
      startedAt: new Date(Date.now() - 120_000),
      leaseExpiresAt: new Date(Date.now() - 60_000),
      leaseLossPolicy: LeaseLossPolicy.FAIL,
    });
    await until(
      `job ${jobId} to be swept`,
      async () => (await jobStatus(jobId)) !== JobStatus.RUNNING,
    );
  }

  async function expectToDrainOutbox() {
    const jobId = await seedJob(await seedEvent(userId), userId);
    const [transition] = await db
      .insert(jobTransitions)
      .values({ jobId, toStatus: JobStatus.QUEUED, actor: "hung-connection" })
      .returning({ id: jobTransitions.id });
    await until(`transition ${transition!.id} to be drained`, async () => {
      const [row] = await db
        .select({ processedAt: jobTransitions.processedAt })
        .from(jobTransitions)
        .where(eq(jobTransitions.id, transition!.id));
      return !!row?.processedAt;
    });
  }

  const expectEveryLoopToWork = () =>
    Promise.all([
      expectToDispatch(),
      expectToClaim(),
      expectToSweep(),
      expectToDrainOutbox(),
    ]);

  const closedHungConnections = () => output.includes("presumed hung");

  const timesListenWentActive = () =>
    output.split("[Worker] LISTEN active").length - 1;

  /** Nothing polls for this job, so only a notification can get it claimed. */
  async function expectNotificationToClaim() {
    const jobId = await queueQuickJob();
    await pool.query("SELECT pg_notify('job_queued', $1)", [jobId]);
    await until(
      `job ${jobId} to be claimed on its notification`,
      async () => (await jobStatus(jobId)) !== JobStatus.QUEUED,
    );
  }

  const CLAIM_ONLY_WHEN_NOTIFIED = {
    WORKER_CLAIM_INTERVAL_MS: String(60 * 60_000),
    WORKER_LISTEN_PROBE_INTERVAL_MS: "200",
  };

  beforeAll(() => {
    execFileSync(
      "pnpm",
      ["run", "build:worker", `--outfile=${WORKER_BUNDLE}`],
      { cwd: APP_DIR, stdio: "pipe" },
    );
  });

  afterAll(() => {
    fs.rmSync(path.join(APP_DIR, WORKER_BUNDLE), { force: true });
  });

  beforeEach(async () => {
    await resetDatabase();
    userId = await seedUser();
    database = await hangableDatabase(process.env.DATABASE_URL!);
  });

  afterEach(() => {
    // Before the next test truncates what it might be holding: a backend caught in a
    // transaction keeps its locks until this closes its side of the proxy.
    worker?.kill("SIGKILL");
    worker = null;
    database.close();
  });

  it("dispatches, claims, sweeps and drains its outbox again, without a restart", async () => {
    await startWorker();
    await expectEveryLoopToWork();

    // Long enough for the loops, on 100 ms intervals, to get stuck on the connections
    // the pool has open. They stay silent from here on, whatever happens next.
    database.hang();
    await sleep(1000);
    database.acceptNewConnections();

    await expectEveryLoopToWork();
    // And not just once, as a loop might if it had only been waiting its turn.
    await expectEveryLoopToWork();

    expect(worker!.exitCode).toBeNull();
    expect(closedHungConnections()).toBe(true);
    expect(output).not.toMatch(/loop error: Failed query/);
  });

  it("reconnects a LISTEN connection that has stopped answering", async () => {
    await startWorker(CLAIM_ONLY_WHEN_NOTIFIED);
    await until("LISTEN", () => timesListenWentActive() === 1);
    await expectNotificationToClaim();

    database.hang();
    await sleep(1000);
    database.acceptNewConnections();

    await until("LISTEN again", () => timesListenWentActive() === 2);
    await expectNotificationToClaim();
    expect(output).toContain("LISTEN connection stopped answering");
  });

  it("opens its health endpoint when it starts during a hang, and works once it ends", async () => {
    database.hang();

    await startWorker();
    await until("the health endpoint", () =>
      output.includes("Health endpoint on"),
    );
    const { status } = await fetch(`http://127.0.0.1:${healthPort}/health`);
    expect(status).toBe(503);

    database.acceptNewConnections();
    await expectEveryLoopToWork();
  });

  it.each(["", "soon"])(
    "doesn't close every connection when the limit is set to %j",
    async (limit) => {
      await startWorker({ WORKER_DB_CHECKOUT_LIMIT_MS: limit });
      await until("LISTEN", () => timesListenWentActive() === 1);

      // Queries this short are rarely running when the check comes round, so this
      // makes one wait through a few of them. A limit read as 0 would close it.
      const lock = await pool.connect();
      try {
        await lock.query("BEGIN");
        await lock.query("LOCK TABLE events IN ACCESS EXCLUSIVE MODE");
        await sleep(3000);
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
      }

      await expectEveryLoopToWork();
      expect(closedHungConnections()).toBe(false);
    },
  );
});
