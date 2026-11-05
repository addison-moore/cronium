import { db } from "@server/db";
import {
  type Execution,
  type InsertExecution,
  JobStatus,
  executions as executionsTable,
} from "@shared/schema";
import { eq } from "drizzle-orm";

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
}

// Export singleton instance
export const executionService = new ExecutionService();
