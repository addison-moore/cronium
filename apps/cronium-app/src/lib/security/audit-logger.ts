/**
 * Audit logging service for security-sensitive operations
 */

import { db } from "@/server/db";
import {
  describeFailure,
  driverError,
  failureWithStack,
} from "@/lib/pg-errors";
import {
  quotedForLog,
  serializeEntry,
  storableEntry,
} from "@/lib/security/audit-entry";
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
  | "permission.revoke"
  // Written by the retention purge, in the transaction that deletes the rows.
  | "retention.purge";

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
 * a reason nothing here recognises sits at the front, and this is what eventually
 * clears it. A flush writes them all in one insert, and at 8 bind parameters each
 * this is well under Postgres's limit of 65,535.
 */
export const MAX_PENDING_AUDIT_ENTRIES = 1000;

/**
 * How long shutdown() keeps writing before what's left goes to the server log.
 * Compose's stop_grace_period for each service has to leave room for this.
 */
const AUDIT_SHUTDOWN_TIMEOUT_MS = 5000;

/** Between attempts during shutdown: an outage may be over in time. */
const SHUTDOWN_RETRY_MS = 1000;

/** For the server log to take what shutdown() wrote to it. */
const SERVER_LOG_DRAIN_MS = 2000;

/** A flush deals with its own failures, so this is only for one it didn't expect. */
function logFailedFlush(error: unknown): void {
  console.error("[AuditLog] Flush failed:", failureWithStack(error));
}

/**
 * An entry as the buffer holds it. The time it happened is an ISO string because
 * this also goes to the server log, where redactSecrets would turn a Date into {}.
 */
interface PendingEntry extends AuditLogEntry {
  occurredAt: string;
}

type AuditRow = typeof toolAuditLogs.$inferInsert;

function toRow(entry: PendingEntry, keepToolReference = true): AuditRow {
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
    createdAt: new Date(entry.occurredAt),
  };
}

/**
 * The row for an entry whose contents the database still won't store once they
 * are cleaned: who did what and whether it worked.
 */
function toMinimalRow(entry: PendingEntry, rejection: unknown): AuditRow {
  const { code, name } = driverError(rejection);
  const { toolId } = entry.context;

  return {
    userId: entry.context.userId,
    toolId: null,
    action: entry.action,
    actionDetails: {
      detailsRejected: code ?? name,
      ...(toolId ? { toolId } : {}),
    },
    success: entry.success,
    createdAt: new Date(entry.occurredAt),
  };
}

/**
 * SQLSTATEs that blame the database rather than what was sent to it: a lost
 * connection, a read-only replica, a rolled back transaction, a table a pending
 * migration hasn't created, exhausted resources, a held lock, a shutdown or cancel,
 * a system error. 23505 belongs here because this table's only unique index is its
 * primary key: a collision means a restore left the sequence behind, and each
 * attempt moves it on.
 */
const DATABASE_FAULT = /^(08|25|40|42|53|55|57|58)|^23505$/;

/**
 * SQLSTATEs only the values in a minimal row can cause: one its column can't hold,
 * a missing one, a failed check, one too big or too deep for Postgres.
 */
const ENTRY_FAULT = /^(22|54)|^(23502|23514)$/;

/** Thrown while encoding the values, before anything reaches Postgres. */
function isEncodingFailure(name: string | undefined): boolean {
  return name === "TypeError" || name === "RangeError";
}

/** Says nothing about the entry, so writing less of it wouldn't help. */
function isDatabaseFault(error: unknown): boolean {
  const { code, name, severity } = driverError(error);
  if (isEncodingFailure(name)) return false;
  // No severity means Postgres never answered: a socket error, a timeout.
  return !severity || DATABASE_FAULT.test(code ?? "");
}

/** Proof enough to drop an entry, which an unfamiliar error isn't. */
function isEntryFault(error: unknown): boolean {
  const { code, name } = driverError(error);
  return isEncodingFailure(name) || ENTRY_FAULT.test(code ?? "");
}

