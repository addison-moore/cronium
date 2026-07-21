/**
 * Transactional-outbox consumer over job_transitions (PLAN.md §4.3).
 *
 * transitionJob() appends rows atomically with each status change; this module
 * drains unprocessed rows and runs side effects (conditional actions,
 * broadcasts, alerts) at-least-once. Rows are locked with SKIP LOCKED so
 * multiple worker replicas can drain concurrently without double-processing.
 *
 * Phase 1 ships the mechanism; the worker process (Phase 2) hosts the loop and
 * registers the real handlers. Until then, side effects continue to fire
 * inline from jobService.updateJobStatus (marked for migration).
 */

import { db } from "@/server/db";
import { jobTransitions, type JobTransition } from "@/shared/schema";
import { asc, count, eq, isNull, lt, and } from "drizzle-orm";

export type TransitionHandler = (transition: JobTransition) => Promise<void>;

/** A handler that keeps failing does not block the outbox forever: rows older
 * than this are marked processed with an error log (poison-pill guard). */
export const POISON_AGE_MS = 60 * 60 * 1000;

export interface ConsumeOptions {
  batchSize?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * Drain one batch of unprocessed transitions through `handler`. A row is
 * marked processed only after its handler succeeds (at-least-once), so
 * handlers must be idempotent. Returns the number of rows marked processed.
 */
export async function consumeJobTransitions(
  handler: TransitionHandler,
  options: ConsumeOptions = {},
): Promise<number> {
  const { batchSize = 50, now = () => new Date() } = options;

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(jobTransitions)
      .where(isNull(jobTransitions.processedAt))
      .orderBy(asc(jobTransitions.id))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    let processed = 0;
    for (const row of rows) {
      try {
        await handler(row);
      } catch (error) {
        const ageMs = now().getTime() - row.createdAt.getTime();
        if (ageMs < POISON_AGE_MS) {
          // Leave unprocessed; retried on the next drain.
          console.error(
            `[Outbox] Handler failed for transition ${row.id} (job ${row.jobId}, → ${row.toStatus}); will retry:`,
            error instanceof Error ? error.message : String(error),
          );
          continue;
        }
        console.error(
          `[Outbox] Dropping poison transition ${row.id} (job ${row.jobId}, → ${row.toStatus}) after ${Math.round(ageMs / 60000)}min of failures:`,
          error instanceof Error ? error.message : String(error),
        );
      }
      await tx
        .update(jobTransitions)
        .set({ processedAt: now() })
        .where(eq(jobTransitions.id, row.id));
      processed++;
    }
    return processed;
  });
}

/** How far behind the outbox is — exposed for worker health reporting. */
export async function outboxBacklog(olderThan?: Date): Promise<number> {
  const condition = olderThan
    ? and(
        isNull(jobTransitions.processedAt),
        lt(jobTransitions.createdAt, olderThan),
      )
    : isNull(jobTransitions.processedAt);
  const [row] = await db
    .select({ value: count() })
    .from(jobTransitions)
    .where(condition);
  return row?.value ?? 0;
}
