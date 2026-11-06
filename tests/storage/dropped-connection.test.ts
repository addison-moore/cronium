/**
 * A database connection dropping while a client is in use. pg rejects what's
 * running and also emits `error`, and with nothing listening that ends any process
 * with no uncaughtException handler. Jest fails whichever test is running when it
 * happens, which is how the tests here notice it.
 *
 * Real Postgres and real sockets on purpose: the order things arrive in is the point,
 * and a fake client wouldn't have one. The last section runs the bundle the image
 * runs, because a worker that stays up can still have stopped working.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { driverError } from "@/lib/pg-errors";
import { db, pool } from "@/server/db";
import {
  EventStatus,
  EventTriggerType,
  EventType,
  jobs,
  JobStatus,
  jobTransitions,
  JobType,
  ScheduleKind,
  TimeUnit,
  toolCredentials,
} from "@/shared/schema";
import { postgresDriver } from "@/tools/plugins/sql/drivers/postgres";
import type { SqlCredentials } from "@/tools/plugins/sql/schemas";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedJob, seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(60_000);

const KILLS_OWN_CONNECTION =
  "SELECT pg_terminate_backend(pg_backend_pid()), pg_sleep(5)";

/** Which of these a closed socket gives depends on what was unread or being sent. */
const CONNECTION_LOST = /Connection terminated unexpectedly|ECONNRESET|EPIPE/;

/** Closes the socket as the pool hands the client out, before anything is sent. */
const dropConnectionOf = (client: PoolClient) => {
  client.connection.stream.destroy();
};

const workingTransaction = () =>
  db.transaction(async (tx) => {
    const { rows } = await tx.execute(sql`SELECT 1 AS one`);
    return rows;
  });

const failureOf = (work: Promise<unknown>) =>
  work.then(
    () => {
      throw new Error("Expected this to fail");
    },
    (error: unknown) => error as Error,
  );

/**
 * A proxy to the database that closes a connection as soon as the client sends a
 * statement matching `dropOn`, the way a restart or a network fault would catch one.
 * Postgres can't do this to itself on BEGIN or LISTEN: no trigger runs for them.
 */
async function droppableDatabase(databaseUrl: string) {
  const target = new URL(databaseUrl);
  const sockets = new Set<net.Socket>();
  let pattern = /^$/;
  let left = 0;
  let dropped = 0;

  /** Whether this write opens with a Query or a Parse message for that statement. */
  const matches = (chunk: Buffer) =>
    left > 0 &&
    (chunk[0] === 0x51 || chunk[0] === 0x50) &&
    pattern.test(chunk.toString("latin1", 5).replace(/^\0/, ""));

  const proxy = net.createServer((client) => {
    const server = net.connect(Number(target.port), target.hostname);
    const closeBoth = () => {
      client.destroy();
      server.destroy();
    };
    for (const socket of [client, server]) {
      sockets.add(socket);
      socket.on("error", () => undefined);
      socket.on("close", closeBoth);
    }
    client.on("data", (chunk) => {
      if (matches(chunk)) {
        left--;
        dropped++;
        closeBoth();
        return;
      }
      server.write(chunk);
    });
    server.on("data", (chunk) => client.write(chunk));
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));

  const url = new URL(databaseUrl);
  url.hostname = "127.0.0.1";
  url.port = String((proxy.address() as net.AddressInfo).port);

  return {
    url: url.toString(),
    dropOn: (statement: RegExp, times: number) => {
      pattern = statement;
      left = times;
    },
    dropped: () => dropped,
    close: () => {
      sockets.forEach((socket) => socket.destroy());
      proxy.close();
    },
  };
}

function credentialsFor(databaseUrl: string): SqlCredentials {
  const { hostname, port, pathname, username, password } = new URL(databaseUrl);
  return {
    dialect: "postgres",
    host: hostname,
    port: Number(port),
    database: pathname.slice(1),
    user: username,
    password,
    ssl: "disable",
  };
}

