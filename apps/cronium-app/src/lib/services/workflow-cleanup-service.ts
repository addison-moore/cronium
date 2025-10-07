/**
 * Workflow Cleanup Service
 *
 * Handles detection and cleanup of stuck workflows and jobs
 * Prevents workflows from being stuck in RUNNING state indefinitely
 */

import { db } from "@/server/db";
import {
  workflowExecutions,
  jobs,
  logs,
  workflowLogs,
  executions,
} from "@/shared/schema";
import { eq, and, lt, or, isNull, sql } from "drizzle-orm";
import { LogStatus, JobStatus, WorkflowLogLevel } from "@/shared/schema";

interface CleanupOptions {
  maxWorkflowAge?: number; // Max time a workflow can run (ms)
  maxJobAge?: number; // Max time a job can run (ms)
  checkInterval?: number; // How often to check for stuck items (ms)
}

export class WorkflowCleanupService {
  private intervalId: NodeJS.Timeout | null = null;
  private options: Required<CleanupOptions>;

  constructor(options: CleanupOptions = {}) {
    this.options = {
      maxWorkflowAge: options.maxWorkflowAge ?? 30 * 60 * 1000, // 30 minutes default
      maxJobAge: options.maxJobAge ?? 15 * 60 * 1000, // 15 minutes default
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

      // Clean up stuck jobs
      await this.cleanupStuckJobs();

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
      const stuckWorkflows = await db
        .select()
        .from(workflowExecutions)
        .where(
          and(
            eq(workflowExecutions.status, LogStatus.RUNNING),
            lt(workflowExecutions.startedAt, cutoffTime),
            isNull(workflowExecutions.completedAt),
          ),
        )
        .limit(100);

      if (stuckWorkflows.length === 0) {
        return;
      }

      console.log(
        `[WorkflowCleanup] Found ${stuckWorkflows.length} stuck workflows`,
      );

      for (const workflow of stuckWorkflows) {
        await this.markWorkflowAsTimedOut(workflow.id);
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
   * Mark a workflow execution as timed out
   */
  private async markWorkflowAsTimedOut(workflowId: number): Promise<void> {
    const now = new Date();

    try {
      console.log(
        `[WorkflowCleanup] Marking workflow ${workflowId} as timed out`,
      );

      // Update workflow execution
      await db
        .update(workflowExecutions)
        .set({
          status: LogStatus.TIMEOUT,
          completedAt: now,
          totalDuration: this.options.maxWorkflowAge,
        })
        .where(eq(workflowExecutions.id, workflowId));

      // Add a timeout log entry
      await db.insert(workflowLogs).values({
        workflowId,
        status: LogStatus.TIMEOUT,
        startTime: now,
        level: WorkflowLogLevel.ERROR,
        message: `Workflow execution timed out after ${this.options.maxWorkflowAge / 1000}s`,
        timestamp: now,
      });

      // Also mark any associated running jobs as timed out
      // Find jobs associated with this workflow
      // Note: We need to check metadata JSON field differently
      const allJobs = await db.select().from(jobs);
      const runningJobs = allJobs.filter((job) => {
        const metadata = job.metadata as Record<string, unknown>;
        return (
          metadata?.workflowExecutionId === workflowId &&
          (job.status === JobStatus.RUNNING || job.status === JobStatus.CLAIMED)
        );
      });

      for (const job of runningJobs) {
        await this.markJobAsTimedOut(job.id);
      }
    } catch (error) {
      console.error(
        `[WorkflowCleanup] Error marking workflow ${workflowId} as timed out:`,
        error,
      );
    }
  }

  /**
   * Mark a job as timed out
   */
  private async markJobAsTimedOut(jobId: string): Promise<void> {
    const now = new Date();

    try {
      console.log(`[WorkflowCleanup] Marking job ${jobId} as timed out`);

      // Update job status
      await db
        .update(jobs)
        .set({
          status: JobStatus.FAILED,
          completedAt: now,
          lastError: "Job timed out - no response from executor",
          result: {
            exitCode: -1,
            error: "Timeout",
          },
        })
        .where(eq(jobs.id, jobId));

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
            error: "Job execution timed out",
            duration: this.options.maxJobAge,
          })
          .where(eq(logs.id, log.id));
      }

      // Update executions table if exists
      await db
        .update(executions)
        .set({
          status: JobStatus.FAILED as JobStatus,
          completedAt: now,
          error: "Job execution timed out",
          exitCode: -1,
        })
        .where(eq(executions.jobId, jobId));
    } catch (error) {
      console.error(
        `[WorkflowCleanup] Error marking job ${jobId} as timed out:`,
        error,
      );
    }
  }

  /**
   * Manually trigger cleanup of a specific workflow
   */
  async cleanupWorkflow(workflowId: number): Promise<void> {
    await this.markWorkflowAsTimedOut(workflowId);
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
