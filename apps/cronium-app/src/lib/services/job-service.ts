import { db } from "@server/db";
import {
  type Job,
  JobStatus,
  type JobType,
  type ScriptType,
  JobPriority,
  jobs as jobsTable,
  LogStatus,
} from "@shared/schema";
import { eq, desc, and, or, isNull, lte, gte } from "drizzle-orm";
import { customAlphabet } from "nanoid";

// Use only alphanumeric characters for job IDs to avoid issues with dashes
const generateJobId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  12,
);
import { storage } from "@server/storage";

// Job queue management service
export interface CreateJobInput {
  eventId: number;
  userId: string;
  type: JobType;
  priority?: JobPriority;
  payload: {
    script?: {
      type: ScriptType;
      content: string;
    };
    httpRequest?: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: string;
    };
    toolAction?: {
      toolType: string;
      config: Record<string, unknown>;
    };
    environment?: Record<string, string>;
    target?: {
      serverId?: number;
      containerImage?: string;
    };
    input?: Record<string, unknown>;
    workflowId?: number;
    executionLogId?: number;
    timeout?: {
      value: number;
      unit: string;
    };
    retries?: number;
  };
  scheduledFor?: Date;
  metadata?: Record<string, unknown>;
}

export interface UpdateJobInput {
  status?: JobStatus;
  orchestratorId?: string | undefined;
  startedAt?: Date | undefined;
  completedAt?: Date | undefined;
  result?: {
    exitCode?: number;
    output?: string;
    error?: string;
    metrics?: Record<string, unknown>;
  };
  attempts?: number;
  lastError?: string;
}

export interface JobFilter {
  status?: JobStatus | JobStatus[];
  orchestratorId?: string;
  userId?: string;
  eventId?: number;
  priority?: JobPriority;
  scheduledBefore?: Date;
  completedAfter?: Date;
}

export class JobService {
  private db = db;

  constructor() {
    // db is already initialized from import
  }

