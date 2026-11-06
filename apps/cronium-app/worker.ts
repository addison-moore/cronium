/**
 * Cronium scheduling worker (_plans/scheduling/PLAN.md §4).
 *
 * A dedicated process — the Next.js app runs no background loops. Hosts:
 *   - the schedule dispatcher (durable next_run_at → jobs)
 *   - the in-process executor pool (TOOL_ACTION / HTTP_REQUEST jobs)
 *   - the lease/timeout sweeper
 *   - the job_transitions outbox drain
 *   - retention, workflow cleanup, optional server cleanup
 *   - a liveness heartbeat (read by /api/health and the UI banner) and an
 *     HTTP health endpoint for the container healthcheck
 *
 * Every loop runs on an interval; Postgres LISTEN wakes loops early when
 * notifications arrive but is never required for progress ("slower, never
 * stuck" — PLAN.md §4.4).
 *
 * Dev:  pnpm dev:worker      (alongside dev:app and dev:socket)
 * Prod: node dist/worker.cjs (own compose service, same image as the app)
 */

import { createServer } from "http";
import os from "os";
import { Client as PgClient } from "pg";
import { runDispatchTick } from "./src/lib/scheduling/dispatcher";
import { runSweepTick } from "./src/lib/scheduling/sweeper";
import { retentionWindows, runRetention } from "./src/lib/scheduling/retention";
import {
  consumeJobTransitions,
  outboxBacklog,
} from "./src/lib/scheduling/outbox";
import { InProcessWorkerPool } from "./src/lib/scheduling/worker-executor";
import {
  advanceRunsForJob,
  reconcileWorkflowRuns,
} from "./src/lib/scheduling/workflow-engine";
import { writeWorkerHeartbeat } from "./src/lib/scheduling/heartbeat";
import {
  initializeCleanupService,
  stopCleanupService,
} from "./src/lib/services/workflow-cleanup-service";
import { serverCleanupService } from "./src/lib/services/server-cleanup-service";
import { legacySecretsBootWarning } from "./src/lib/security/legacy-secrets";
import { initializePlugins } from "./src/tools/plugins";
import { auditLogger } from "./src/lib/security/audit-logger";
import { describeFailure } from "./src/lib/pg-errors";
import { closeHungConnections, tcpKeepAlive } from "./src/server/db";

/** Compose passes an unset variable through as "", and Number("") is 0. As a limit on
 * how long a connection can be held, 0 would close every one of them. */
function positiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return value > 0 ? value : fallback;
}

const WORKER_ID = process.env.WORKER_ID ?? `worker-${os.hostname()}`;
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 5003);
const DISPATCH_INTERVAL_MS = Number(
  process.env.WORKER_DISPATCH_INTERVAL_MS ?? 5_000,
);
const CLAIM_INTERVAL_MS = Number(process.env.WORKER_CLAIM_INTERVAL_MS ?? 2_000);
const SWEEP_INTERVAL_MS = positiveNumber(
  process.env.WORKER_SWEEP_INTERVAL_MS,
  30_000,
);
const OUTBOX_INTERVAL_MS = 5_000;
const LEASE_EXTEND_INTERVAL_MS = 20_000;
const RETENTION_INTERVAL_MS = 6 * 60 * 60_000;
const RETENTION_BACKLOG_DELAY_MS = 60_000;
const MAX_CONCURRENT_IN_PROCESS = Number(
  process.env.WORKER_MAX_CONCURRENT ?? 10,
);
/** The longest measured hold, half a million rows at a load average of 100, was a
 * retention batch at 2.1 seconds. A 5 MB job output took 0.25. */
const DB_CHECKOUT_LIMIT_MS = positiveNumber(
  process.env.WORKER_DB_CHECKOUT_LIMIT_MS,
  5 * 60_000,
);
const HUNG_CONNECTION_CHECK_INTERVAL_MS = 1_000;
const LISTEN_PROBE_INTERVAL_MS = positiveNumber(
  process.env.WORKER_LISTEN_PROBE_INTERVAL_MS,
  30_000,
);
const LISTEN_ANSWER_TIMEOUT_MS = 10_000;

