/**
 * The single job state machine (_plans/scheduling/PLAN.md §4.3).
 *
 * Every job status write goes through transitionJob(): a transactional
 * compare-and-swap that rejects illegal edges, appends an audit row to
 * job_transitions (which doubles as the side-effect outbox), and notifies
 * listeners. Terminal states are absorbing — a late orchestrator report can
 * no longer "un-cancel" a job or overwrite a sweeper decision (review D3).
 */

import { db } from "@/server/db";
import { jobs, jobTransitions, JobStatus, type Job } from "@/shared/schema";
import { eq, sql } from "drizzle-orm";

const NON_TERMINAL: JobStatus[] = [
  JobStatus.QUEUED,
  JobStatus.CLAIMED,
  JobStatus.RUNNING,
];

/** For each target status, the statuses a job may come from. Terminal states
 * appear in no list: once terminal, always terminal. */
const LEGAL_SOURCES: Record<JobStatus, JobStatus[]> = {
  // Re-queue: lease-expiry retry or failure-with-retry-budget
  [JobStatus.QUEUED]: [JobStatus.CLAIMED, JobStatus.RUNNING],
  [JobStatus.CLAIMED]: [JobStatus.QUEUED],
  // In-process jobs start RUNNING straight from QUEUED (no claim step yet)
  [JobStatus.RUNNING]: [JobStatus.QUEUED, JobStatus.CLAIMED],
  [JobStatus.COMPLETED]: NON_TERMINAL,
  [JobStatus.FAILED]: NON_TERMINAL,
  [JobStatus.TIMED_OUT]: NON_TERMINAL,
  [JobStatus.CANCELLED]: NON_TERMINAL,
};

export interface TransitionOptions {
  /** Who drove this: "app", "worker:<id>", "orchestrator:<id>", "user:<id>". */
  actor: string;
  reason?: string;
  /** Narrow the allowed source states beyond the legal map (never widen). */
  expectedFrom?: JobStatus[];
  /** Additional column updates applied atomically with the status change. */
  set?: Partial<typeof jobs.$inferInsert>;
  /** Structured context recorded on the audit row. */
  data?: Record<string, unknown>;
}

export type TransitionOutcome =
  | { ok: true; job: Job; noop?: boolean }
  | { ok: false; current?: JobStatus; error: string };

function isTerminalStatus(status: JobStatus): boolean {
  return !NON_TERMINAL.includes(status);
}

export async function transitionJob(
  jobId: string,
  to: JobStatus,
  opts: TransitionOptions,
): Promise<TransitionOutcome> {
  const outcome = await db.transaction(
    async (tx): Promise<TransitionOutcome> => {
      const [current] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .for("update");

      if (!current) {
        return { ok: false, error: `Job ${jobId} not found` };
      }

      // Same-status update: apply the extra columns (repeated RUNNING progress
      // reports do this) but record no transition — idempotent by design.
      if (current.status === to) {
        if (opts.set && Object.keys(opts.set).length > 0) {
          const [updated] = await tx
            .update(jobs)
            .set({ ...opts.set, updatedAt: new Date() })
            .where(eq(jobs.id, jobId))
            .returning();
          return { ok: true, job: updated ?? current, noop: true };
        }
        return { ok: true, job: current, noop: true };
      }

      const legal = LEGAL_SOURCES[to];
      const allowed = opts.expectedFrom
        ? opts.expectedFrom.filter((s) => legal.includes(s))
        : legal;
      if (!allowed.includes(current.status)) {
        console.warn(
          `[JobTransition] Rejected ${current.status} → ${to} for job ${jobId} (actor: ${opts.actor}${opts.reason ? `, reason: ${opts.reason}` : ""})`,
        );
        return {
          ok: false,
          current: current.status,
          error: `Illegal transition ${current.status} → ${to}`,
        };
      }

      const [updated] = await tx
        .update(jobs)
        .set({ ...opts.set, status: to, updatedAt: new Date() })
        .where(eq(jobs.id, jobId))
        .returning();

      // The row is locked FOR UPDATE above, so an empty RETURNING "can't
      // happen" — but if it ever does (row deleted mid-transaction, driver
      // fault), claiming success with the stale pre-update row would violate
      // the CAS contract. Fail like any other lost race: no audit row, no
      // notify.
      if (!updated) {
        return {
          ok: false,
          current: current.status,
          error: `Job ${jobId} was modified concurrently; transition ${current.status} → ${to} updated no row`,
        };
      }

      await tx.insert(jobTransitions).values({
        jobId,
        fromStatus: current.status,
        toStatus: to,
        actor: opts.actor,
        reason: opts.reason ?? null,
        data: opts.data ?? null,
      });

      // Delivered on commit; consumers treat this as an accelerant only — the
      // outbox scan is the guarantee (PLAN.md §4.4).
      await tx.execute(sql`SELECT pg_notify('job_changed', ${jobId})`);

      return { ok: true, job: updated };
    },
  );

  // Revoke the job's execution tokens the instant it becomes terminal (HI-14),
  // AFTER the state change has committed. A real transition to a terminal state
  // (not a same-status no-op) means no further runtime calls are legitimate —
  // the runtime rejects tokens for revoked jobs. Best-effort: the token's
  // absolute lifetime cap backstops a failed write.
  if (outcome.ok && !outcome.noop && isTerminalStatus(to)) {
    const { revokeJobExecutionTokens } =
      await import("@/lib/security/execution-token-revocation");
    await revokeJobExecutionTokens(jobId);
  }

  return outcome;
}

/** Record a job's birth on the audit trail (fromStatus NULL → QUEUED) and wake
 * claim loops. Called by dispatchEventJob right after insert. */
export async function recordJobCreated(
  jobId: string,
  actor: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await db.insert(jobTransitions).values({
    jobId,
    fromStatus: null,
    toStatus: JobStatus.QUEUED,
    actor,
    data: data ?? null,
  });
  await db.execute(sql`SELECT pg_notify('job_queued', ${jobId})`);
}
