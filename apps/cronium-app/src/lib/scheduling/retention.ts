/**
 * Retention (PLAN.md §3.5 tail): bounds the run-history tables, since a
 * self-hosted operator has no other way to. Replaces the never-called
 * jobService.cleanupOldJobs (review D4). The worker runs it on an interval.
 *
 * Each table has its own window from a CRONIUM_*_RETENTION_DAYS variable, and a
 * window of 0 keeps that table forever. Rows go in small batches, one
 * transaction each, dependents before their parent because many FKs have no
 * cascade. Purging a `jobs` row detaches its `logs` instead of deleting them:
 * `logs` is the user-visible run history and ages out on its own longer window.
 */

import { db } from "@/server/db";
import type { AuditAction } from "@/lib/security/audit-logger";
import {
  executions,
  jobs,
  jobTransitions,
  logs,
  scheduleIncidents,
  toolActionLogs,
  toolAuditLogs,
  webhookDeliveries,
  webhookEvents,
  webhookLogs,
  workflowExecutions,
  workflowLogs,
  JobStatus,
  LogStatus,
} from "@/shared/schema";
import {
  and,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

const TERMINAL_JOB_STATUSES: JobStatus[] = [
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.TIMED_OUT,
  JobStatus.CANCELLED,
];

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.QUEUED,
  JobStatus.CLAIMED,
  JobStatus.RUNNING,
];

// An allowlist, so a run in any other state (RUNNING, PENDING) is never purged.
const FINISHED_RUN_STATUSES: LogStatus[] = [
  LogStatus.SUCCESS,
  LogStatus.FAILURE,
  LogStatus.TIMEOUT,
  LogStatus.PARTIAL,
];

// What a purge of the tool audit log leaves behind. The actor can't be mistaken for
// a user: user ids are UUIDs and nanoids, and neither contains a colon.
const AUDIT_PURGE_ACTOR = "system:retention";
const AUDIT_PURGE_ACTION = "retention.purge" satisfies AuditAction;

const BATCH = 500;
const MAX_BATCHES_PER_RUN = 20;
const DAY_MS = 86_400_000;

const KEEP_FOREVER = 0;
// Far enough back that no row is older, and a cutoff Postgres can still parse.
const MAX_WINDOW_DAYS = 36_500;

const WINDOWS = {
  jobs: { env: "CRONIUM_JOB_RETENTION_DAYS", defaultDays: 30 },
  logs: { env: "CRONIUM_LOG_RETENTION_DAYS", defaultDays: 90 },
  workflowExecutions: {
    env: "CRONIUM_WORKFLOW_RETENTION_DAYS",
    defaultDays: 90,
  },
  scheduleIncidents: {
    env: "CRONIUM_INCIDENT_RETENTION_DAYS",
    defaultDays: 90,
  },
  toolActionLogs: {
    env: "CRONIUM_TOOL_ACTION_LOG_RETENTION_DAYS",
    defaultDays: 90,
  },
  // Not shared with toolActionLogs, because the two change for different reasons.
  // That one is run output: disk space sets it, and monthly quotas need 31 days of
  // it. This one is the security record of who changed or used a credential, with
  // IP addresses, so compliance and privacy rules set it, in either direction.
  // Deleting it takes an operator's decision, so it keeps everything until one sets
  // a window. Someone who set every other window to 0 has no setting for it yet.
  toolAuditLogs: {
    env: "CRONIUM_TOOL_AUDIT_LOG_RETENTION_DAYS",
    defaultDays: KEEP_FOREVER,
  },
  webhooks: { env: "CRONIUM_WEBHOOK_RETENTION_DAYS", defaultDays: 30 },
} as const;

export type RetentionWindow = keyof typeof WINDOWS;
export type RetentionWindows = Record<RetentionWindow, number>;