/** Returns the error if the row didn't go in; a database fault is thrown. */
async function insertUnlessRejected(row: AuditRow): Promise<unknown> {
  try {
    await db.insert(toolAuditLogs).values(row);
    return undefined;
  } catch (error) {
    if (isDatabaseFault(error)) throw error;
    return error;
  }
}

/**
 * One logger per process, so it can't live on the class. Next builds this module
 * once per layer, and shutting down from instrumentation would otherwise reach a
 * copy with nothing in it while the route handlers' entries sat in another.
 */
const INSTANCE_KEY = Symbol.for("cronium.auditLogger");

/**
 * Audit logger for tracking security events
 */
export class AuditLogger {
  private buffer: PendingEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly flushThreshold = 100;
  private readonly flushIntervalMs = 5000; // 5 seconds
  private retrying = false;
  private earlyFlush: Promise<void> | null = null;
  /** Each flush still running, by the entries it hasn't finished writing. */
  private readonly writing = new Map<PendingEntry[], Promise<void>>();
  /** shutdown() has finished with the buffer, so nothing will write it again. */
  private closed = false;

  private constructor() {
    // Start flush interval
    this.startFlushInterval();
  }

  static getInstance(): AuditLogger {
    const shared = globalThis as unknown as {
      [INSTANCE_KEY]?: AuditLogger;
    };
    return (shared[INSTANCE_KEY] ??= new AuditLogger());
  }

  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    // The row's time: when this happened, not when a flush got to it, which an
    // outage can make much later.
    const occurredAt = new Date().toISOString();
    const pending: PendingEntry = { occurredAt, ...storableEntry(entry) };

    if (this.closed) {
      console.error(
        `[AuditLog] DROPPED a ${pending.action} entry: logged after shutting down. Full entry: ${serializeEntry(pending)}`,
      );
      return;
    }

    // Add to buffer
    this.buffer.push(pending);
    this.dropOldestPastLimit();

