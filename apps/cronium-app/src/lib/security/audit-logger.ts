/**
 * Audit logging service for security-sensitive operations
 */

import { db } from "@/server/db";
import { redactSecrets } from "@/lib/tools/redact";
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
  additionalData?: Record<string, unknown>;
}

export interface AuditLogEntry {
  action: AuditAction;
  context: AuditContext;
  success: boolean;
  errorMessage?: string;
  details?: Record<string, unknown>;
}

/**
 * How many entries to hold while the database can't take them. Past this the
 * oldest go to the server log instead. Oldest first, because an entry stuck for
 * a reason `isRejection` doesn't recognise sits at the front, and this is what
 * eventually clears it. A flush writes them all in one insert, and at 8 bind
 * parameters each this is well under Postgres's limit of 65,535.
 */
export const MAX_PENDING_AUDIT_ENTRIES = 1000;

type AuditRow = typeof toolAuditLogs.$inferInsert;

function toRow(entry: AuditLogEntry, keepToolReference = true): AuditRow {
  const { toolId } = entry.context;
  // A deleted credential can't be referenced, so its id moves into the details.
  const referencesTool =
    keepToolReference && entry.action !== "credential.delete";

  return {
    userId: entry.context.userId,
    toolId: referencesTool ? (toolId ?? null) : null,
    action: entry.action,
    actionDetails: {
      ...entry.details,
      additionalData: entry.context.additionalData,
      ...(!referencesTool && toolId ? { toolId } : {}),
    },
    ipAddress: entry.context.ipAddress ?? null,
    userAgent: entry.context.userAgent ?? null,
    success: entry.success,
    errorMessage: entry.errorMessage ?? null,
  };
}

/**
 * The row for an entry whose contents the database won't store: who did what
 * and whether it worked. A tool id can come from an event's unvalidated config,
 * so it is only kept when it can't be what was rejected.
 */
function toMinimalRow(entry: AuditLogEntry, rejection: unknown): AuditRow {
  const { code, name } = driverError(rejection);
  const { toolId } = entry.context;

  return {
    userId: entry.context.userId,
    toolId: null,
    action: entry.action,
    actionDetails: {
      detailsRejected: code ?? name,
      ...(typeof toolId === "number" ? { toolId } : {}),
    },
    success: entry.success,
  };
}

/** Drizzle wraps the driver's error, so a query's SQLSTATE is on `cause`. */
function driverError(error: unknown): {
  code?: string;
  message?: string;
  name?: string;
} {
  const failure = error as { cause?: object };
  return failure.cause ?? failure;
}

/**
 * Whether a failed insert is the entry's fault, so retrying it can never work.
 *
 * SQLSTATE class 22 is a value its column can't hold and class 23 a broken
 * constraint. A bare TypeError comes from Drizzle encoding the values (circular
 * or BigInt details), before anything reaches Postgres. Anything else, such as
 * a refused connection or a table a pending migration hasn't created yet, says
 * nothing about the entry, so it stays buffered for the next attempt.
 */
function isRejection(error: unknown): boolean {
  if ((error as Error).name === "TypeError") return true;
  return /^(22|23)/.test(driverError(error).code ?? "");
}

/**
 * Leaves out Drizzle's own message, which repeats every value in the batch, and
 * keeps to one line: Postgres can quote a rejected value, and the server log is
 * the only record of a dropped entry, so a value mustn't be able to forge a line.
 */
function describeFailure(error: unknown): string {
  const { code, message, name } = driverError(error);
  return `${String(code ?? name)}: ${String(message).replace(/\s+/g, " ")}`;
}

