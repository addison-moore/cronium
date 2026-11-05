/**
 * Workflow Cleanup Service
 *
 * Handles detection and cleanup of stuck workflows and jobs
 * Prevents workflows from being stuck in RUNNING state indefinitely
 */

import { db } from "@/server/db";
import {
  workflowExecutions,
  workflowExecutionEvents,
  workflowStepRuns,
  jobs,
  logs,
  workflowLogs,
  executions,
} from "@/shared/schema";
import { eq, and, exists, lt, or, isNull, inArray, sql } from "drizzle-orm";
import {
  LogStatus,
  JobStatus,
  WorkflowLogLevel,
  WorkflowStepStatus,
} from "@/shared/schema";
import { settleTimedOutRunSteps } from "@/lib/scheduling/workflow-engine";

const RUN_TIMED_OUT = "Workflow run timed out";
const RUN_TIMED_OUT_BEFORE_JOB_STARTED =
  "Workflow run timed out before this job started";

/** Any job that hasn't finished. Written as an OR so each arm can use its partial
 * index (jobs_claim_idx, jobs_lease_idx). No index covers `status IN (all
 * three)`, which would read the whole table. */
const jobIsUnfinished = or(
  eq(jobs.status, JobStatus.QUEUED),
  inArray(jobs.status, [JobStatus.CLAIMED, JobStatus.RUNNING]),
);

interface CleanupOptions {
  maxWorkflowAge?: number; // Max time a workflow can run (ms)
  maxJobAge?: number; // Max time a job can run (ms)
  checkInterval?: number; // How often to check for stuck items (ms)
  /** When false, only workflows are swept — the scheduling worker's lease
   * sweeper (src/lib/scheduling/sweeper.ts) owns stuck-job handling with
   * per-job timeouts instead of the blanket maxJobAge. */
  sweepJobs?: boolean;
}

export class WorkflowCleanupService {
  private intervalId: NodeJS.Timeout | null = null;
  private options: Required<CleanupOptions>;

  constructor(options: CleanupOptions = {}) {
    this.options = {
      maxWorkflowAge: options.maxWorkflowAge ?? 30 * 60 * 1000, // 30 minutes default
      maxJobAge: options.maxJobAge ?? 15 * 60 * 1000, // 15 minutes default
      sweepJobs: options.sweepJobs ?? true,
      checkInterval: options.checkInterval ?? 5 * 60 * 1000, // 5 minutes default
    };
  }

  /**
   * Start the cleanup service
   */
  start(): void {
    if (this.intervalId) {
      console.log("Workflow cleanup service already running");
      return;
    }

    console.log("Starting workflow cleanup service", this.options);

    // Run cleanup immediately
    void this.performCleanup();

    // Schedule periodic cleanup
    this.intervalId = setInterval(() => {
      void this.performCleanup();
    }, this.options.checkInterval);
  }

  /**
   * Stop the cleanup service
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("Workflow cleanup service stopped");
    }
  }

  /**
   * Perform cleanup of stuck workflows and jobs
   */
  public async performCleanup(): Promise<void> {
    try {
      console.log("[WorkflowCleanup] Starting cleanup cycle");

      // Clean up stuck workflows
      await this.cleanupStuckWorkflows();

      // Finish anything an earlier timeout left open
      await this.resettleTimedOutRuns();

      // Clean up stuck jobs
      if (this.options.sweepJobs) {
        await this.cleanupStuckJobs();
      }

      console.log("[WorkflowCleanup] Cleanup cycle completed");
    } catch (error) {
      console.error("[WorkflowCleanup] Error during cleanup:", error);
    }
  }