const pool = new InProcessWorkerPool(WORKER_ID, MAX_CONCURRENT_IN_PROCESS);

let lastDispatchTickAt: Date | null = null;
let shuttingDown = false;

interface Loop {
  poke: () => void;
  stop: () => void;
}

/** Interval loop with overlap protection; poke() runs it immediately (used by
 * LISTEN notifications as an accelerant). */
function startLoop(
  name: string,
  intervalMs: number,
  fn: () => Promise<void>,
): Loop {
  let running = false;
  let pokedWhileRunning = false;

  const tick = async () => {
    if (shuttingDown) return;
    if (running) {
      pokedWhileRunning = true;
      return;
    }
    running = true;
    try {
      do {
        pokedWhileRunning = false;
        await fn();
      } while (pokedWhileRunning && !shuttingDown);
    } catch (error) {
      // Not Drizzle's own message: a transaction that lost its connection would read
      // only "Failed query: rollback", and other statements would list their values.
      console.error(`[Worker] ${name} loop error:`, describeFailure(error));
    } finally {
      running = false;
    }
  };

  const id = setInterval(() => void tick(), intervalMs);
  return { poke: () => void tick(), stop: () => clearInterval(id) };
}

// --- Loops -----------------------------------------------------------------

const dispatchLoop = startLoop("dispatch", DISPATCH_INTERVAL_MS, async () => {
  const result = await runDispatchTick();
  lastDispatchTickAt = new Date();
  // Heartbeat only after a successful tick: a consistently failing dispatcher
  // must not advertise healthy scheduling to the web app.
  await writeWorkerHeartbeat(WORKER_ID).catch((error) => {
    console.error("[Worker] Heartbeat write failed:", error);
  });
  if (result.dispatched > 0 || result.incidents > 0) {
    console.log(
      `[Worker] Dispatch tick: ${result.dueEvents} due, ${result.dispatched} dispatched, ${result.incidents} incident(s)`,
    );
  }
});

const claimLoop = startLoop("claim", CLAIM_INTERVAL_MS, async () => {
  const claimed = await pool.claimAndRun();
  if (claimed > 0) {
    console.log(`[Worker] Claimed ${claimed} in-process job(s)`);
  }
});

const sweepLoop = startLoop("sweep", SWEEP_INTERVAL_MS, async () => {
  const result = await runSweepTick();
  if (result.requeued || result.failed || result.timedOut) {
    console.log(
      `[Worker] Sweep: ${result.requeued} requeued, ${result.failed} failed, ${result.timedOut} timed out`,
    );
  }
});

const outboxLoop = startLoop("outbox", OUTBOX_INTERVAL_MS, async () => {
  // Phase 2: side effects (log finalize, broadcasts, conditional actions)
  // still fire inline from updateJobStatus; the drain keeps the audit trail's
  // outbox cursor moving so Phase 4 can swap real handlers in without a
  // backlog. Handlers must be idempotent when they arrive.
  await consumeJobTransitions(async () => undefined, { batchSize: 200 });
});

const leaseLoop = startLoop(
  "lease-extend",
  LEASE_EXTEND_INTERVAL_MS,
  async () => {
    await pool.extendLeases();
  },
);

const retentionLoop: Loop = startLoop(
  "retention",
  RETENTION_INTERVAL_MS,
  async () => {
    const { backlog } = await runRetention();
    // A pass stops at a per-table cap, which on a six-hour interval is too slow
    // for a busy instance or the first passes after an upgrade. Come back soon.
    if (backlog) {
      setTimeout(
        () => retentionLoop.poke(),
        RETENTION_BACKLOG_DELAY_MS,
      ).unref();
    }
  },
);