/** The whole entry on one line, so the server log can stand in for its row. */
function serializeEntry(entry: AuditLogEntry): string {
  return JSON.stringify(redactSecrets(entry), (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

/** Returns the error if the database rejected the row; other failures throw. */
async function insertUnlessRejected(row: AuditRow): Promise<unknown> {
  try {
    await db.insert(toolAuditLogs).values(row);
    return undefined;
  } catch (error) {
    if (isRejection(error)) return error;
    throw error;
  }
}

/**
 * Audit logger for tracking security events
 */
export class AuditLogger {
  private static instance: AuditLogger;
  private buffer: AuditLogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly flushThreshold = 100;
  private readonly flushIntervalMs = 5000; // 5 seconds
  private retrying = false;

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
    this.dropOldestPastLimit();

    // Flush a full batch early. While flushes are failing the interval does the
    // retrying: sending the whole backlog again for every new entry would make
    // each caller wait on a database that can't take it.
    if (this.buffer.length >= this.flushThreshold && !this.retrying) {
      await this.flush();
    }
  }

  /**
   * Log a successful action
   */
  async logSuccess(
    action: AuditAction,
    context: AuditContext,
    details?: Record<string, unknown>,
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
    details?: Record<string, unknown>,
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
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);

    return { logs, total: count };
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
    return (result as { rowCount?: number }).rowCount ?? 0;
  }

  /**
   * Flush buffered logs to database
   */
  async flush(): Promise<void> {
    // Failures are dealt with here, not thrown: the action being audited has
    // already happened.
    if (this.buffer.length === 0) return;

    const pending = this.buffer;
    this.buffer = [];

    try {
      // Batch insert
      await db
        .insert(toolAuditLogs)
        .values(pending.map((entry) => toRow(entry)));
      this.retrying = false;
      return;
    } catch (error) {
      if (!isRejection(error)) {
        this.keepForRetry(pending, error);
        return;
      }
    }

    // A batch insert is all or nothing, so one rejected entry failed the lot.
    // Alone, it can only cost itself.
    for (const [index, entry] of pending.entries()) {
      try {
        await this.writeAlone(entry);
      } catch (error) {
        this.keepForRetry(pending.slice(index), error);
        return;
      }
    }
    this.retrying = false;
  }

  /**
   * Write one entry, giving up only what the database rejects. This table is the
   * record of who changed or used a credential, so a row missing a field beats
   * no row, and whenever a row holds less than its entry the server log gets the
   * rest. Throws if the database is unavailable, as opposed to rejecting the row.
   */
  private async writeAlone(entry: AuditLogEntry): Promise<void> {
    const rejected = await insertUnlessRejected(toRow(entry));
    if (!rejected) return;

    // Usually a credential deleted since the entry was logged, which is
    // ordinary. The row ends up as it would have if the flush had come first,
    // when ON DELETE SET NULL clears the reference, but keeps the id.
    const rejectedAgain = await insertUnlessRejected(toRow(entry, false));
    if (!rejectedAgain) {
      console.warn(
        `[AuditLog] Stored a ${entry.action} entry without its tool reference: tool id ${JSON.stringify(entry.context.toolId)} was rejected (${describeFailure(rejected)}).`,
      );
      return;
    }

    const rejectedOutright = await insertUnlessRejected(
      toMinimalRow(entry, rejectedAgain),
    );
    if (!rejectedOutright) {
      console.error(
        `[AuditLog] Stored a ${entry.action} entry without its details, which were rejected (${describeFailure(rejectedAgain)}). Full entry: ${serializeEntry(entry)}`,
      );
      return;
    }

    console.error(
      `[AuditLog] DROPPED a ${entry.action} entry the database rejected (${describeFailure(rejectedOutright)}). Full entry: ${serializeEntry(entry)}`,
    );
  }

  /** Put entries back at the front of the buffer, in their original order. */
  private keepForRetry(entries: AuditLogEntry[], error: unknown): void {
    this.buffer = [...entries, ...this.buffer];
    this.retrying = true;
    console.error(
      `[AuditLog] Failed to flush, ${entries.length} kept for retry: ${describeFailure(error)}`,
    );
    this.dropOldestPastLimit();
  }

  private dropOldestPastLimit(): void {
    const excess = this.buffer.length - MAX_PENDING_AUDIT_ENTRIES;
    if (excess <= 0) return;

    for (const entry of this.buffer.splice(0, excess)) {
      console.error(
        `[AuditLog] DROPPED a ${entry.action} entry: more than ${MAX_PENDING_AUDIT_ENTRIES} are waiting to be written. Full entry: ${serializeEntry(entry)}`,
      );
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

  credentialUpdated: (
    context: AuditContext,
    changes: Record<string, unknown>,
  ) => auditLogger.logSuccess("credential.update", context, { changes }),

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
