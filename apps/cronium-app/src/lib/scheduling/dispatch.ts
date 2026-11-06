/**
 * The single enqueue path (_plans/scheduling/PLAN.md §4.1 "dispatchJob").
 *
 * Every trigger source — scheduler tick, manual run, workflow step, webhook —
 * goes through dispatchEventJob. This replaces the three divergent copies the
 * review found (M1: scheduler.executeScript / scheduler.executeEvent /
 * events.execute) and gives one home to the checks that were previously dead
 * code: max-executions enforcement, lastRunAt bookkeeping (C8), and overlap
 * policy.
 */

import { storage, type EventWithRelations } from "@/server/storage";
import { db } from "@/server/db";
import { pgErrorCode } from "@/lib/pg-errors";
import {
  EventStatus,
  JobPriority,
  JobSource,
  JobType,
  LeaseLossPolicy,
  LogStatus,
  OverlapPolicy,
  ScheduleIncidentKind,
  scheduleIncidents,
  type Job,
} from "@/shared/schema";
import { jobService } from "@/lib/services/job-service";
import { buildJobPayload } from "@/lib/scheduler/job-payload-builder";
import { eventTimeoutMs } from "@/lib/scheduler/event-timeout";
import { recordJobCreated } from "./job-transition";
import { assertEventRelations } from "@/server/security/resource-access";
import {
  assertRoleCapability,
  getAuthorizedPrincipal,
} from "@/server/security/authorization";

export type TriggerSource = "schedule" | "manual" | "workflow" | "webhook";

const SOURCE_MAP: Record<TriggerSource, JobSource> = {
  schedule: JobSource.EVENT,
  manual: JobSource.MANUAL,
  workflow: JobSource.WORKFLOW_STEP,
  webhook: JobSource.WEBHOOK,
};

export interface DispatchOptions {
  triggeredBy: TriggerSource;
  input?: Record<string, unknown> | undefined;
  workflowId?: number | undefined;
  workflowExecutionId?: number | undefined;
  /** Stamped into job metadata so the workflow engine can re-attach a job to
   * its step after a crash between claim and dispatch. */
  workflowStepRunId?: number | undefined;
  /** Dispatched late past the misfire grace (RUN_ONCE catch-up). */
  scheduledMiss?: boolean;
  /** Overrides the audit actor; defaults to the trigger source. */
  actor?: string;
  /** Principal whose execute/use-secret capabilities must still hold at the
   * final dispatch boundary. System schedules default to the event owner. */
  authorizedUserId?: string;
}

export type DispatchResult =
  | { job: Job; logId: number; skipped?: undefined }
  | { job: null; logId: null; skipped: "overlap" | "max_executions" };

function jobTypeForEvent(event: EventWithRelations): JobType {
  const map: Record<string, JobType> = {
    HTTP_REQUEST: JobType.HTTP_REQUEST,
    TOOL_ACTION: JobType.TOOL_ACTION,
  };
  return map[event.type] ?? JobType.SCRIPT;
}

/** For a write that can't change what happened to the run: say so and carry on. */
function reportFailedWrite(what: string, eventId: number) {
  return (error: unknown): void => {
    console.error(
      `[Dispatch] Failed to ${what} for event ${eventId}:`,
      error instanceof Error ? error.message : String(error),
    );
  };
}

function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === "23505";
}

/**
 * Enforce maxExecutions before dispatch: at the limit, auto-pause the event
 * (visible incident, not a silent stop) and skip. Manual runs are exempt —
 * the cap governs the schedule, not the user's own button.
 */