// Reconciliation sweep for workflow runs: NOTIFY-driven advances are the fast
// path (see the job_changed handler below); this loop is the guarantee that
// every RUNNING workflow converges even if all notifications are lost, and it
// doubles as the boot-time recovery pass (PLAN.md §4.4).
const workflowLoop = startLoop("workflow-reconcile", 60_000, async () => {
  const advanced = await reconcileWorkflowRuns();
  if (advanced > 0) {
    console.log(`[Worker] Reconciled ${advanced} running workflow(s)`);
  }
});

// A connection that stops answering without closing never errors, so a loop waiting on
// one would stay stuck through any recovery, with nothing to restart it: compose's
// `restart: unless-stopped` doesn't act on an unhealthy container.
const hungConnectionLoop = startLoop(
  "hung-connections",
  HUNG_CONNECTION_CHECK_INTERVAL_MS,
  async () => {
    const closed = closeHungConnections(DB_CHECKOUT_LIMIT_MS);
    if (closed > 0) {
      console.error(
        `[Worker] Closed ${closed} database connection(s) held for over ${DB_CHECKOUT_LIMIT_MS / 1000}s, presumed hung. What was using them fails and is tried again.`,
      );
    }
  },
);

// --- LISTEN (accelerant only; loops poll regardless) -----------------------

let listenClient: PgClient | null = null;

async function startListener(): Promise<void> {
  if (shuttingDown) return;
  const client = new PgClient({
    connectionString: process.env.DATABASE_URL?.replace(/^"|"$/g, ""),
    // With no limits, a database that hangs during the statements below keeps this from
    // ever reconnecting, and at boot keeps the health endpoint from opening. Any failure
    // throws this client away, so nothing can reuse it after a timed-out query, which is
    // what makes query_timeout unsafe on the pool.
    connectionTimeoutMillis: LISTEN_ANSWER_TIMEOUT_MS,
    query_timeout: LISTEN_ANSWER_TIMEOUT_MS,
    ...tcpKeepAlive,
  });

  let reconnecting = false;
  let probe: NodeJS.Timeout | undefined;
  const reconnect = (delayMs: number): void => {
    reconnecting = true;
    clearInterval(probe);
    listenClient = null;
    client.end().catch(() => undefined);
    if (!shuttingDown) setTimeout(() => void startListener(), delayMs);
  };

  // Listening before anything can go wrong: a connection lost during the statements
  // below rejects them but also emits this, and with nothing listening that would
  // end the process, on the reconnect path as much as at boot.
  client.on("error", (error) => {
    if (reconnecting) return;
    console.warn(
      "[Worker] LISTEN connection error; reconnecting in 5s:",
      error.message,
    );
    reconnect(5_000);
  });

  try {
    await client.connect();
    await client.query("LISTEN schedule_changed");
    await client.query("LISTEN job_queued");
    await client.query("LISTEN job_changed");
    listenClient = client;
    console.log(
      "[Worker] LISTEN active (schedule_changed, job_queued, job_changed)",
    );

    client.on("notification", (msg) => {
      switch (msg.channel) {
        case "schedule_changed":
          dispatchLoop.poke();
          break;
        case "job_queued":
          claimLoop.poke();
          break;
        case "job_changed":
          outboxLoop.poke();
          // Job completion drives workflow advancement (no per-node polling)
          if (msg.payload) {
            void advanceRunsForJob(msg.payload).catch((error) => {
              console.error(
                "[Worker] Workflow advance on job change failed:",
                error instanceof Error ? error.message : String(error),
              );
            });
          }
          break;
      }
    });

    // Nothing else is sent on this connection, so if it stops answering, notifications
    // just stop. Polling covers most of that, but with nothing to reconnect it workflow
    // steps would advance once a minute until the next restart.
    probe = setInterval(() => {
      client.query("SELECT 1").catch((error: Error) => {
        if (reconnecting || shuttingDown) return;
        console.warn(
          "[Worker] LISTEN connection stopped answering; reconnecting in 5s:",
          error.message,
        );
        reconnect(5_000);
      });
    }, LISTEN_PROBE_INTERVAL_MS);
  } catch (error) {
    if (reconnecting) return;
    console.warn(
      "[Worker] LISTEN unavailable (polling covers it); retrying in 30s:",
      error instanceof Error ? error.message : String(error),
    );
    reconnect(30_000);
  }
}