  /**
   * Clean up workflows stuck in RUNNING state
   */
  private async cleanupStuckWorkflows(): Promise<void> {
    const cutoffTime = new Date(Date.now() - this.options.maxWorkflowAge);

    try {
      // Find stuck workflow executions
      const stuckRuns = await db
        .select({ id: workflowExecutions.id })
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.status, LogStatus.RUNNING),
            lt(workflowExecutions.startedAt, cutoffTime),
            isNull(workflowExecutions.completedAt),
          ),
        )
        .limit(100);

      if (stuckRuns.length === 0) {
        return;
      }

      console.log(
        `[WorkflowCleanup] Found ${stuckRuns.length} stuck workflow runs`,
      );

      for (const run of stuckRuns) {
        // One run that can't be updated must not hold up the rest of the batch
        await this.markWorkflowAsTimedOut(run.id).catch((error: unknown) => {
          console.error(
            `[WorkflowCleanup] Error marking workflow run ${run.id} as timed out:`,
            error,
          );
        });
      }
    } catch (error) {
      console.error("[WorkflowCleanup] Error cleaning up workflows:", error);
    }
  }

  /**
   * Clean up jobs stuck in RUNNING or CLAIMED state
   */
  private async cleanupStuckJobs(): Promise<void> {
    const cutoffTime = new Date(Date.now() - this.options.maxJobAge);

    try {
      // Find stuck jobs
      const stuckJobs = await db
        .select()
        .from(jobs)
        .where(
          and(
            or(
              eq(jobs.status, JobStatus.RUNNING),
              eq(jobs.status, JobStatus.CLAIMED),
            ),
            or(
              and(lt(jobs.startedAt, cutoffTime), isNull(jobs.completedAt)),
              and(isNull(jobs.startedAt), lt(jobs.createdAt, cutoffTime)),
            ),
          ),
        )
        .limit(100);

      if (stuckJobs.length === 0) {
        return;
      }

      console.log(`[WorkflowCleanup] Found ${stuckJobs.length} stuck jobs`);

      for (const job of stuckJobs) {
        await this.markJobAsTimedOut(job.id);
      }
    } catch (error) {
      console.error("[WorkflowCleanup] Error cleaning up jobs:", error);
    }
  }

  /**
   * Mark a workflow run as timed out, and settle what it leaves behind.
   *
   * `runId` is a workflow_executions id. Runs and workflows are numbered
   * separately, so the workflow and owner for the log line come from the run.
   *
   * Returns false if no run with that id is still running, and throws if the
   * run can't be updated. Past that point the run has timed out, so a failure
   * writing the log line or settling the rest is logged, not thrown, and neither
   * one stops the other. The sweep retries whatever settling didn't finish.
   */
  private async markWorkflowAsTimedOut(runId: number): Promise<boolean> {
    const now = new Date();

    console.log(`[WorkflowCleanup] Marking workflow run ${runId} as timed out`);

    // RUNNING only: the engine may have finished this run since the sweep read
    // it, and the admin route passes whatever id it was given. A finished run
    // keeps its result, and gets no timeout line.
    const [run] = await db
      .update(workflowExecutions)
      .set({
        status: LogStatus.TIMEOUT,
        completedAt: now,
        totalDuration: this.options.maxWorkflowAge,
      })
      .where(
        and(
          eq(workflowExecutions.id, runId),
          eq(workflowExecutions.status, LogStatus.RUNNING),
        ),
      )
      .returning({
        workflowId: workflowExecutions.workflowId,
        userId: workflowExecutions.userId,
      });

    if (!run) {
      console.log(
        `[WorkflowCleanup] Skipping workflow run ${runId}: not running`,
      );
      return false;
    }

    try {
      await db.insert(workflowLogs).values({
        workflowId: run.workflowId,
        userId: run.userId,
        status: LogStatus.TIMEOUT,
        startTime: now,
        level: WorkflowLogLevel.ERROR,
        message: `Workflow execution timed out after ${this.options.maxWorkflowAge / 1000}s`,
        timestamp: now,
      });
    } catch (error) {
      console.error(
        `[WorkflowCleanup] Error writing the timeout log for workflow run ${runId}:`,
        error,
      );
    }

    await this.settleTimedOutRun(runId);

    return true;
  }

  /**
   * Close out a timed-out run: time out its unfinished jobs, queued ones
   * included so they can't start later, then settle its steps and telemetry.
   * Jobs go first because a step follows its job. Logs failures rather than
   * throwing, and is safe to repeat.
   */
  async settleTimedOutRun(runId: number): Promise<void> {
    try {
      const unfinishedJobs = await db
        .select({ id: jobs.id, status: jobs.status })
        .from(jobs)
        .where(
          and(
            jobIsUnfinished,
            sql`${jobs.metadata}->>'workflowExecutionId' = ${String(runId)}`,
          ),
        );

      for (const job of unfinishedJobs) {
        await this.markJobAsTimedOut(
          job.id,
          job.status === JobStatus.QUEUED
            ? RUN_TIMED_OUT_BEFORE_JOB_STARTED
            : RUN_TIMED_OUT,
        );
      }
    } catch (error) {
      console.error(
        `[WorkflowCleanup] Error timing out the jobs of workflow run ${runId}:`,
        error,
      );
    }

    try {
      await settleTimedOutRunSteps(runId);
    } catch (error) {
      console.error(
        `[WorkflowCleanup] Error settling the steps of workflow run ${runId}:`,
        error,
      );
    }
  }

  /**
   * Retry runs that timed out with something still open: a job, a step, or a
   * telemetry row. That covers a failure or crash partway through
   * settleTimedOutRun, and runs that timed out before it existed.
   */
  private async resettleTimedOutRuns(): Promise<void> {
    try {
      const runs = await db
        .select({ id: workflowExecutions.id })
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.status, LogStatus.TIMEOUT),
            or(
              exists(
                db
                  .select({ id: workflowStepRuns.id })
                  .from(workflowStepRuns)
                  .where(
                    and(
                      eq(
                        workflowStepRuns.workflowExecutionId,
                        workflowExecutions.id,
                      ),
                      inArray(workflowStepRuns.status, [
                        WorkflowStepStatus.PENDING,
                        WorkflowStepStatus.DISPATCHED,
                      ]),
                    ),
                  ),
              ),
              exists(
                db
                  .select({ id: workflowExecutionEvents.id })
                  .from(workflowExecutionEvents)
                  .where(
                    and(
                      eq(
                        workflowExecutionEvents.workflowExecutionId,
                        workflowExecutions.id,
                      ),
                      eq(workflowExecutionEvents.status, LogStatus.RUNNING),
                    ),
                  ),
              ),
              exists(
                db
                  .select({ id: jobs.id })
                  .from(jobs)
                  .where(
                    and(
                      jobIsUnfinished,
                      sql`${jobs.metadata}->>'workflowExecutionId' = ${workflowExecutions.id}::text`,
                    ),
                  ),
              ),
            ),
          ),
        )
        .limit(100);

      for (const run of runs) {
        await this.settleTimedOutRun(run.id);
      }
    } catch (error) {
      console.error(
        "[WorkflowCleanup] Error settling timed-out workflow runs:",
        error,
      );
    }
  }

  /**
   * Mark a job as timed out. `reason` replaces the stock message when the job
   * didn't time out on its own account.
   */
  private async markJobAsTimedOut(
    jobId: string,
    reason?: string,
  ): Promise<void> {
    const now = new Date();
    const jobError = reason ?? "Job timed out - no response from executor";
    const logError = reason ?? "Job execution timed out";

    try {
      console.log(`[WorkflowCleanup] Marking job ${jobId} as timed out`);

      // Through the state machine: if the executor's real completion landed
      // first, this CAS is rejected and we leave the genuine result alone
      // (the old blind update raced it — review H3/D3).
      const { transitionJob } = await import("@/lib/scheduling/job-transition");
      const outcome = await transitionJob(jobId, JobStatus.TIMED_OUT, {
        actor: "sweeper",
        reason: jobError,
        set: {
          completedAt: now,
          lastError: jobError,
          result: {
            exitCode: -1,
            error: "Timeout",
          },
          activeKey: null,
        },
      });
      if (!outcome.ok) {
        console.log(
          `[WorkflowCleanup] Skipping job ${jobId}: ${outcome.error}`,
        );
        return;
      }

      // Update associated log if exists
      const [log] = await db
        .select()
        .from(logs)
        .where(eq(logs.jobId, jobId))
        .limit(1);

      if (log) {
        await db
          .update(logs)
          .set({
            status: LogStatus.TIMEOUT,
            endTime: now,
            error: logError,
            // A job that never started has no duration to report
            duration: outcome.job.startedAt
              ? now.getTime() - outcome.job.startedAt.getTime()
              : null,
          })
          .where(eq(logs.id, log.id));
      }

      // Update the execution still in progress, if any. A job queued for a retry
      // has earlier attempts here, and those keep their real results.
      await db
        .update(executions)
        .set({
          status: JobStatus.FAILED,
          completedAt: now,
          error: logError,
          exitCode: -1,
        })
        .where(
          and(eq(executions.jobId, jobId), isNull(executions.completedAt)),
        );
    } catch (error) {
      console.error(
        `[WorkflowCleanup] Error marking job ${jobId} as timed out:`,
        error,
      );
    }
  }

  /**
   * Manually time out one workflow run. `runId` is a workflow_executions id, not
   * a workflows id. Returns false if no run with that id is still running.
   */
  async cleanupWorkflow(runId: number): Promise<boolean> {
    return this.markWorkflowAsTimedOut(runId);
  }

  /**
   * Manually trigger cleanup of a specific job
   */
  async cleanupJob(jobId: string): Promise<void> {
    await this.markJobAsTimedOut(jobId);
  }

  /**
   * Get statistics about stuck items
   */
  async getStuckItemStats(): Promise<{
    stuckWorkflows: number;
    stuckJobs: number;
  }> {
    const workflowCutoff = new Date(Date.now() - this.options.maxWorkflowAge);
    const jobCutoff = new Date(Date.now() - this.options.maxJobAge);

    const [workflows] = await db
      .select({ count: sql<number>`count(*)` })
      .from(workflowExecutions)
      .where(
        and(
          eq(workflowExecutions.status, LogStatus.RUNNING),
          lt(workflowExecutions.startedAt, workflowCutoff),
          isNull(workflowExecutions.completedAt),
        ),
      );

    const [jobsResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(jobs)
      .where(
        and(
          or(
            eq(jobs.status, JobStatus.RUNNING),
            eq(jobs.status, JobStatus.CLAIMED),
          ),
          or(
            and(lt(jobs.startedAt, jobCutoff), isNull(jobs.completedAt)),
            and(isNull(jobs.startedAt), lt(jobs.createdAt, jobCutoff)),
          ),
        ),
      );

    return {
      stuckWorkflows: workflows?.count ?? 0,
      stuckJobs: jobsResult?.count ?? 0,
    };
  }
}

// Create a singleton instance
let cleanupService: WorkflowCleanupService | null = null;

/**
 * Get or create the cleanup service instance
 */
export function getCleanupService(): WorkflowCleanupService {
  cleanupService ??= new WorkflowCleanupService();
  return cleanupService;
}

/**
 * Initialize and start the cleanup service
 */
export function initializeCleanupService(options?: CleanupOptions): void {
  const service = getCleanupService();
  if (options) {
    // Recreate with new options
    service.stop();
    cleanupService = new WorkflowCleanupService(options);
  }
  cleanupService!.start();
}

/**
 * Stop the cleanup service
 */
export function stopCleanupService(): void {
  const service = getCleanupService();
  service.stop();
}