function parseWindow(
  name: string,
  raw: string | undefined,
  defaultDays: number,
): number {
  // Compose passes unset variables through as empty strings, and Number("") is
  // 0, which would otherwise quietly mean "keep forever".
  if (raw === undefined || raw.trim() === "") return defaultDays;

  const days = Number(raw);
  if (Number.isFinite(days) && days >= 0 && days <= MAX_WINDOW_DAYS) {
    return days;
  }

  // Deleting can't be undone, so a value we can't read deletes nothing. Using
  // the default here would purge rows for someone who wrote "-1" or "never"
  // meaning the opposite.
  console.warn(
    `[Retention] Ignoring ${name}=${JSON.stringify(raw)}: expected a number of days from 0 (keep forever) to ${MAX_WINDOW_DAYS}. Keeping this data until it is fixed.`,
  );
  return KEEP_FOREVER;
}

export function retentionWindows(
  env: Record<string, string | undefined> = process.env,
): RetentionWindows {
  const windows = {} as RetentionWindows;
  for (const name of Object.keys(WINDOWS) as RetentionWindow[]) {
    const { env: variable, defaultDays } = WINDOWS[name];
    windows[name] = parseWindow(variable, env[variable], defaultDays);
  }
  return windows;
}

/**
 * The first non-null column, a row's best "finished at", is older than cutoff.
 * The cutoff is bound through a column's encoder on purpose: these columns have
 * no time zone and hold UTC, while a bare Date in a sql template would be
 * formatted in the worker host's local time and shift the cutoff by its offset.
 */
function finishedBefore(cutoff: Date, ...columns: AnyPgColumn[]): SQL {
  const coalesced = sql.join(columns, sql`, `);
  return sql`COALESCE(${coalesced}) < ${sql.param(cutoff, columns[0])}`;
}

type BatchPurge = (
  cutoff: Date,
  limit: number,
  windowDays: number,
) => Promise<number>;

/**
 * One batch from a table whose dependents, if any, cascade. SKIP LOCKED lets a
 * second worker's pass take different rows instead of queueing behind this one.
 * Rows are selected and deleted in two steps because the one-statement form,
 * DELETE ... WHERE id IN (SELECT ... LIMIT), can run its subquery more than once
 * and go past the limit.
 */
function flatBatch(
  table: PgTable,
  id: AnyPgColumn,
  expired: (cutoff: Date) => SQL | undefined,
): BatchPurge {
  return (cutoff, limit) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({ id })
        .from(table)
        .where(expired(cutoff))
        .limit(limit)
        .for("update", { skipLocked: true });
      if (rows.length === 0) return 0;

      await tx.delete(table).where(
        inArray(
          id,
          rows.map((row) => row.id),
        ),
      );
      return rows.length;
    });
}

const purgeLogsBatch = flatBatch(logs, logs.id, (cutoff) =>
  and(
    // Implied by the end_time check for any real run, and lets a pass with
    // nothing to purge read logs_event_created_idx instead of scanning the
    // table with the largest rows.
    lt(logs.createdAt, cutoff),
    or(isNull(logs.endTime), lt(logs.endTime, cutoff)),
    // The job decides whether a log is finished, not the log's own status: rows
    // can be left RUNNING for good, and those still have to age out.
    notExists(
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.id, logs.jobId),
            inArray(jobs.status, ACTIVE_JOB_STATUSES),
          ),
        ),
    ),
  ),
);

