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
import { runRetention } from "./src/lib/scheduling/retention";
import {
  consumeJobTransitions,
  outboxBacklog,
} from "./src/lib/scheduling/outbox";
import { InProcessWorkerPool } from "./src/lib/scheduling/worker-executor";
import { writeWorkerHeartbeat } from "./src/lib/scheduling/heartbeat";
import {
  initializeCleanupService,
  stopCleanupService,
} from "./src/lib/services/workflow-cleanup-service";
import { serverCleanupService } from "./src/lib/services/server-cleanup-service";
import { initializePlugins } from "./src/tools/plugins";

const WORKER_ID = process.env.WORKER_ID ?? `worker-${os.hostname()}`;
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 5003);
const DISPATCH_INTERVAL_MS = Number(
  process.env.WORKER_DISPATCH_INTERVAL_MS ?? 5_000,
);
const CLAIM_INTERVAL_MS = Number(process.env.WORKER_CLAIM_INTERVAL_MS ?? 2_000);
const SWEEP_INTERVAL_MS = 30_000;
const OUTBOX_INTERVAL_MS = 5_000;
const LEASE_EXTEND_INTERVAL_MS = 20_000;
const RETENTION_INTERVAL_MS = 6 * 60 * 60_000;
const MAX_CONCURRENT_IN_PROCESS = Number(
  process.env.WORKER_MAX_CONCURRENT ?? 10,
);

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
      console.error(
        `[Worker] ${name} loop error:`,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      running = false;
    }
  };

  const id = setInterval(() => void tick(), intervalMs);
  return { poke: () => void tick(), stop: () => clearInterval(id) };
}

// --- Loops -----------------------------------------------------------------

const dispatchLoop = startLoop("dispatch", DISPATCH_INTERVAL_MS, async () => {
  // Heartbeat from inside the loop: a stalled dispatcher stops heartbeating
  await writeWorkerHeartbeat(WORKER_ID).catch((error) => {
    console.error("[Worker] Heartbeat write failed:", error);
  });
  const result = await runDispatchTick();
  lastDispatchTickAt = new Date();
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

const retentionLoop = startLoop(
  "retention",
  RETENTION_INTERVAL_MS,
  async () => {
    await runRetention();
  },
);

// --- LISTEN (accelerant only; loops poll regardless) -----------------------

let listenClient: PgClient | null = null;

async function startListener(): Promise<void> {
  if (shuttingDown) return;
  const client = new PgClient({
    connectionString: process.env.DATABASE_URL?.replace(/^"|"$/g, ""),
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
          break;
      }
    });
    client.on("error", (error) => {
      console.warn(
        "[Worker] LISTEN connection error; reconnecting in 5s:",
        error.message,
      );
      listenClient = null;
      client.end().catch(() => undefined);
      if (!shuttingDown) setTimeout(() => void startListener(), 5_000);
    });
  } catch (error) {
    console.warn(
      "[Worker] LISTEN unavailable (polling covers it); retrying in 30s:",
      error instanceof Error ? error.message : String(error),
    );
    client.end().catch(() => undefined);
    if (!shuttingDown) setTimeout(() => void startListener(), 30_000);
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

  await startListener();
  healthServer.listen(HEALTH_PORT, () => {
    console.log(`[Worker] Health endpoint on :${HEALTH_PORT}/health`);
  });

  // Startup passes: retention once, then let the intervals take over
  retentionLoop.poke();
  dispatchLoop.poke();
  claimLoop.poke();
  sweepLoop.poke();
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
  ]) {
    loop.stop();
  }
  stopCleanupService();
  serverCleanupService.stop?.();
  healthServer.close();
  if (listenClient) {
    await listenClient.end().catch(() => undefined);
  }

  await pool.drain(30_000);
  console.log("[Worker] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((error) => {
  console.error("[Worker] Fatal startup error:", error);
  process.exit(1);
});