// --- Health endpoint (container healthcheck) --------------------------------

const healthServer = createServer((req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404).end();
    return;
  }
  void (async () => {
    const staleMs = 3 * DISPATCH_INTERVAL_MS + 30_000;
    const stale =
      !lastDispatchTickAt ||
      Date.now() - lastDispatchTickAt.getTime() > staleMs;
    const body = {
      status: stale ? "unhealthy" : "healthy",
      workerId: WORKER_ID,
      lastDispatchTickAt: lastDispatchTickAt?.toISOString() ?? null,
      activeInProcessJobs: pool.activeCount,
      outboxBacklog: await outboxBacklog().catch(() => -1),
    };
    res
      .writeHead(stale ? 503 : 200, { "Content-Type": "application/json" })
      .end(JSON.stringify(body));
  })();
});

// --- Startup / shutdown -----------------------------------------------------

async function main(): Promise<void> {
  console.log(`[Worker] Starting scheduling worker ${WORKER_ID}`);

  // Tool-action execution needs the plugin registry (the Next app does this
  // in instrumentation; the worker does it itself).
  initializePlugins();

  // Workflow sweeper (30-min stuck workflows). Job sweeping is owned by the
  // lease sweeper above — sweepJobs: false.
  initializeCleanupService({
    maxWorkflowAge: 30 * 60 * 1000,
    checkInterval: 5 * 60 * 1000,
    sweepJobs: false,
  });

  if (process.env.SERVER_CLEANUP_ENABLED === "true") {
    serverCleanupService.start();
  }

  const windows = Object.entries(retentionWindows())
    .map(([name, days]) => `${name}=${days}`)
    .join(", ");
  console.log(`[Worker] Retention in days (0 keeps forever): ${windows}`);

  await startListener();
  healthServer.listen(HEALTH_PORT, () => {
    console.log(`[Worker] Health endpoint on :${HEALTH_PORT}/health`);
  });

  // Startup passes: retention once, boot reconciliation for workflow runs
  // interrupted by the previous shutdown, then the intervals take over
  retentionLoop.poke();
  dispatchLoop.poke();
  claimLoop.poke();
  sweepLoop.poke();
  workflowLoop.poke();

  // Reads only, and doesn't hold up startup.
  void legacySecretsBootWarning()
    .then((warning) => {
      if (warning) console.warn(`[Worker] ${warning}`);
    })
    .catch((error) => {
      console.warn(
        "[Worker] Could not check for legacy secrets:",
        error instanceof Error ? error.message : String(error),
      );
    });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Worker] ${signal} received; shutting down...`);

  for (const loop of [
    dispatchLoop,
    claimLoop,
    sweepLoop,
    outboxLoop,
    leaseLoop,
    retentionLoop,
    workflowLoop,
    hungConnectionLoop,
  ]) {
    loop.stop();
  }
  stopCleanupService();
  serverCleanupService.stop?.();
  healthServer.close();
  // Not awaited: end() waits for Postgres to close the connection, which a hung
  // database never does, and exiting closes it anyway.
  void listenClient?.end().catch(() => undefined);

  await pool.drain(30_000);
  // After the drain: the jobs it waited for write audit entries as they finish.
  await auditLogger.shutdown();
  console.log("[Worker] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((error) => {
  console.error("[Worker] Fatal startup error:", error);
  process.exit(1);
});
