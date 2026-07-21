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
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { transitionJob } from "./job-transition";

const IN_PROCESS_TYPES = [JobType.TOOL_ACTION, JobType.HTTP_REQUEST];

/** Lease slack beyond the job's own timeout; the heartbeat keeps extending
 * while the job is genuinely still executing. */
const LEASE_SLACK_MS = 60_000;
const HEARTBEAT_LEASE_MS = 90_000;
const FALLBACK_TIMEOUT_MS = 30_000;

export class InProcessWorkerPool {
  private active = new Map<string, Promise<void>>();

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

      const ids = rows.map((row) => row.id);
      await tx
        .update(jobs)
        .set({
          status: JobStatus.CLAIMED,
          orchestratorId: this.workerId,
          leaseExpiresAt: new Date(
            now.getTime() +
              Math.max(...rows.map((r) => r.timeoutMs ?? FALLBACK_TIMEOUT_MS)) +
              LEASE_SLACK_MS,
          ),
          updatedAt: now,
        })
        .where(inArray(jobs.id, ids));
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

  /** Wait for in-flight jobs on shutdown, bounded. */
  async drain(timeoutMs = 30_000): Promise<void> {
    if (this.active.size === 0) return;
    console.log(
      `[WorkerPool] Draining ${this.active.size} in-flight job(s) (max ${timeoutMs / 1000}s)`,
    );
    await Promise.race([
      Promise.allSettled([...this.active.values()]),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
}

/** True when any QUEUED in-process job is due — lets the worker skip a claim
 * round-trip when idle. */
export async function hasDueInProcessJobs(
  now: Date = new Date(),
): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(jobs)
    .where(
      and(
        inArray(jobs.type, IN_PROCESS_TYPES),
        eq(jobs.status, JobStatus.QUEUED),
        lte(jobs.scheduledFor, now),
      ),
    )
    .limit(1);
  return !!row;
}