  /**
   * Create a new job in the queue
   */
  async createJob(input: CreateJobInput): Promise<Job> {
    const jobId = `job_${generateJobId()}`;

    const [job] = await this.db
      .insert(jobsTable)
      .values({
        id: jobId,
        eventId: input.eventId,
        userId: input.userId,
        type: input.type,
        status: JobStatus.QUEUED,
        priority: input.priority ?? JobPriority.NORMAL,
        payload: input.payload,
        scheduledFor: input.scheduledFor ?? new Date(),
        metadata: input.metadata ?? {},
        attempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return job!;
  }

  /**
   * Get a job by ID
   */
  async getJob(jobId: string): Promise<Job | null> {
    const [job] = await this.db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1);

    return job ?? null;
  }

  /**
   * List jobs with filtering and pagination
   */
  async listJobs(
    filter: JobFilter = {},
    limit = 50,
    offset = 0,
  ): Promise<{ jobs: Job[]; total: number }> {
    const conditions = [];

    // Build filter conditions
    if (filter.status) {
      if (Array.isArray(filter.status)) {
        conditions.push(
          or(...filter.status.map((s) => eq(jobsTable.status, s))),
        );
      } else {
        conditions.push(eq(jobsTable.status, filter.status));
      }
    }

    if (filter.orchestratorId) {
      conditions.push(eq(jobsTable.orchestratorId, filter.orchestratorId));
    }

    if (filter.userId) {
      conditions.push(eq(jobsTable.userId, filter.userId));
    }

    if (filter.eventId) {
      conditions.push(eq(jobsTable.eventId, filter.eventId));
    }

    if (filter.priority) {
      conditions.push(eq(jobsTable.priority, filter.priority));
    }

    if (filter.scheduledBefore) {
      conditions.push(lte(jobsTable.scheduledFor, filter.scheduledBefore));
    }

    if (filter.completedAfter) {
      conditions.push(gte(jobsTable.completedAt, filter.completedAfter));
    }

    // Build query
    const query = this.db
      .select()
      .from(jobsTable)
      .orderBy(desc(jobsTable.priority), desc(jobsTable.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    const jobs = await query;

    // Get total count
    const countQuery = this.db.select({ count: jobsTable.id }).from(jobsTable);

    if (conditions.length > 0) {
      countQuery.where(and(...conditions));
    }

    const countResult = await countQuery;
    const count = countResult[0]?.count ?? "0";

    return {
      jobs,
      total: Number(count),
    };
  }

  /**
   * Update a job
   */
  async updateJob(jobId: string, update: UpdateJobInput): Promise<Job | null> {
    // Build update object, handling explicit undefined values
    const updateData: Partial<Job> & { updatedAt: Date } = {
      updatedAt: new Date(),
    };

    // Handle fields that can be explicitly set to undefined/null
    if ("status" in update) updateData.status = update.status;
    if ("orchestratorId" in update)
      updateData.orchestratorId = update.orchestratorId ?? null;
    if ("startedAt" in update) updateData.startedAt = update.startedAt ?? null;
    if ("completedAt" in update)
      updateData.completedAt = update.completedAt ?? null;
    if ("result" in update) updateData.result = update.result;
    if ("attempts" in update) updateData.attempts = update.attempts;
    if ("lastError" in update) updateData.lastError = update.lastError;

    const [updated] = await this.db
      .update(jobsTable)
      .set(updateData)
      .where(eq(jobsTable.id, jobId))
      .returning();

    return updated ?? null;
  }

  /**
   * Claim jobs for processing by an orchestrator
   */
  async claimJobs(
    orchestratorId: string,
    batchSize = 10,
    jobTypes?: JobType[],
  ): Promise<Job[]> {
    // Find unclaimed jobs that are scheduled to run
    const conditions = [
      eq(jobsTable.status, JobStatus.QUEUED),
      isNull(jobsTable.orchestratorId),
      lte(jobsTable.scheduledFor, new Date()),
    ];

    if (jobTypes && jobTypes.length > 0) {
      const typeCondition = or(
        ...jobTypes.map((type) => eq(jobsTable.type, type)),
      );
      if (typeCondition) {
        conditions.push(typeCondition);
      }
    }

    // Get eligible jobs
    const eligibleJobs = await this.db
      .select()
      .from(jobsTable)
      .where(and(...conditions))
      .orderBy(desc(jobsTable.priority), jobsTable.createdAt)
      .limit(batchSize);

    if (eligibleJobs.length === 0) {
      return [];
    }

    // Claim the jobs by updating them
    const jobIds = eligibleJobs.map((j) => j.id);
    await this.db
      .update(jobsTable)
      .set({
        orchestratorId,
        status: JobStatus.CLAIMED,
        updatedAt: new Date(),
      })
      .where(
        and(
          or(...jobIds.map((id) => eq(jobsTable.id, id))),
          eq(jobsTable.status, JobStatus.QUEUED),
          isNull(jobsTable.orchestratorId),
        ),
      );

    // Return the claimed jobs
    return this.db
      .select()
      .from(jobsTable)
      .where(
        and(
          or(...jobIds.map((id) => eq(jobsTable.id, id))),
          eq(jobsTable.orchestratorId, orchestratorId),
        ),
      );
  }

  /**
   * Mark a job as started
   */
  async startJob(jobId: string): Promise<Job | null> {
    return this.updateJob(jobId, {
      status: JobStatus.RUNNING,
      startedAt: new Date(),
    });
  }

  /**
   * Complete a job with results
   */
  async completeJob(
    jobId: string,
    result: UpdateJobInput["result"],
  ): Promise<Job | null> {
    const isSuccess = !result?.error && result?.exitCode === 0;

    // Only store minimal data in result (exit code, metrics)
    // Output is now stored in execution records
    const minimalResult: UpdateJobInput["result"] = {};
    if (result?.exitCode !== undefined) {
      minimalResult.exitCode = result.exitCode;
    }
    if (result?.metrics !== undefined) {
      minimalResult.metrics = result.metrics;
    }

    return this.updateJob(jobId, {
      status: isSuccess ? JobStatus.COMPLETED : JobStatus.FAILED,
      completedAt: new Date(),
      result: minimalResult,
    });
  }

  /**
   * Fail a job with error
   */
  async failJob(jobId: string, error: string): Promise<Job | null> {
    const job = await this.getJob(jobId);
    if (!job) return null;

    return this.updateJob(jobId, {
      status: JobStatus.FAILED,
      completedAt: new Date(),
      lastError: error,
      attempts: (job.attempts || 0) + 1,
      result: {
        exitCode: 1,
      },
    });
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<Job | null> {
    return this.updateJob(jobId, {
      status: JobStatus.CANCELLED,
      completedAt: new Date(),
    });
  }

  /**
   * Get job statistics
   */
  async getJobStats(userId?: string): Promise<{
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  }> {
    const baseCondition = userId ? eq(jobsTable.userId, userId) : undefined;

    const stats = await Promise.all([
      this.db
        .select({ count: jobsTable.id })
        .from(jobsTable)
        .where(baseCondition),
      this.db
        .select({ count: jobsTable.id })
        .from(jobsTable)
        .where(and(baseCondition, eq(jobsTable.status, JobStatus.QUEUED))),
      this.db
        .select({ count: jobsTable.id })
        .from(jobsTable)
        .where(
          and(
            baseCondition,
            or(
              eq(jobsTable.status, JobStatus.RUNNING),
              eq(jobsTable.status, JobStatus.CLAIMED),
            ),
          ),
        ),
      this.db
        .select({ count: jobsTable.id })
        .from(jobsTable)
        .where(and(baseCondition, eq(jobsTable.status, JobStatus.COMPLETED))),
      this.db
        .select({ count: jobsTable.id })
        .from(jobsTable)
        .where(and(baseCondition, eq(jobsTable.status, JobStatus.FAILED))),
      this.db
        .select({ count: jobsTable.id })
        .from(jobsTable)
        .where(and(baseCondition, eq(jobsTable.status, JobStatus.CANCELLED))),
    ]);

    return {
      total: Number(stats[0][0]?.count ?? 0),
      queued: Number(stats[1][0]?.count ?? 0),
      running: Number(stats[2][0]?.count ?? 0),
      completed: Number(stats[3][0]?.count ?? 0),
      failed: Number(stats[4][0]?.count ?? 0),
      cancelled: Number(stats[5][0]?.count ?? 0),
    };
  }

  /**
   * Clean up old jobs
   */
  async cleanupOldJobs(olderThanDays = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.db
      .delete(jobsTable)
      .where(
        and(
          lte(jobsTable.completedAt, cutoffDate),
          or(
            eq(jobsTable.status, JobStatus.COMPLETED),
            eq(jobsTable.status, JobStatus.FAILED),
            eq(jobsTable.status, JobStatus.CANCELLED),
          ),
        ),
      );

    return result.rowCount ?? 0;
  }

  /**
   * Update job status and associated log status
   */
  async updateJobStatus(
    jobId: string,
    status: JobStatus,
    data?: {
      output?: string;
      error?: string;
      exitCode?: number;
      startedAt?: Date;
      completedAt?: Date;
      metrics?: Record<string, unknown>;
      result?: Record<string, unknown>; // Accept full result object
    },
  ): Promise<Job | null> {
    // Update the job
    const updateInput: UpdateJobInput = {
      status,
    };

    if (data?.startedAt !== undefined) {
      updateInput.startedAt = data.startedAt;
    }
    if (data?.completedAt !== undefined) {
      updateInput.completedAt = data.completedAt;
    }
    if (data) {
      // If result is provided directly, use it (for scriptOutput, condition, etc.)
      if (data.result !== undefined) {
        updateInput.result = data.result;
      } else {
        // Otherwise build minimal result from exitCode and metrics
        const result: UpdateJobInput["result"] = {};
        if (data.exitCode !== undefined) result.exitCode = data.exitCode;
        if (data.metrics !== undefined) result.metrics = data.metrics;

        if (Object.keys(result).length > 0) {
          updateInput.result = result;
        }
      }
    }

    const job = await this.updateJob(jobId, updateInput);

    if (!job) return null;

    // Extract executionLogId from job payload or metadata
    const payload = job.payload as { executionLogId?: number } | undefined;
    const metadata = job.metadata as { executionLogId?: number } | undefined;
    const executionLogId = payload?.executionLogId ?? metadata?.executionLogId;

    if (executionLogId) {
      // Map job status to log status (include exitCode for partial success detection)
      const logStatusData: Parameters<
        JobService["mapJobStatusToLogStatus"]
      >[1] = {};
      if (data?.error !== undefined) {
        logStatusData.error = data.error;
      }
      if (data?.exitCode !== undefined) {
        logStatusData.exitCode = data.exitCode;
      }
      const logStatus = this.mapJobStatusToLogStatus(status, logStatusData);

      // Get the existing log to calculate duration
      const existingLog = await storage.getLog(executionLogId);

      // Calculate duration if job is completing
      let duration: number | undefined;
      const isCompleting =
        status === JobStatus.COMPLETED ||
        status === JobStatus.FAILED ||
        status === JobStatus.CANCELLED;

      if (isCompleting && existingLog?.startTime) {
        const endTime = new Date();
        duration =
          endTime.getTime() - new Date(existingLog.startTime).getTime();
      }

      // Update the associated log
      const logUpdateData: Parameters<typeof storage.updateLog>[1] = {
        status: logStatus,
        endTime: isCompleting ? new Date() : undefined,
        duration,
      };

      // Only include output/error if they are defined (not undefined)
      if (data?.output !== undefined) {
        logUpdateData.output = data.output;
      }
      if (data?.error !== undefined) {
        logUpdateData.error = data.error;
      }

      const updatedLog = await storage.updateLog(executionLogId, logUpdateData);

      // Trigger conditional actions if job is completing
      if (isCompleting && job.eventId) {
        try {
          const {
            handleSuccessActions,
            handleFailureActions,
            handleAlwaysActions,
            handleConditionActions,
            processEvent,
          } = await import("@/lib/scheduler/event-handlers");

          // Always trigger "always" actions regardless of success/failure
          await handleAlwaysActions(job.eventId, processEvent);

          // Trigger success or failure actions based on status
          if (status === JobStatus.COMPLETED) {
            await handleSuccessActions(job.eventId, processEvent);
          } else if (status === JobStatus.FAILED) {
            await handleFailureActions(job.eventId, processEvent);
          }

          // Handle condition-based actions if a condition was set
          if (job.result && typeof job.result === "object") {
            const result = job.result as Record<string, unknown>;
            if (typeof result.condition === "boolean") {
              await handleConditionActions(
                job.eventId,
                result.condition,
                processEvent,
              );
            }
          }
        } catch (error) {
          console.error("Error triggering conditional actions:", error);
          // Don't fail the job update if conditional actions fail
        }
      }

      // Broadcast the update via enhanced broadcaster
      try {
        const { getWebSocketBroadcaster } = await import(
          "@/lib/websocket-broadcaster"
        );
        const broadcaster = getWebSocketBroadcaster();

        const result = await broadcaster.broadcastLogUpdate(executionLogId, {
          status: updatedLog.status,
          output: updatedLog.output,
          error: updatedLog.error,
          endTime: updatedLog.endTime,
          duration: updatedLog.duration,
        });

        if (!result.success) {
          console.error(
            `[JobService] Broadcast failed after ${result.attempts} attempts: ${String(result.error ?? "Unknown error")}`,
          );
        } else if (result.attempts > 1) {
          console.log(
            `[JobService] Broadcast succeeded after ${result.attempts} attempts`,
          );
        }
      } catch (error) {
        console.error("[JobService] Error sending broadcast:", error);
      }
    }

    return job;
  }

  /**
   * Map job status to log status
   */
  private mapJobStatusToLogStatus(
    jobStatus: JobStatus,
    data?: {
      error?: string;
      exitCode?: number;
      serverResults?: Array<{ status: string }>;
    },
  ): LogStatus {
    // Check for timeout (either by error message or exit code -1)
    if (jobStatus === JobStatus.FAILED) {
      // Check exit code -1 (timeout indicator)
      if (data?.exitCode === -1) {
        return LogStatus.TIMEOUT;
      }
      // Check error message for timeout
      if (
        data?.error &&
        typeof data.error === "string" &&
        (data.error.toLowerCase().includes("timeout") ||
          data.error.toLowerCase().includes("timed out"))
      ) {
        return LogStatus.TIMEOUT;
      }
    }

    // Handle multi-server partial success
    // Exit codes 100+ indicate partial success (100 + number of failed servers)
    if (jobStatus === JobStatus.COMPLETED) {
      if (data?.exitCode && data.exitCode >= 100) {
        return LogStatus.PARTIAL;
      }
      if (data?.serverResults) {
        const hasFailures = data.serverResults.some(
          (r) => r.status !== "SUCCESS",
        );
        if (hasFailures) return LogStatus.PARTIAL;
      }
    }

    // Map job status to log status
    switch (jobStatus) {
      case JobStatus.QUEUED:
      case JobStatus.CLAIMED:
        return LogStatus.PENDING;
      case JobStatus.RUNNING:
        return LogStatus.RUNNING;
      case JobStatus.COMPLETED:
        return LogStatus.SUCCESS;
      case JobStatus.FAILED:
        return LogStatus.FAILURE;
      case JobStatus.CANCELLED:
        return LogStatus.FAILURE;
      default:
        return LogStatus.RUNNING;
    }
  }
}

// Export singleton instance
export const jobService = new JobService();