afterAll(async () => {
  await closePool();
});

describe("a checked-out client losing its connection", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("rejects the transaction, and the next one works", async () => {
    const error = await failureOf(
      db.transaction((tx) => tx.execute(sql.raw(KILLS_OWN_CONNECTION))),
    );

    expect(driverError(error).message).toMatch(/connection/i);
    await expect(workingTransaction()).resolves.toEqual([{ one: 1 }]);
  });

  it("gives the slot back when it goes on BEGIN, which Drizzle never releases", async () => {
    // One more than the pool holds, so that any one slot kept would show.
    const drops = pool.options.max! + 1;

    for (let i = 0; i < drops; i++) {
      pool.once("acquire", dropConnectionOf);
      await expect(db.transaction(async () => undefined)).rejects.toThrow(
        "Failed query: begin",
      );
    }

    expect(pool.totalCount).toBeLessThan(pool.options.max!);
    await expect(workingTransaction()).resolves.toEqual([{ one: 1 }]);
    expect(pool.waitingCount).toBe(0);
  });

  it("gives the slot back at once, with the transaction still running", async () => {
    let queryAfterTheDrop: Promise<unknown> | undefined;

    const error = await failureOf(
      db.transaction(async (tx) => {
        const { rows } = await tx.execute<{ pid: number }>(
          sql`SELECT pg_backend_pid() AS pid`,
        );
        const removed = new Promise((resolve) => {
          pool.once("remove", resolve);
        });

        await pool.query("SELECT pg_terminate_backend($1)", [rows[0]!.pid]);
        await removed;

        queryAfterTheDrop = tx.execute(sql`SELECT 1`);
        await queryAfterTheDrop;
      }),
    );

    await expect(queryAfterTheDrop).rejects.toThrow();
    // The holder's own release comes after ours, and pg-pool throws on a second
    // one. Thrown from Drizzle's finally, that would be the error seen here.
    expect(String(error)).not.toMatch(/released/);
    await expect(workingTransaction()).resolves.toEqual([{ one: 1 }]);
  });

  it("rejects a plain query once, and gives the slot back", async () => {
    const before = pool.totalCount;
    pool.once("acquire", dropConnectionOf);

    await expect(pool.query("SELECT 1")).rejects.toThrow(
      "Connection terminated unexpectedly",
    );

    expect(pool.totalCount).toBeLessThanOrEqual(before);
    await expect(pool.query("SELECT 1 AS one")).resolves.toMatchObject({
      rows: [{ one: 1 }],
    });
  });

  it("logs nothing: whoever holds the client gets the rejection", async () => {
    await failureOf(
      db.transaction((tx) => tx.execute(sql.raw(KILLS_OWN_CONNECTION))),
    );

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("still logs an idle client that loses its connection, once", async () => {
    const goingIdle = await pool.connect();
    const other = await pool.connect();
    const { rows } = await goingIdle.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    goingIdle.release();
    const reported = new Promise((resolve) => {
      pool.once("error", resolve);
    });

    await other.query("SELECT pg_terminate_backend($1)", [rows[0]!.pid]);
    other.release();
    await reported;

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe("Unexpected error on idle client");
  });
});

describe("the SQL tool's connection to someone's own database", () => {
  const readOptions = {
    maxRows: 10,
    maxBytes: 1_000_000,
    timeoutMs: 20_000,
  };
  let database: Awaited<ReturnType<typeof droppableDatabase>>;

  beforeEach(async () => {
    database = await droppableDatabase(process.env.DATABASE_URL!);
  });

  afterEach(() => {
    database.close();
  });

  // Postgres says why first, so the driver can be on its way out before the socket
  // closes. A connection that just goes gives it no such warning.
  it("rejects a read the server ends, rather than waiting for the cursor to close", async () => {
    await expect(
      postgresDriver.query(
        credentialsFor(process.env.DATABASE_URL!),
        KILLS_OWN_CONNECTION,
        {},
        readOptions,
      ),
    ).rejects.toThrow("terminating connection");
  }, 15_000);

  it("rejects a read whose connection just goes", async () => {
    database.dropOn(/^SELECT 1/, 1);

    await expect(
      postgresDriver.query(
        credentialsFor(database.url),
        "SELECT 1",
        {},
        readOptions,
      ),
    ).rejects.toThrow(CONNECTION_LOST);
  }, 15_000);

  it("rejects a read whose connection goes before it has a cursor", async () => {
    database.dropOn(/^BEGIN READ ONLY/, 1);

    await expect(
      postgresDriver.query(
        credentialsFor(database.url),
        "SELECT 1",
        {},
        readOptions,
      ),
    ).rejects.toThrow(CONNECTION_LOST);
  }, 15_000);

  it("rejects a write whose connection just goes", async () => {
    database.dropOn(/^SELECT 1/, 1);

    await expect(
      postgresDriver.execute(
        credentialsFor(database.url),
        "SELECT 1",
        {},
        {
          timeoutMs: 20_000,
        },
      ),
    ).rejects.toThrow(CONNECTION_LOST);
  }, 15_000);

  it("still reads when nothing goes wrong", async () => {
    await expect(
      postgresDriver.query(
        credentialsFor(database.url),
        "SELECT 1 AS one",
        {},
        readOptions,
      ),
    ).resolves.toMatchObject({ rows: [{ one: 1 }] });
  }, 15_000);
});

describe("a real worker", () => {
  const APP_DIR = path.resolve(__dirname, "../../apps/cronium-app");
  const WORKER_BUNDLE = "dist/dropped-connection-test-worker.cjs";

  let database: Awaited<ReturnType<typeof droppableDatabase>>;
  let worker: ChildProcess;
  let output = "";

  /** Fails as soon as the worker exits, with what it said on the way out. */
  async function until(
    what: string,
    condition: () => boolean | Promise<boolean>,
  ) {
    const deadline = Date.now() + 30_000;
    while (!(await condition())) {
      if (worker.exitCode !== null || worker.signalCode !== null) {
        throw new Error(
          `The worker exited (${worker.exitCode ?? worker.signalCode}) waiting for ${what}. Its output:\n${output.slice(-4000)}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for ${what}. The worker's output:\n${output.slice(-4000)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  function startWorker() {
    output = "";
    worker = spawn(process.execPath, [WORKER_BUNDLE], {
      cwd: APP_DIR,
      env: {
        ...process.env,
        DATABASE_URL: database.url,
        NODE_ENV: "production",
        WORKER_ID: "dropped-connection-test",
        WORKER_HEALTH_PORT: "0",
        WORKER_DISPATCH_INTERVAL_MS: "100",
        WORKER_CLAIM_INTERVAL_MS: "100",
        // Nothing here is old enough to purge, but a worker should never be
        // left with that as the only thing protecting a database.
        CRONIUM_JOB_RETENTION_DAYS: "0",
        CRONIUM_LOG_RETENTION_DAYS: "0",
        CRONIUM_WORKFLOW_RETENTION_DAYS: "0",
        CRONIUM_INCIDENT_RETENTION_DAYS: "0",
        CRONIUM_TOOL_ACTION_LOG_RETENTION_DAYS: "0",
        CRONIUM_TOOL_AUDIT_LOG_RETENTION_DAYS: "0",
        CRONIUM_WEBHOOK_RETENTION_DAYS: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    worker.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
    worker.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  }

  /** Due now, so the next dispatcher tick that works turns it into a job. */
  async function expectToDispatch() {
    const eventId = await seedEvent(await seedUser(), {
      status: EventStatus.ACTIVE,
      triggerType: EventTriggerType.SCHEDULE,
      scheduleKind: ScheduleKind.INTERVAL,
      scheduleNumber: 1,
      scheduleUnit: TimeUnit.HOURS,
      nextRunAt: new Date(),
    });
    await until(
      `a job for event ${eventId}`,
      async () =>
        (await db.select().from(jobs).where(eq(jobs.eventId, eventId))).length >
        0,
    );
  }

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
    database = await droppableDatabase(process.env.DATABASE_URL!);
  });

  afterEach(() => {
    // Before the next test truncates what it might be writing to.
    worker.kill("SIGKILL");
    database.close();
  });

  it("keeps dispatching after losing a connection inside the dispatcher's transaction", async () => {
    startWorker();
    await expectToDispatch();

    // The update that consumes a due tick, not the bookkeeping after a dispatch
    database.dropOn(/^update "events" set "next_run_at"/, 1);
    await expectToDispatch();

    expect(database.dropped()).toBe(1);
    // Says what happened, where Drizzle's own message would only name the rollback.
    expect(output).toMatch(/dispatch loop error: .*connection/i);
    expect(output).not.toMatch(/loop error: Failed query/);
  });

  it("keeps dispatching after more connections drop on BEGIN than the pool has slots", async () => {
    startWorker();
    await expectToDispatch();

    const drops = pool.options.max! + 5;
    database.dropOn(/^begin/i, drops);
    await until(`${drops} drops`, () => database.dropped() === drops);

    await expectToDispatch();
    // The pool's own message if the dead clients had kept their slots
    expect(output).not.toContain("timeout exceeded when trying to connect");
  });

  it("fails only the job when a SQL tool's connection drops mid-query", async () => {
    startWorker();
    const userId = await seedUser();
    const [tool] = await db
      .insert(toolCredentials)
      .values({
        userId,
        name: "This database",
        type: "sql",
        credentials: JSON.stringify(credentialsFor(process.env.DATABASE_URL!)),
      })
      .returning({ id: toolCredentials.id });
    const eventId = await seedEvent(userId, {
      type: EventType.TOOL_ACTION,
      toolActionConfig: {
        toolType: "sql",
        toolId: tool!.id,
        actionId: "run-query",
        parameters: { query: KILLS_OWN_CONNECTION },
      },
    });
    const jobId = await seedJob(eventId, userId, {
      type: JobType.TOOL_ACTION,
      payload: {},
    });

    await until("the job to fail", async () => {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      return job?.status === JobStatus.FAILED;
    });

    await expectToDispatch();
  });

  it("says why when a job's own status update loses its connection", async () => {
    startWorker();
    const userId = await seedUser();
    const eventId = await seedEvent(userId, {
      type: EventType.HTTP_REQUEST,
      httpMethod: "GET",
      httpUrl: "http://127.0.0.1:9/never-sent",
    });

    // The update that starts the job, not the claim before it
    database.dropOn(/^update "jobs" set "status" = \$1, "started_at"/, 1);
    const jobId = await seedJob(eventId, userId, {
      type: JobType.HTTP_REQUEST,
      payload: {},
    });

    await until("the job to fail", async () => {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      return job?.status === JobStatus.FAILED;
    });

    expect(database.dropped()).toBe(1);
    const [failure] = await db
      .select({ reason: jobTransitions.reason })
      .from(jobTransitions)
      .where(
        and(
          eq(jobTransitions.jobId, jobId),
          eq(jobTransitions.toStatus, JobStatus.FAILED),
        ),
      );
    expect(failure?.reason).toMatch(/connection/i);
    expect(failure?.reason).not.toContain("Failed query");
  });

  it("listens again after its LISTEN connection drops while subscribing", async () => {
    database.dropOn(/^LISTEN/, 1);
    startWorker();

    await until("LISTEN to come back", () => output.includes("LISTEN active"));

    expect(database.dropped()).toBe(1);
    expect(output).toContain("LISTEN connection error; reconnecting in 5s");
    await expectToDispatch();
  });
});
