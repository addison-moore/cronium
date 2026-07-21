/**
 * Retention (PLAN.md §3.5 tail): delete terminal jobs older than the window,
 * in FK-safe order, keeping the user-visible run history — `logs` rows are
 * detached (jobId/executionId nulled), not deleted. Replaces the never-called
 * jobService.cleanupOldJobs (review D4).
 */

import { db } from "@/server/db";
import {
  executions,
  jobs,
  jobTransitions,
  logs,
  JobStatus,
} from "@/shared/schema";
import { and, inArray, lt } from "drizzle-orm";

const TERMINAL: JobStatus[] = [
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.TIMED_OUT,
  JobStatus.CANCELLED,
];

const BATCH = 500;
const MAX_BATCHES_PER_RUN = 20;

export function retentionDays(): number {
  const parsed = Number(process.env.CRONIUM_JOB_RETENTION_DAYS ?? 30);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export async function runRetention(
  days: number = retentionDays(),
  now: Date = new Date(),
): Promise<{ jobsDeleted: number }> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  let jobsDeleted = 0;

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const batch = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(inArray(jobs.status, TERMINAL), lt(jobs.completedAt, cutoff)))
      .limit(BATCH);
    if (batch.length === 0) break;

    const ids = batch.map((row) => row.id);
    await db.transaction(async (tx) => {
      // Keep run history: detach logs from the queue rows being removed
      await tx
        .update(logs)
        .set({ jobId: null, executionId: null })
        .where(inArray(logs.jobId, ids));
      // A log can reference an execution without referencing the job
      const execRows = await tx
        .select({ id: executions.id })
        .from(executions)
        .where(inArray(executions.jobId, ids));
      if (execRows.length > 0) {
        await tx
          .update(logs)
          .set({ executionId: null })
          .where(
            inArray(
              logs.executionId,
              execRows.map((row) => row.id),
            ),
          );
      }
      await tx.delete(executions).where(inArray(executions.jobId, ids));
      await tx.delete(jobTransitions).where(inArray(jobTransitions.jobId, ids));
      await tx.delete(jobs).where(inArray(jobs.id, ids));
    });
    jobsDeleted += ids.length;

    if (batch.length < BATCH) break;
  }

  if (jobsDeleted > 0) {
    console.log(
      `[Retention] Deleted ${jobsDeleted} terminal jobs older than ${days}d`,
    );
  }
  return { jobsDeleted };
}
