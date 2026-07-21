/**
 * Lease/timeout sweeper (PLAN.md §4.2) — the replacement for orphan recovery,
 * the 15-minute blanket job killer, and the manual cleanup script. Runs in the
 * worker on an interval.
 *
 * Three sweeps, all through the CAS state machine (a job whose real completion
 * landed first is left alone):
 *   a) expired leases → per the job's leaseLossPolicy: RETRY re-queues with
 *      attempt+1 and backoff while budget remains; otherwise FAILED, loudly
 *      (LEASE_LOST incident).
 *   b) unleased RUNNING jobs past their own timeout (+grace) → TIMED_OUT.
 *      Compat path: until the orchestrator leases its claims (Phase 3), its
 *      running jobs have no lease and are bounded by their configured timeout,
 *      not a blanket constant.
 *   c) unleased CLAIMED jobs stalled past a fixed grace (claimed but never
 *      started — the owner died between claim and start) → lease-loss
 *      handling, same as (a).
 */

import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  jobs,
  scheduleIncidents,
  JobStatus,
  LeaseLossPolicy,
  LogStatus,
  ScheduleIncidentKind,
  type Job,
} from "@/shared/schema";
import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { transitionJob } from "./job-transition";
import { computeRetryBackoffMs } from "@/lib/services/retry-policy";

/** Grace on top of a job's own timeout before an unleased RUNNING job is
 * declared dead. */
export const TIMEOUT_GRACE_MS = 60_000;
/** Jobs without a resolved timeoutMs (legacy rows) fall back to the
 * orchestrator's historical default. */
export const DEFAULT_TIMEOUT_MS = 60 * 60_000;
/** CLAIMED with no lease and no progress for this long = owner died between
 * claim and start. */
export const CLAIM_STALL_MS = 10 * 60_000;

const SWEEP_BATCH = 100;

export interface SweepResult {
  requeued: number;
  failed: number;
  timedOut: number;
}

function executionLogIdOf(job: Job): number | undefined {
  const payload = job.payload as { executionLogId?: number } | undefined;
  const metadata = job.metadata as
    { executionLogId?: number; logId?: number } | undefined;
  return payload?.executionLogId ?? metadata?.executionLogId ?? metadata?.logId;
}

async function finalizeLog(job: Job, error: string): Promise<void> {
  const logId = executionLogIdOf(job);
  if (!logId) return;
  try {
    await storage.updateLog(logId, {
      status: LogStatus.FAILURE,
      endTime: new Date(),
      error,
    });
  } catch (logError) {
    console.error(
      `[Sweeper] Failed to finalize log ${logId} for job ${job.id}:`,
      logError instanceof Error ? logError.message : String(logError),
    );
  }
}

async function recordLeaseIncident(
  job: Job,
  details: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(scheduleIncidents)
    .values({
      eventId: job.eventId,
      kind: ScheduleIncidentKind.LEASE_LOST,
      details: { jobId: job.id, ...details },
    })
    .catch(() => undefined);
}

/** Shared handling for (a) and (c): the owner is gone. */
async function handleLeaseLoss(
  job: Job,
  reason: string,
  counters: SweepResult,
): Promise<void> {
  const attempts = job.attempts ?? 0;
  const canRetry =
    job.leaseLossPolicy === LeaseLossPolicy.RETRY &&
    attempts < (job.maxAttempts ?? 0);

  if (canRetry) {
    const backoffMs = computeRetryBackoffMs(attempts);
    const outcome = await transitionJob(job.id, JobStatus.QUEUED, {
      actor: "sweeper",
      reason: `${reason}; retrying (attempt ${attempts + 1}/${job.maxAttempts})`,
      set: {
        orchestratorId: null,
        leaseExpiresAt: null,
        startedAt: null,
        attempts: attempts + 1,
        lastError: reason,
        scheduledFor: new Date(Date.now() + backoffMs),
      },
    });
    if (outcome.ok && !outcome.noop) {
      counters.requeued++;
      await recordLeaseIncident(job, { action: "requeued", reason });
      const logId = executionLogIdOf(job);
      if (logId) {
        await storage
          .updateLog(logId, {
            status: LogStatus.RUNNING,
            error: `${reason}; retrying in ${Math.round(backoffMs / 1000)}s`,
          })
          .catch(() => undefined);
      }
    }
    return;
  }

  const outcome = await transitionJob(job.id, JobStatus.FAILED, {
    actor: "sweeper",
    reason,
    set: {
      completedAt: new Date(),
      lastError: reason,
      activeKey: null,
      result: { exitCode: -1, error: reason },
    },
  });
  if (outcome.ok && !outcome.noop) {
    counters.failed++;
    await recordLeaseIncident(job, { action: "failed", reason });
    await finalizeLog(job, reason);
  }
}

export async function runSweepTick(
  now: Date = new Date(),
): Promise<SweepResult> {
  const counters: SweepResult = { requeued: 0, failed: 0, timedOut: 0 };

  // a) expired leases
  const expired = await db
    .select()
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, [JobStatus.CLAIMED, JobStatus.RUNNING]),
        isNotNull(jobs.leaseExpiresAt),
        lt(jobs.leaseExpiresAt, now),
      ),
    )
    .limit(SWEEP_BATCH);
  for (const job of expired) {
    await handleLeaseLoss(
      job,
      `Lease expired (owner ${job.orchestratorId ?? "unknown"} stopped renewing)`,
      counters,
    );
  }

  // b) unleased RUNNING past its own timeout — filter per-job in JS (the
  // running set is small, bounded by executor concurrency)
  const running = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, JobStatus.RUNNING),
        isNull(jobs.leaseExpiresAt),
        isNotNull(jobs.startedAt),
      ),
    )
    .limit(SWEEP_BATCH);
  for (const job of running) {
    const timeoutMs = job.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = job.startedAt!.getTime() + timeoutMs + TIMEOUT_GRACE_MS;
    if (deadline >= now.getTime()) continue;

    const reason = `Job exceeded its ${Math.round(timeoutMs / 1000)}s timeout with no completion report`;
    const outcome = await transitionJob(job.id, JobStatus.TIMED_OUT, {
      actor: "sweeper",
      reason,
      set: {
        completedAt: new Date(),
        lastError: reason,
        activeKey: null,
        result: { exitCode: -1, error: "Timeout" },
      },
    });
    if (outcome.ok && !outcome.noop) {
      counters.timedOut++;
      const logId = executionLogIdOf(job);
      if (logId) {
        await storage
          .updateLog(logId, {
            status: LogStatus.TIMEOUT,
            endTime: new Date(),
            error: reason,
          })
          .catch(() => undefined);
      }
    }
  }

  // c) unleased CLAIMED with no progress
  const stalledBefore = new Date(now.getTime() - CLAIM_STALL_MS);
  const stalled = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, JobStatus.CLAIMED),
        isNull(jobs.leaseExpiresAt),
        lt(jobs.updatedAt, stalledBefore),
      ),
    )
    .limit(SWEEP_BATCH);
  for (const job of stalled) {
    await handleLeaseLoss(
      job,
      `Claimed by ${job.orchestratorId ?? "unknown"} but never started`,
      counters,
    );
  }

  return counters;
}
