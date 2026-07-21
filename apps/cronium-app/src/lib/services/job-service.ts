import { db } from "@server/db";
import {
  type Job,
  JobStatus,
  JobType,
  type ScriptType,
  JobPriority,
  type JobSource,
  type LeaseLossPolicy,
  jobs as jobsTable,
  jobTransitions,
  LogStatus,
} from "@shared/schema";
import { transitionJob } from "@/lib/scheduling/job-transition";
import {
  eq,
  ne,
  desc,
  and,
  or,
  isNull,
  lte,
  gte,
  inArray,
  sql,
} from "drizzle-orm";

/** Claim-lease duration; owners renew via heartbeat well inside this window
 * (orchestrator heartbeats every ~20s). */
export const DEFAULT_CLAIM_LEASE_MS = 60_000;
import { customAlphabet } from "nanoid";

// Use only alphanumeric characters for job IDs to avoid issues with dashes
const generateJobId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  12,
);
import { storage } from "@server/storage";
import { shouldRetry, computeRetryBackoffMs } from "./retry-policy";

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
  // Scheduling kernel fields (PLAN.md §3.2); all resolved by dispatchEventJob
  source?: JobSource;
  timeoutMs?: number;
  maxAttempts?: number;
  leaseLossPolicy?: LeaseLossPolicy;
  activeKey?: string;
  scheduledMiss?: boolean;
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
  lastError?: string | undefined;
  scheduledFor?: Date;
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
        source: input.source ?? null,
        timeoutMs: input.timeoutMs ?? null,
        maxAttempts: input.maxAttempts ?? 0,
        ...(input.leaseLossPolicy && {
          leaseLossPolicy: input.leaseLossPolicy,
        }),
        activeKey: input.activeKey ?? null,
        scheduledMiss: input.scheduledMiss ?? false,
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
    if ("lastError" in update) updateData.lastError = update.lastError ?? null;
    if ("scheduledFor" in update && update.scheduledFor)
      updateData.scheduledFor = update.scheduledFor;

    const [updated] = await this.db
      .update(jobsTable)
      .set(updateData)
      .where(eq(jobsTable.id, jobId))
      .returning();

    return updated ?? null;
  }

  /**
   * Claim SCRIPT jobs for an orchestrator (PLAN.md §4.2): one transaction,
   * FOR UPDATE SKIP LOCKED, stamping ownership plus a lease the owner must
   * keep renewing via heartbeatJobs — an expired lease hands the job to the
   * sweeper. Tool actions and HTTP requests are claimed by the scheduling
   * worker's own pool, never by orchestrators.
   */
  async claimJobs(
    orchestratorId: string,
    batchSize = 10,
    leaseMs: number = DEFAULT_CLAIM_LEASE_MS,
  ): Promise<Job[]> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const eligible = await tx
        .select({ id: jobsTable.id })
        .from(jobsTable)
        .where(
          and(
            eq(jobsTable.status, JobStatus.QUEUED),
            isNull(jobsTable.orchestratorId),
            lte(jobsTable.scheduledFor, now),
            ne(jobsTable.type, JobType.TOOL_ACTION),
            ne(jobsTable.type, JobType.HTTP_REQUEST),
          ),
        )
        .orderBy(desc(jobsTable.priority), jobsTable.createdAt)
        .limit(batchSize)
        .for("update", { skipLocked: true });

      if (eligible.length === 0) return [];

      const claimed = await tx
        .update(jobsTable)
        .set({
          status: JobStatus.CLAIMED,
          orchestratorId,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          updatedAt: now,
        })
        .where(
          inArray(
            jobsTable.id,
            eligible.map((row) => row.id),
          ),
        )
        .returning();

      await tx.insert(jobTransitions).values(
        claimed.map((job) => ({
          jobId: job.id,
          fromStatus: JobStatus.QUEUED,
          toStatus: JobStatus.CLAIMED,
          actor: `orchestrator:${orchestratorId}`,
        })),
      );

      return claimed;
    });
  }

  /**
   * Renew leases for an owner's in-flight jobs and report which of them have
   * cancellation requested — the return channel that makes UI cancel actually
   * reach a running container (review D3).
   */
  async heartbeatJobs(
    orchestratorId: string,
    jobIds: string[],
    leaseMs: number = DEFAULT_CLAIM_LEASE_MS,
  ): Promise<{ extended: string[]; cancelRequested: string[] }> {
    if (jobIds.length === 0) return { extended: [], cancelRequested: [] };
    const now = new Date();
    const updated = await this.db
      .update(jobsTable)
      .set({
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      })
      .where(
        and(
          inArray(jobsTable.id, jobIds),
          eq(jobsTable.orchestratorId, orchestratorId),
          inArray(jobsTable.status, [JobStatus.CLAIMED, JobStatus.RUNNING]),
        ),
      )
      .returning({
        id: jobsTable.id,
        cancelRequested: jobsTable.cancelRequested,
      });

    return {
      extended: updated.map((row) => row.id),
      cancelRequested: updated
        .filter((row) => row.cancelRequested)
        .map((row) => row.id),
    };
  }

  /**
   * Mark a job as started
   */
  async startJob(jobId: string, actor = "app"): Promise<Job | null> {
    const outcome = await transitionJob(jobId, JobStatus.RUNNING, {
      actor,
      set: { startedAt: new Date() },
    });
    return outcome.ok ? outcome.job : null;
  }

  /**
   * Complete a job with results
   */
  async completeJob(
    jobId: string,
    result: UpdateJobInput["result"],
    actor = "app",
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

    const outcome = await transitionJob(
      jobId,
      isSuccess ? JobStatus.COMPLETED : JobStatus.FAILED,
      {
        actor,
        set: {
          completedAt: new Date(),
          result: minimalResult,
          // Terminal: release the overlap slot
          activeKey: null,
        },
      },
    );
    return outcome.ok ? outcome.job : null;
  }

  /**
   * Fail a job with error
   */
  async failJob(
    jobId: string,
    error: string,
    actor = "app",
  ): Promise<Job | null> {
    const job = await this.getJob(jobId);
    if (!job) return null;

    const outcome = await transitionJob(jobId, JobStatus.FAILED, {
      actor,
      reason: error,
      set: {
        completedAt: new Date(),
        lastError: error,
        attempts: (job.attempts || 0) + 1,
        result: { exitCode: 1 },
        activeKey: null,
      },
    });
    return outcome.ok ? outcome.job : null;
  }

  /**
   * Cancel a job. cancelRequested is set so a future cooperative-cancel
   * consumer (orchestrator heartbeat) can observe it even when the CAS to
   * CANCELLED is rejected because the job is already terminal.
   */
  async cancelJob(jobId: string, actor = "app"): Promise<Job | null> {
    await this.db
      .update(jobsTable)
      .set({ cancelRequested: true, updatedAt: new Date() })
      .where(eq(jobsTable.id, jobId));

    const outcome = await transitionJob(jobId, JobStatus.CANCELLED, {
      actor,
      set: { completedAt: new Date(), activeKey: null },
    });
    return outcome.ok ? outcome.job : null;
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
   * If a failed job still has retry budget (payload.retries), requeue it with
   * an exponential backoff delay and return the updated job. Otherwise return
   * null so the caller finalizes it as FAILED. Backoff: 5s · 2^attempts,
   * capped at 5 minutes.
   */
  private async maybeRequeueFailedJob(
    jobId: string,
    error?: string,
  ): Promise<Job | null> {
    const job = await this.getJob(jobId);
    if (!job) return null;

    const payload = job.payload as { retries?: number } | undefined;
    // maxAttempts column (set by dispatchEventJob); legacy jobs carried the
    // budget in payload.retries
    const maxAttempts = job.maxAttempts || (payload?.retries ?? 0);
    const currentAttempts = job.attempts ?? 0;

    if (!shouldRetry(currentAttempts, maxAttempts)) {
      return null;
    }

    const nextAttempt = currentAttempts + 1;
    const backoffMs = computeRetryBackoffMs(currentAttempts);
    const scheduledFor = new Date(Date.now() + backoffMs);

    const outcome = await transitionJob(jobId, JobStatus.QUEUED, {
      actor: "app",
      reason: `retry ${nextAttempt}/${maxAttempts}: ${error ?? "unknown error"}`,
      set: {
        orchestratorId: null,
        startedAt: null,
        completedAt: null,
        leaseExpiresAt: null,
        attempts: nextAttempt,
        lastError: error ?? null,
        scheduledFor,
      },
    });
    const requeued = outcome.ok ? outcome.job : null;
    if (!requeued) return null;

    console.log(
      `[JobService] Job ${jobId} failed (attempt ${nextAttempt}/${maxAttempts}); ` +
        `requeued for retry in ${Math.round(backoffMs / 1000)}s`,
    );

    // Record the retry on the execution log without finalizing it
    const meta = job.payload as { executionLogId?: number } | undefined;
    const metadata = job.metadata as { executionLogId?: number } | undefined;
    const executionLogId = meta?.executionLogId ?? metadata?.executionLogId;
    if (executionLogId) {
      try {
        await storage.updateLog(executionLogId, {
          status: LogStatus.RUNNING,
          error: `Attempt ${currentAttempts + 1} failed, retrying in ${Math.round(
            backoffMs / 1000,
          )}s: ${error ?? "unknown error"}`,
        });
      } catch (logError) {
        console.error(
          "[JobService] Failed to record retry on execution log:",
          logError,
        );
      }
    }

    return requeued;
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
      executionDuration?: number; // Actual script execution time in milliseconds
      setupDuration?: number; // Setup time in milliseconds
    },
    actor?: string,
  ): Promise<Job | null> {
    // Retry-with-backoff: when a job fails but has retry budget left, requeue
    // it with an exponential backoff delay instead of finalizing as FAILED.
    // This runs before any log finalization / conditional-action side effects.
    if (status === JobStatus.FAILED) {
      const retried = await this.maybeRequeueFailedJob(jobId, data?.error);
      if (retried) {
        return retried;
      }
    }

    // Build the column updates that ride along with the status change
    const set: Parameters<typeof transitionJob>[2]["set"] = {};

    if (data?.startedAt !== undefined) {
      set.startedAt = data.startedAt;
    }
    if (data?.completedAt !== undefined) {
      set.completedAt = data.completedAt;
    }
    if (data) {
      // If result is provided directly, use it (for scriptOutput, condition, etc.)
      // Written as a jsonb MERGE, not a replace: a concurrent runtime write
      // (cronium.output() → result.output) landing between read and report can
      // no longer be lost (review D7).
      if (data.result !== undefined) {
        set.result = sql`COALESCE(${jobsTable.result}, '{}'::jsonb) || ${JSON.stringify(data.result)}::jsonb`;
      } else {
        // Otherwise build minimal result from exitCode and metrics
        const result: NonNullable<UpdateJobInput["result"]> = {};
        if (data.exitCode !== undefined) result.exitCode = data.exitCode;
        if (data.metrics !== undefined) result.metrics = data.metrics;

        if (Object.keys(result).length > 0) {
          set.result = sql`COALESCE(${jobsTable.result}, '{}'::jsonb) || ${JSON.stringify(result)}::jsonb`;
        }
      }
    }

    const isTerminal =
      status === JobStatus.COMPLETED ||
      status === JobStatus.FAILED ||
      status === JobStatus.TIMED_OUT ||
      status === JobStatus.CANCELLED;
    if (isTerminal) {
      // Release the overlap slot
      set.activeKey = null;
    }

    // CAS through the state machine: late/duplicate reports against a job
    // that already reached a terminal state are rejected here (review D3)
    // instead of silently overwriting it.
    const outcome = await transitionJob(jobId, status, {
      actor: actor ?? "app",
      ...(data?.error !== undefined && { reason: data.error }),
      set,
    });
    if (!outcome.ok) {
      console.warn(
        `[JobService] Status update to ${status} rejected for job ${jobId}: ${outcome.error}`,
      );
      return null;
    }
    const job = outcome.job;

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
        status === JobStatus.TIMED_OUT ||
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

      // Include timing information if available
      if (data?.executionDuration !== undefined) {
        logUpdateData.executionDuration = data.executionDuration;
      }
      if (data?.setupDuration !== undefined) {
        logUpdateData.setupDuration = data.setupDuration;
      }

      const updatedLog = await storage.updateLog(executionLogId, logUpdateData);

      // Broadcast the update via enhanced broadcaster
      try {
        const { getWebSocketBroadcaster } =
          await import("@/lib/websocket-broadcaster");
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
      case JobStatus.TIMED_OUT:
        return LogStatus.TIMEOUT;
      case JobStatus.CANCELLED:
        return LogStatus.FAILURE;
      default:
        return LogStatus.RUNNING;
    }
  }
}

// Export singleton instance
export const jobService = new JobService();
