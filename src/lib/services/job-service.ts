import { db } from "@server/db";
import {
  type Job,
  JobStatus,
  type JobType,
  type ScriptType,
  JobPriority,
  jobs as jobsTable,
} from "@shared/schema";
import { eq, desc, and, or, isNull, lte, gte } from "drizzle-orm";
import { nanoid } from "nanoid";

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
  orchestratorId?: string;
  startedAt?: Date;
  completedAt?: Date;
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
    const jobId = `job_${nanoid(12)}`;

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
    const [updated] = await this.db
      .update(jobsTable)
      .set({
        ...update,
        updatedAt: new Date(),
      })
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

    // Store logs in the result field
    const updatedResult = {
      ...result,
      logs: result?.output, // Store output as logs for backward compatibility
    };

    return this.updateJob(jobId, {
      status: isSuccess ? JobStatus.COMPLETED : JobStatus.FAILED,
      completedAt: new Date(),
      result: updatedResult,
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
        error,
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
}

// Export singleton instance
export const jobService = new JobService();