    // Flush a full batch early, one flush at a time so a failure can't put entries
    // back out of order. The caller doesn't wait: what it did has already happened,
    // and a write could take one insert or several per entry. While flushes are
    // failing the interval does the retrying instead of every new entry.
    if (
      this.buffer.length >= this.flushThreshold &&
      !this.retrying &&
      !this.earlyFlush
    ) {
      this.earlyFlush = this.flush()
        .catch(logFailedFlush)
        .finally(() => {
          this.earlyFlush = null;
        });
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
   * Flush buffered logs to database
   */
  async flush(): Promise<void> {
    // Failures are dealt with here, not thrown: the action being audited has
    // already happened.
    if (this.buffer.length === 0) return;

    const pending = this.buffer;
    this.buffer = [];

    const write = this.write(pending).finally(() => {
      this.writing.delete(pending);
    });
    this.writing.set(pending, write);
    await write;
  }

  /** Takes entries out of `pending` as they are dealt with. */
  private async write(pending: PendingEntry[]): Promise<void> {
    try {
      // Batch insert
      await db
        .insert(toolAuditLogs)
        .values(pending.map((entry) => toRow(entry)));
      this.retrying = false;
      return;
    } catch (error) {
      if (isDatabaseFault(error)) {
        this.keepForRetry(pending, error);
        return;
      }
    }

    // A batch insert is all or nothing, so one rejected entry failed the lot.
    // Alone, it can only cost itself.
    while (pending.length > 0) {
      try {
        await this.writeAlone(pending[0]!);
        pending.shift();
      } catch (error) {
        this.keepForRetry(pending, error);
        return;
      }
    }
    this.retrying = false;
  }

  /**
   * Write one entry, giving up only what the database rejects. This table is the
   * record of who changed or used a credential, so a row missing a field beats
   * no row, and whenever a row holds less than its entry the server log gets the
   * rest. Any error short of a database fault goes down these steps, because the
   * row that finally goes in is what proves the entry was the problem. Throws if
   * the entry should be kept for another try.
   */
  private async writeAlone(entry: PendingEntry): Promise<void> {
    const rejected = await insertUnlessRejected(toRow(entry));
    if (!rejected) return;

    // Usually a credential deleted since the entry was logged, which is
    // ordinary. The row ends up as it would have if the flush had come first,
    // when ON DELETE SET NULL clears the reference, but keeps the id.
    const rejectedAgain = await insertUnlessRejected(toRow(entry, false));
    if (!rejectedAgain) {
      const toolId = quotedForLog(String(JSON.stringify(entry.context.toolId)));
      console.warn(
        `[AuditLog] Stored a ${entry.action} entry without its tool reference: tool id ${toolId} was rejected (${describeFailure(rejected)}).`,
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

    // Not even who did what went in. Only the entry's own fault justifies losing
    // it; otherwise the table isn't taking anything, so it waits with the rest.
    if (!isEntryFault(rejectedOutright)) throw rejectedOutright as Error;

    console.error(
      `[AuditLog] DROPPED a ${entry.action} entry the database rejected (${describeFailure(rejectedOutright)}). Full entry: ${serializeEntry(entry)}`,
    );
  }

  /** Put entries back at the front of the buffer, in their original order. */
  private keepForRetry(entries: PendingEntry[], error: unknown): void {
    // Shutdown gave up on these while they were being written, and logged them.
    if (entries.length === 0) return;

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
      this.flush().catch(logFailedFlush);
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
   * Write everything still waiting, including what a flush already under way has
   * hold of, and send to the server log whatever isn't written in time. A hung
   * database gets no longer than `timeoutMs`, because nothing else stops it from
   * holding the process open. Call this once whatever creates entries has stopped:
   * from the moment it has finished with the buffer, log() goes straight to the
   * server log.
   */
  async shutdown(timeoutMs = AUDIT_SHUTDOWN_TIMEOUT_MS): Promise<void> {
    this.stopFlushInterval();

    let timer: NodeJS.Timeout | undefined;
    let outOfTime = false;
    const timeUp = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        outOfTime = true;
        resolve();
      }, timeoutMs);
    });

    const writeEverything = async () => {
      while (!outOfTime && (this.buffer.length > 0 || this.writing.size > 0)) {
        await Promise.allSettled(this.writing.values());
        await this.flush();
        if (this.retrying && !outOfTime) {
          await Promise.race([
            new Promise((resolve) => setTimeout(resolve, SHUTDOWN_RETRY_MS)),
            timeUp,
          ]);
        }
      }
      // With no await since the check above, so no entry can slip in between.
      this.closed = true;
    };

    await Promise.race([writeEverything(), timeUp]);
    clearTimeout(timer);

    if (outOfTime) await this.logUnwritten(timeoutMs);
  }

  /**
   * The server log as the last record of what never reached the table. Emptying
   * each batch in place means a write that finishes after this has nothing to put
   * back, so nothing here can also be written by a later flush.
   */
  private async logUnwritten(timeoutMs: number): Promise<void> {
    this.closed = true;
    let logged = false;

    for (const pending of this.writing.keys()) {
      for (const entry of pending.splice(0)) {
        logged = true;
        console.error(
          `[AuditLog] DROPPED a ${entry.action} entry: its write hadn't finished ${timeoutMs}ms into shutting down, so it may still have been written. Full entry: ${serializeEntry(entry)}`,
        );
      }
    }

    for (const entry of this.buffer.splice(0)) {
      logged = true;
      console.error(
        `[AuditLog] DROPPED a ${entry.action} entry: not written ${timeoutMs}ms into shutting down. Full entry: ${serializeEntry(entry)}`,
      );
    }

    // The caller is about to exit. On a pipe, which is what Docker gives a process,
    // these writes are asynchronous, and process.exit discards what hasn't gone out.
    if (logged) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SERVER_LOG_DRAIN_MS);
        process.stderr.write("", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
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
