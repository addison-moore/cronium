/**
 * The worker's in-process executor pool (PLAN.md §5 tail): TOOL_ACTION and
 * HTTP_REQUEST jobs are claimed through the same lease mechanism as script
 * jobs and executed here. This replaces the fire-and-forget inline kick from
 * the web process — a crash can no longer strand these jobs QUEUED forever
 * (review H10): whatever the worker was running is re-covered by the sweeper,
 * and whatever was queued is simply claimed by the next worker.
 */

import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  jobs,
  jobTransitions,
  JobStatus,
  JobType,
  type Job,
} from "@/shared/schema";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { transitionJob } from "./job-transition";

const IN_PROCESS_TYPES = [JobType.TOOL_ACTION, JobType.HTTP_REQUEST];

/** Lease slack beyond the job's own timeout; the heartbeat keeps extending
 * while the job is genuinely still executing. */
const LEASE_SLACK_MS = 60_000;
const HEARTBEAT_LEASE_MS = 90_000;
const FALLBACK_TIMEOUT_MS = 30_000;

/**
 * How long drain() waits for a claim under way. It is a short transaction, so one
 * still going after this is stuck on the database, which is no reason to spend the
 * whole drain on it. If it does finish later, its jobs aren't started: see claim().
 */
const CLAIM_SETTLE_MS = 3_000;

/** Waits for `work` to settle, or for `timeoutMs`, whichever comes first. */
async function settledWithin(
  work: Iterable<Promise<unknown>>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled(work),
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
}

export class InProcessWorkerPool {
  private active = new Map<string, Promise<void>>();
  private claims = new Set<Promise<number>>();
  /** Set once drain() has stopped waiting for claims. */
  private stopped = false;

  constructor(
    private readonly workerId: string,
    private readonly maxConcurrent = 10,
  ) {}

  get activeCount(): number {
    return this.active.size;
  }

  /** Claim up to `capacity` due in-process jobs (SKIP LOCKED) and launch them.
   * Returns how many were claimed. */
  async claimAndRun(now: Date = new Date()): Promise<number> {
    const claim = this.claim(now);
    this.claims.add(claim);
    try {
      return await claim;
    } finally {
      this.claims.delete(claim);
    }
  }

  private async claim(now: Date): Promise<number> {
    const capacity = this.maxConcurrent - this.active.size;
    if (capacity <= 0) return 0;

    const claimed = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(jobs)
        .where(
          and(
            inArray(jobs.type, IN_PROCESS_TYPES),
            eq(jobs.status, JobStatus.QUEUED),
            lte(jobs.scheduledFor, now),
          ),
        )
        .orderBy(desc(jobs.priority), jobs.createdAt)
        .limit(capacity)
        .for("update", { skipLocked: true });

      if (rows.length === 0) return rows;

      // Each job is leased against its OWN timeout. A single lease for the
      // whole batch (the max across it) meant a 30s HTTP request claimed
      // alongside an hour-long tool action inherited the hour: if this worker
      // died before its first heartbeat, the sweeper could not recover that
      // job until the inflated lease expired. The batch is bounded by
      // maxConcurrent, so per-row updates are cheap.
      for (const row of rows) {
        await tx
          .update(jobs)
          .set({
            status: JobStatus.CLAIMED,
            orchestratorId: this.workerId,
            leaseExpiresAt: new Date(
              now.getTime() +
                (row.timeoutMs ?? FALLBACK_TIMEOUT_MS) +
                LEASE_SLACK_MS,
            ),
            updatedAt: now,
          })
          .where(eq(jobs.id, row.id));
      }
      await tx.insert(jobTransitions).values(
        rows.map((row) => ({
          jobId: row.id,
          fromStatus: JobStatus.QUEUED,
          toStatus: JobStatus.CLAIMED,
          actor: `worker:${this.workerId}`,
        })),
      );
      return rows;
    });

    // drain() has stopped waiting for this claim, so the process could exit at any
    // moment. Started now, a job would be cut off partway and then run again. Left
    // as it is, its lease runs out and the sweeper deals with it.
    if (this.stopped) {
      if (claimed.length > 0) {
        console.warn(
          `[WorkerPool] Not starting ${claimed.length} job(s) claimed while shutting down; the sweeper will recover them`,
        );
      }
      return 0;
    }

    for (const job of claimed) {
      this.launch(job);
    }
    return claimed.length;
  }

  private launch(job: Job): void {
    const run = (async () => {
      try {
        if (job.cancelRequested) {
          await transitionJob(job.id, JobStatus.CANCELLED, {
            actor: `worker:${this.workerId}`,
            reason: "Cancellation requested before start",
            set: { completedAt: new Date(), activeKey: null },
          });
          return;
        }

        const event = await storage.getEventWithRelations(job.eventId);
        if (!event) {
          await transitionJob(job.id, JobStatus.FAILED, {
            actor: `worker:${this.workerId}`,
            reason: "Event no longer exists",
            set: {
              completedAt: new Date(),
              lastError: "Event no longer exists",
              activeKey: null,
            },
          });
          return;
        }

        const payload = job.payload as
          { input?: Record<string, unknown> } | undefined;
        const { runInProcessJob } =
          await import("@/lib/scheduler/in-process-executor");
        // Finalizes the job itself (COMPLETED/FAILED via updateJobStatus) and
        // never throws; defensive catch below regardless.
        await runInProcessJob(job, event, payload?.input ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[WorkerPool] Job ${job.id} crashed:`, message);
        await transitionJob(job.id, JobStatus.FAILED, {
          actor: `worker:${this.workerId}`,
          reason: message,
          set: { completedAt: new Date(), lastError: message, activeKey: null },
        }).catch(() => undefined);
      } finally {
        this.active.delete(job.id);
      }
    })();
    this.active.set(job.id, run);
  }

  /** Extend leases for everything still in flight; called by the worker's
   * heartbeat loop. */
  async extendLeases(now: Date = new Date()): Promise<void> {
    if (this.active.size === 0) return;
    await db
      .update(jobs)
      .set({
        leaseExpiresAt: new Date(now.getTime() + HEARTBEAT_LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          inArray(jobs.id, [...this.active.keys()]),
          inArray(jobs.status, [JobStatus.CLAIMED, JobStatus.RUNNING]),
          eq(jobs.orchestratorId, this.workerId),
        ),
      );
  }

  /** Wait for in-flight jobs on shutdown, bounded. That includes the jobs of a
   * claim under way, which only start once it returns. */
  async drain(timeoutMs = 30_000): Promise<void> {
    const started = Date.now();
    if (this.claims.size > 0) {
      await settledWithin(this.claims, Math.min(CLAIM_SETTLE_MS, timeoutMs));
    }
    this.stopped = true;

    if (this.active.size === 0) return;
    console.log(
      `[WorkerPool] Draining ${this.active.size} in-flight job(s) (max ${timeoutMs / 1000}s)`,
    );
    await settledWithin(
      this.active.values(),
      timeoutMs - (Date.now() - started),
    );
  }
}