async function checkMaxExecutions(
  event: EventWithRelations,
  triggeredBy: TriggerSource,
): Promise<boolean> {
  if (triggeredBy === "manual") return true;
  if (!event.maxExecutions || event.maxExecutions <= 0) return true;
  if ((event.executionCount ?? 0) < event.maxExecutions) return true;

  console.log(
    `[Dispatch] Event ${event.id} reached max executions (${event.maxExecutions}); auto-pausing`,
  );
  await storage.updateScript(event.id, {
    status: EventStatus.PAUSED,
    nextRunAt: null,
  });
  await db.insert(scheduleIncidents).values({
    eventId: event.id,
    kind: ScheduleIncidentKind.AUTO_PAUSED,
    details: { maxExecutions: event.maxExecutions },
  });
  // Cancel the legacy in-memory timer (dynamic import: scheduler → dispatch)
  try {
    const { scheduler } = await import("@/lib/scheduler");
    await scheduler.deleteScript(event.id);
  } catch (error) {
    console.error(
      `[Dispatch] Failed to cancel schedule for auto-paused event ${event.id}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
  return false;
}

export async function dispatchEventJob(
  event: EventWithRelations,
  opts: DispatchOptions,
): Promise<DispatchResult> {
  const actor = opts.actor ?? opts.triggeredBy;
  const authorizedUserId = opts.authorizedUserId ?? String(event.userId);

  // Re-authorize the principal and relationship rows immediately before
  // payload construction. A previously valid schedule cannot keep executing
  // if its owner was disabled/deleted or demoted to a read-only role, or if
  // event ownership or server relationships have changed. Fails closed.
  const principal = await getAuthorizedPrincipal(authorizedUserId);
  assertRoleCapability(principal.role, "execute");
  await assertEventRelations(event.id, authorizedUserId, "execute");

  if (!(await checkMaxExecutions(event, opts.triggeredBy))) {
    return { job: null, logId: null, skipped: "max_executions" };
  }

  const jobType = jobTypeForEvent(event);
  const runsInProcess =
    jobType === JobType.TOOL_ACTION || jobType === JobType.HTTP_REQUEST;
  const runAsUserId = authorizedUserId;

  const log = await storage.createLog({
    eventId: event.id,
    workflowId: opts.workflowId,
    status: LogStatus.PENDING,
    startTime: new Date(),
    eventName: event.name ?? "Unknown",
    eventType: event.type,
    userId: runAsUserId,
  });

  const basePayload = buildJobPayload(event, log.id, opts.input);
  const payload = {
    ...basePayload,
    ...(opts.workflowId !== undefined && { workflowId: opts.workflowId }),
    ...(opts.workflowExecutionId !== undefined && {
      workflowExecutionId: opts.workflowExecutionId,
    }),
  };

  let job: Job;
  try {
    job = await jobService.createJob({
      eventId: event.id,
      userId: runAsUserId,
      type: jobType,
      priority: event.priority ?? JobPriority.NORMAL,
      payload,
      source: SOURCE_MAP[opts.triggeredBy],
      timeoutMs: eventTimeoutMs(event),
      // In-process types run a single attempt (non-idempotent sends must not
      // double-deliver); script retries come from the event's setting.
      maxAttempts: runsInProcess ? 0 : (event.retries ?? 0),
      leaseLossPolicy: event.leaseLossPolicy ?? LeaseLossPolicy.RETRY,
      ...(event.overlapPolicy === OverlapPolicy.SKIP && {
        activeKey: String(event.id),
      }),
      scheduledMiss: opts.scheduledMiss ?? false,
      metadata: {
        eventName: event.name,
        triggeredBy: opts.triggeredBy,
        logId: log.id,
        ...(opts.workflowId !== undefined && { workflowId: opts.workflowId }),
        ...(opts.workflowExecutionId !== undefined && {
          workflowExecutionId: opts.workflowExecutionId,
        }),
        ...(opts.workflowStepRunId !== undefined && {
          workflowStepRunId: opts.workflowStepRunId,
        }),
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // SKIP overlap policy: a previous run of this event is still active
      // (jobs_active_key_uq). Record the skip loudly and finalize the log. The run
      // is skipped either way, so neither write failing changes the answer, and a
      // failed incident can't leave the log PENDING with nothing to finalize it.
      await storage
        .updateLog(log.id, {
          status: LogStatus.FAILURE,
          endTime: new Date(),
          error:
            "Skipped: a previous run of this event is still active (overlap policy: SKIP)",
        })
        .catch(reportFailedWrite("finalize a skipped run's log", event.id));
      await db
        .insert(scheduleIncidents)
        .values({
          eventId: event.id,
          kind: ScheduleIncidentKind.SKIPPED_OVERLAP,
          details: { logId: log.id, triggeredBy: opts.triggeredBy },
        })
        .catch(reportFailedWrite("record a skipped run", event.id));
      console.log(
        `[Dispatch] Event ${event.id} skipped (overlap policy SKIP, previous run active)`,
      );
      return { job: null, logId: null, skipped: "overlap" };
    }
    // No job will ever finalize this row, so it would sit PENDING forever.
    await storage
      .updateLog(log.id, {
        status: LogStatus.FAILURE,
        endTime: new Date(),
        error: "Failed to enqueue the job for this run",
      })
      .catch(() => undefined);
    throw error;
  }

  // The job is queued from here on and will run, so nothing below may fail the
  // dispatch. A CI caller told it failed would retry into a second run, and a
  // workflow step would be marked failed over a job still running. The run needs
  // neither write: it finds its log through the payload, and the claim loops poll
  // as well as listening for the notify in recordJobCreated.
  await storage
    .updateLog(log.id, { jobId: job.id, status: LogStatus.PENDING })
    .catch(reportFailedWrite("link a job to its log", event.id));

  await recordJobCreated(job.id, actor, {
    eventId: event.id,
    triggeredBy: opts.triggeredBy,
    logId: log.id,
  }).catch(reportFailedWrite("record a job's creation", event.id));

  // Execution bookkeeping the old system never wrote (C8): count scheduled/
  // workflow/webhook dispatches and stamp lastRunAt. Manual runs don't count
  // against maxExecutions, mirroring checkMaxExecutions above.
  if (opts.triggeredBy !== "manual") {
    try {
      // Incremented in SQL, not from the count read at the top of this
      // function: concurrent dispatches (schedule + webhook, or two workers)
      // would otherwise both write the same value and lose one, letting an
      // event with maxExecutions run past its cap.
      await storage.recordEventDispatch(event.id);
    } catch (error) {
      console.error(
        `[Dispatch] Failed to update execution bookkeeping for event ${event.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Tool actions and HTTP requests are claimed by the worker's in-process
  // executor pool (src/lib/scheduling/worker-executor.ts) through the same
  // lease mechanism as script jobs — no fire-and-forget execution from the
  // web process. recordJobCreated's pg_notify('job_queued') above wakes the
  // worker's claim loop for low latency.
  return { job, logId: log.id };
}
