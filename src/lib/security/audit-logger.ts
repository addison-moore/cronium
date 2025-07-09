/**
 * Audit logging service for security-sensitive operations
 */

import { db } from "@/server/db";
import { toolAuditLogs } from "@/shared/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";

export type AuditAction =
  | "credential.create"
  | "credential.read"
  | "credential.update"
  | "credential.delete"
  | "credential.test"
  | "tool.execute"
  | "tool.auth_success"
  | "tool.auth_failure"
  | "tool.rate_limit_exceeded"
  | "config.update"
  | "permission.grant"
  | "permission.revoke";

export interface AuditContext {
  userId: string;
  toolId?: number;
  ipAddress?: string;
  userAgent?: string;
  additionalData?: Record<string, any>;
}

export interface AuditLogEntry {
  action: AuditAction;
  context: AuditContext;
  success: boolean;
  errorMessage?: string;
  details?: Record<string, any>;
}

/**
 * Audit logger for tracking security events
 */
export class AuditLogger {
  private static instance: AuditLogger;
  private buffer: AuditLogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly maxBufferSize = 100;
  private readonly flushIntervalMs = 5000; // 5 seconds

  private constructor() {
    // Start flush interval
    this.startFlushInterval();
  }

  static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    // Add to buffer
    this.buffer.push(entry);

    // Flush if buffer is full
    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
  }

  /**
   * Log a successful action
   */
  async logSuccess(
    action: AuditAction,
    context: AuditContext,
    details?: Record<string, any>,
  ): Promise<void> {
    const entry: AuditLogEntry = {
      action,
      context,
      success: true,
    };
    if (details !== undefined) {
      entry.details = details;
    }
    await this.log(entry);
  }

  /**
   * Log a failed action
   */
  async logFailure(
    action: AuditAction,
    context: AuditContext,
    errorMessage: string,
    details?: Record<string, any>,
  ): Promise<void> {
    const entry: AuditLogEntry = {
      action,
      context,
      success: false,
      errorMessage,
    };
    if (details !== undefined) {
      entry.details = details;
    }
    await this.log(entry);
  }

  /**
   * Query audit logs
   */
  async query(options: {
    userId?: string;
    toolId?: number;
    action?: AuditAction;
    startDate?: Date;
    endDate?: Date;
    success?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{
    logs: (typeof toolAuditLogs.$inferSelect)[];
    total: number;
  }> {
    const conditions = [];

    if (options.userId) {
      conditions.push(eq(toolAuditLogs.userId, options.userId));
    }

    if (options.toolId) {
      conditions.push(eq(toolAuditLogs.toolId, options.toolId));
    }

    if (options.action) {
      conditions.push(eq(toolAuditLogs.action, options.action));
    }

    if (options.success !== undefined) {
      conditions.push(eq(toolAuditLogs.success, options.success));
    }

    if (options.startDate) {
      conditions.push(gte(toolAuditLogs.createdAt, options.startDate));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(toolAuditLogs)
      .where(where);

    const count = countResult[0]?.count ?? 0;

    // Get logs
    const logs = await db
      .select()
      .from(toolAuditLogs)
      .where(where)
      .orderBy(desc(toolAuditLogs.createdAt))
      .limit(options.limit || 50)
      .offset(options.offset || 0);

    return { logs, total: count };
  }

  /**
   * Get audit summary for a user
   */
  async getUserSummary(
    userId: string,
    days = 30,
  ): Promise<{
    totalActions: number;
    successRate: number;
    actionBreakdown: Record<string, number>;
    recentFailures: (typeof toolAuditLogs.$inferSelect)[];
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all logs for the period
    const logs = await db
      .select()
      .from(toolAuditLogs)
      .where(
        and(
          eq(toolAuditLogs.userId, userId),
          gte(toolAuditLogs.createdAt, startDate),
        ),
      );

    // Calculate metrics
    const totalActions = logs.length;
    const successfulActions = logs.filter((log) => log.success).length;
    const successRate = totalActions > 0 ? successfulActions / totalActions : 0;

    // Action breakdown
    const actionBreakdown: Record<string, number> = {};
    logs.forEach((log) => {
      actionBreakdown[log.action] = (actionBreakdown[log.action] || 0) + 1;
    });

    // Recent failures
    const recentFailures = logs
      .filter((log) => !log.success)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10);

    return {
      totalActions,
      successRate,
      actionBreakdown,
      recentFailures,
    };
  }

  /**
   * Clean up old audit logs
   */
  async cleanup(retentionDays = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await db
      .delete(toolAuditLogs)
      .where(sql`${toolAuditLogs.createdAt} < ${cutoffDate}`);

    // Drizzle returns an array with result info
    return (result as any).rowCount ?? 0;
  }

  /**
   * Flush buffered logs to database
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const logsToInsert = [...this.buffer];
    this.buffer = [];

    try {
      // Convert entries to database format
      const dbEntries = logsToInsert.map((entry) => ({
        userId: entry.context.userId,
        // Set toolId to null for delete actions to avoid foreign key violations
        toolId:
          entry.action === "credential.delete"
            ? null
            : entry.context.toolId || null,
        action: entry.action,
        actionDetails: {
          ...entry.details,
          additionalData: entry.context.additionalData,
          // Include toolId in details for delete actions
          ...(entry.action === "credential.delete" && entry.context.toolId
            ? { toolId: entry.context.toolId }
            : {}),
        },
        ipAddress: entry.context.ipAddress || null,
        userAgent: entry.context.userAgent || null,
        success: entry.success,
        errorMessage: entry.errorMessage || null,
      }));

      // Batch insert
      await db.insert(toolAuditLogs).values(dbEntries);
    } catch (error) {
      console.error("Failed to flush audit logs:", error);
      // Re-add to buffer for retry
      this.buffer.unshift(...logsToInsert);
    }
  }

  /**
   * Start flush interval
   */
  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch(console.error);
    }, this.flushIntervalMs);
  }

  /**
   * Stop flush interval
   */
  stopFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  /**
   * Shutdown and flush remaining logs
   */
  async shutdown(): Promise<void> {
    this.stopFlushInterval();
    await this.flush();
  }
}