const purgeJobsBatch: BatchPurge = (cutoff, limit) =>
  db.transaction(async (tx) => {
    // FOR UPDATE also blocks a new log or transition from referencing these
    // rows between the detach below and the delete.
    const batch = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          inArray(jobs.status, TERMINAL_JOB_STATUSES),
          finishedBefore(
            cutoff,
            jobs.completedAt,
            jobs.updatedAt,
            jobs.createdAt,
          ),
        ),
      )
      .limit(limit)
      .for("update", { skipLocked: true });
    if (batch.length === 0) return 0;

    const ids = batch.map((row) => row.id);
    // Keep run history: detach logs from the queue rows being removed
    await tx
      .update(logs)
      .set({ jobId: null, executionId: null })
      .where(inArray(logs.jobId, ids));
    // A log can reference an execution without referencing the job
    const execRows = await tx
      .select({ id: executions.id })
      .from(executions)
      .where(inArray(executions.jobId, ids));
    if (execRows.length > 0) {
      await tx
        .update(logs)
        .set({ executionId: null })
        .where(
          inArray(
            logs.executionId,
            execRows.map((row) => row.id),
          ),
        );
    }
    await tx.delete(executions).where(inArray(executions.jobId, ids));
    await tx.delete(jobTransitions).where(inArray(jobTransitions.jobId, ids));
    await tx.delete(jobs).where(inArray(jobs.id, ids));
    return ids.length;
  });

/**
 * Audit rows go in the same transaction as a row recording that they went, so an
 * auditor who finds rows missing can tell retention from tampering long after the
 * worker's logs have rotated, and a record that can't be written stops the delete.
 * That makes it one record per batch, since a batch is the transaction. Records are
 * never purged themselves, because they have to outlive what they account for.
 */
const purgeAuditLogsBatch: BatchPurge = (cutoff, limit, windowDays) =>
  db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: toolAuditLogs.id })
      .from(toolAuditLogs)
      .where(
        and(
          lt(toolAuditLogs.createdAt, cutoff),
          ne(toolAuditLogs.action, AUDIT_PURGE_ACTION),
        ),
      )
      .limit(limit)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return 0;

    const ids = rows.map((row) => row.id);
    await tx.delete(toolAuditLogs).where(inArray(toolAuditLogs.id, ids));
    await tx.insert(toolAuditLogs).values({
      userId: AUDIT_PURGE_ACTOR,
      action: AUDIT_PURGE_ACTION,
      actionDetails: {
        windowDays,
        cutoff: cutoff.toISOString(),
        deleted: ids.length,
        minId: Math.min(...ids),
        maxId: Math.max(...ids),
      },
    });
    return ids.length;
  });

/**
 * In FK-safe order; tables that share a window age out together.
 *
 * quota_usage is left out because no window is safe for it. QuotaManager.getUsage
 * only bounds its read by time for resources named PerMonth or PerDay, so any other
 * resource reads a row of any age. Once the last row goes, totalStorageMB and
 * apiRequestsPerMinute fall back to a count that is always 0, so purging an old row
 * makes a live read low. Nothing writes the table today either: consumeQuota is
 * only reached from createMiddleware, which has no callers. Whoever wires that up
 * decides what is safe to purge then.
 */
