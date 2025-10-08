import { db } from "@server/db";
import {
  type Execution,
  type InsertExecution,
  JobStatus,
  executions as executionsTable,
} from "@shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";

export interface CreateExecutionInput {
  id: string; // Format: exec-${jobId}-${timestamp}
  jobId: string;
  serverId?: number | null;
  serverName?: string | null;
  status?: JobStatus;
  metadata?: Record<string, unknown>;
}

export interface UpdateExecutionInput {
  status?: JobStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  exitCode?: number | null;
  output?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
  // Phase-based timing fields
  setupStartedAt?: Date | null;
  setupCompletedAt?: Date | null;
  executionStartedAt?: Date | null;
  executionCompletedAt?: Date | null;
  cleanupStartedAt?: Date | null;
  cleanupCompletedAt?: Date | null;
  setupDuration?: number | null;
  executionDuration?: number | null;
  cleanupDuration?: number | null;
  totalDuration?: number | null;
  executionMetadata?: Record<string, unknown> | null;
}

export class ExecutionService {
  private db = db;

  constructor() {
    // db is already initialized from import
  }

  /**
   * Create a new execution record
   */
  async createExecution(input: CreateExecutionInput): Promise<Execution> {
    const [execution] = await this.db
      .insert(executionsTable)
      .values({
        id: input.id,
        jobId: input.jobId,
        serverId: input.serverId ?? null,
        serverName: input.serverName ?? null,
        status: input.status ?? JobStatus.QUEUED,
        metadata: input.metadata ?? {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return execution!;
  }

  /**
   * Get an execution by ID
   */
  async getExecution(executionId: string): Promise<Execution | null> {
    const [execution] = await this.db
      .select()
      .from(executionsTable)
      .where(eq(executionsTable.id, executionId))
      .limit(1);

    return execution ?? null;
  }

  /**
   * Get an execution by job ID (for single server execution)
   */
  async getExecutionByJobId(jobId: string): Promise<Execution | null> {
    const [execution] = await this.db
      .select()
      .from(executionsTable)
      .where(eq(executionsTable.jobId, jobId))
      .orderBy(desc(executionsTable.createdAt))
      .limit(1);

    return execution ?? null;
  }

  /**
   * Get all executions for a job (for multi-server execution)
   */
  async getExecutionsByJobId(jobId: string): Promise<Execution[]> {
    return await this.db
      .select()
      .from(executionsTable)
      .where(eq(executionsTable.jobId, jobId))
      .orderBy(executionsTable.createdAt);
  }

  /**
   * Update an execution
   */
  async updateExecution(
    executionId: string,
    input: UpdateExecutionInput,
  ): Promise<Execution | null> {
    const updateData: Partial<InsertExecution> = {
      ...input,
      updatedAt: new Date(),
    };

    // Handle metadata merge if provided
    if (input.metadata) {
      const existing = await this.getExecution(executionId);
      if (existing) {
        updateData.metadata = {
          ...(existing.metadata as Record<string, unknown>),
          ...input.metadata,
        };
      }
    }

    const [updated] = await this.db
      .update(executionsTable)
      .set(updateData)
      .where(eq(executionsTable.id, executionId))
      .returning();

    return updated ?? null;
  }

  /**
   * Mark execution as started
   */
  async startExecution(executionId: string): Promise<Execution | null> {
    return this.updateExecution(executionId, {
      status: JobStatus.RUNNING,
      startedAt: new Date(),
    });
  }

  /**
   * Mark execution as completed
   */
  async completeExecution(
    executionId: string,
    exitCode: number,
    output?: string,
  ): Promise<Execution | null> {
    return this.updateExecution(executionId, {
      status: exitCode === 0 ? JobStatus.COMPLETED : JobStatus.FAILED,
      completedAt: new Date(),
      exitCode,
      output: output ?? null,
    });
  }

  /**
   * Mark execution as failed
   */
  async failExecution(
    executionId: string,
    error: string,
  ): Promise<Execution | null> {
    return this.updateExecution(executionId, {
      status: JobStatus.FAILED,
      completedAt: new Date(),
      error,
    });
  }

  /**
   * Get active executions (running or queued)
   */
  async getActiveExecutions(): Promise<Execution[]> {
    return await this.db
      .select()
      .from(executionsTable)
      .where(
        and(
          isNull(executionsTable.completedAt),
          eq(executionsTable.status, JobStatus.RUNNING),
        ),
      );
  }

  /**
   * Extract job ID from execution ID
   * Supports both formats:
   * - New format: exec_{jobId}_{timestamp}
   * - Old format: exec-{jobId}-{timestamp}
   */
  static extractJobIdFromExecutionId(executionId: string): string | null {
    // Try new format first
    let match = /^exec_(.+)_\d+$/.exec(executionId);
    if (match) return match[1] ?? null;

    // Fall back to old format for backward compatibility
    match = /^exec-(.+)-\d+$/.exec(executionId);
    return match ? (match[1] ?? null) : null;
  }

  /**
   * Generate execution ID with underscore separators
   */
  static generateExecutionId(jobId: string): string {
    return `exec_${jobId}_${Math.floor(Date.now() / 1000)}`;
  }
}

// Export singleton instance
export const executionService = new ExecutionService();