// Export singleton instance
export const auditLogger = AuditLogger.getInstance();

// Convenience functions for common audit scenarios
export const auditLog = {
  credentialCreated: (context: AuditContext, toolType: string) =>
    auditLogger.logSuccess("credential.create", context, { toolType }),

  credentialUpdated: (context: AuditContext, changes: Record<string, any>) =>
    auditLogger.logSuccess("credential.update", context, { changes }),

  credentialDeleted: (context: AuditContext, toolType: string) =>
    auditLogger.logSuccess("credential.delete", context, { toolType }),

  credentialRead: (context: AuditContext, purpose: string) =>
    auditLogger.logSuccess("credential.read", context, { purpose }),

  credentialTestSuccess: (context: AuditContext, latency: number) =>
    auditLogger.logSuccess("credential.test", context, { latency }),

  credentialTestFailure: (context: AuditContext, error: string) =>
    auditLogger.logFailure("credential.test", context, error),

  toolExecuted: (context: AuditContext, actionId: string, duration: number) =>
    auditLogger.logSuccess("tool.execute", context, { actionId, duration }),

  toolExecutionFailed: (
    context: AuditContext,
    actionId: string,
    error: string,
  ) => auditLogger.logFailure("tool.execute", context, error, { actionId }),

  authSuccess: (context: AuditContext, provider: string) =>
    auditLogger.logSuccess("tool.auth_success", context, { provider }),

  authFailure: (context: AuditContext, provider: string, reason: string) =>
    auditLogger.logFailure("tool.auth_failure", context, reason, { provider }),

  rateLimitExceeded: (context: AuditContext, limit: number, window: string) =>
    auditLogger.logFailure(
      "tool.rate_limit_exceeded",
      context,
      "Rate limit exceeded",
      { limit, window },
    ),
};