const PURGES = [
  // Ahead of jobs so logs that are going anyway are never detached first.
  { table: "logs", window: "logs", batch: purgeLogsBatch },
  { table: "jobs", window: "jobs", batch: purgeJobsBatch },
  {
    table: "workflow_executions",
    window: "workflowExecutions",
    // workflow_execution_events and workflow_step_runs go with it by cascade.
    batch: flatBatch(workflowExecutions, workflowExecutions.id, (cutoff) =>
      and(
        inArray(workflowExecutions.status, FINISHED_RUN_STATUSES),
        finishedBefore(
          cutoff,
          workflowExecutions.completedAt,
          workflowExecutions.updatedAt,
          workflowExecutions.createdAt,
        ),
      ),
    ),
  },
  {
    table: "workflow_logs",
    window: "workflowExecutions",
    // It has no FK to workflow_executions, so that purge doesn't reach it. Rows
    // are never updated, so a start row reads RUNNING for good and status can't
    // be a filter here. With no run id to check instead, each row ages from when
    // it was written: guarding by workflow would keep a busy one's rows forever.
    batch: flatBatch(workflowLogs, workflowLogs.id, (cutoff) =>
      lt(workflowLogs.createdAt, cutoff),
    ),
  },
  {
    table: "schedule_incidents",
    window: "scheduleIncidents",
    batch: flatBatch(scheduleIncidents, scheduleIncidents.id, (cutoff) =>
      lt(scheduleIncidents.createdAt, cutoff),
    ),
  },
  {
    table: "tool_action_logs",
    window: "toolActionLogs",
    batch: flatBatch(toolActionLogs, toolActionLogs.id, (cutoff) =>
      lt(toolActionLogs.createdAt, cutoff),
    ),
  },
  {
    table: "tool_audit_logs",
    window: "toolAuditLogs",
    batch: purgeAuditLogsBatch,
  },
  // Ahead of webhook_events, which are only eligible once no delivery is left.
  {
    table: "webhook_deliveries",
    window: "webhooks",
    batch: flatBatch(webhookDeliveries, webhookDeliveries.id, (cutoff) =>
      lt(webhookDeliveries.attemptedAt, cutoff),
    ),
  },
  {
    table: "webhook_logs",
    window: "webhooks",
    batch: flatBatch(webhookLogs, webhookLogs.id, (cutoff) =>
      lt(webhookLogs.createdAt, cutoff),
    ),
  },
  {
    table: "webhook_events",
    window: "webhooks",
    batch: flatBatch(webhookEvents, webhookEvents.id, (cutoff) =>
      and(
        lt(webhookEvents.createdAt, cutoff),
        // The FK cascades, so an old event still holding a recent delivery
        // would otherwise take that delivery with it.
        notExists(
          db
            .select({ id: webhookDeliveries.id })
            .from(webhookDeliveries)
            .where(eq(webhookDeliveries.webhookEventId, webhookEvents.id)),
        ),
      ),
    ),
  },
] as const satisfies ReadonlyArray<{
  table: string;
  window: RetentionWindow;
  batch: BatchPurge;
}>;

export type RetentionTable = (typeof PURGES)[number]["table"];

export interface RetentionOptions {
  /** Overrides individual windows from the environment. */
  windows?: Partial<RetentionWindows>;
  now?: Date;
  batchSize?: number;
  maxBatches?: number;
}

export interface RetentionResult {
  /** Parent rows deleted per table this pass. */
  deleted: Record<RetentionTable, number>;
  /** A table hit the per-pass cap, so expired rows probably remain. */
  backlog: boolean;
  /** Tables whose purge failed this pass; every other table still ran. */
  failed: RetentionTable[];
}

export async function runRetention(
  options: RetentionOptions = {},
): Promise<RetentionResult> {
  const now = options.now ?? new Date();
  const windows = { ...retentionWindows(), ...options.windows };
  const batchSize = options.batchSize ?? BATCH;
  const maxBatches = options.maxBatches ?? MAX_BATCHES_PER_RUN;

  const deleted = {} as Record<RetentionTable, number>;
  const failed: RetentionTable[] = [];
  let backlog = false;

  for (const { table, window: windowName, batch } of PURGES) {
    deleted[table] = 0;

    const days = windows[windowName];
    if (!(days > 0)) continue;
    const cutoff = new Date(now.getTime() - days * DAY_MS);

    try {
      for (let i = 0; i < maxBatches; i++) {
        const removed = await batch(cutoff, batchSize, days);
        deleted[table] += removed;
        if (removed < batchSize) break;
        if (i === maxBatches - 1) backlog = true;
      }
    } catch (error) {
      failed.push(table);
      // The whole error: Drizzle's message is only the failed SQL, and the reason
      // is on its cause.
      console.error(`[Retention] Failed to purge ${table}:`, error);
    }
  }

  const summary = Object.entries(deleted)
    .filter(([, count]) => count > 0)
    .map(([table, count]) => `${count} ${table}`)
    .join(", ");
  if (summary) {
    console.log(
      `[Retention] Deleted ${summary}${backlog ? " (more remain)" : ""}`,
    );
  }

  return { deleted, backlog, failed };
}
