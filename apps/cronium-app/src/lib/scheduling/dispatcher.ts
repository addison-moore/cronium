/**
 * The schedule dispatcher (PLAN.md §4.1) — the durable replacement for the old
 * in-memory node-schedule timers. Runs in the worker process on an interval
 * (NOTIFY 'schedule_changed' is a wake-up accelerant only).
 *
 * Each tick, inside one transaction with FOR UPDATE SKIP LOCKED (multi-replica
 * safe, no leader election):
 *   1. lock due events (ACTIVE + SCHEDULE + next_run_at <= now)
 *   2. plan ticks per misfire/catch-up policy (pure: plan-ticks.ts)
 *   3. advance next_run_at — this transaction "consumes" the ticks
 * then, after commit, record incidents and dispatch jobs through the single
 * enqueue path. Advance-then-dispatch means a crash in the tiny window between
 * commit and dispatch loses at most one batch (recorded nowhere) but can never
 * double-dispatch; the reverse order would duplicate on crash.
 */

import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  events,
  jobs,
  scheduleIncidents,
  workflows,
  CatchupPolicy,
  EventStatus,
  EventTriggerType,
  JobStatus,
  OverlapPolicy,
  ScheduleIncidentKind,
  WorkflowTriggerType,
} from "@/shared/schema";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { planTicks, type TickPlan } from "./plan-ticks";
import { specFromEvent } from "./schedule-math";
import {
  refreshEventSchedule,
  refreshWorkflowSchedule,
  specFromWorkflow,
} from "./materialize";
import { dispatchEventJob } from "./dispatch";

const DISPATCH_BATCH = 50;
const MATERIALIZE_BATCH = 20;

interface EventPlan {
  eventId: number;
  overlapPolicy: OverlapPolicy;
  plan: TickPlan;
}

/** ACTIVE + SCHEDULE events whose next_run_at was never materialized (legacy
 * rows, or rows written before materialization existed) get one within a tick. */
async function materializeMissing(): Promise<void> {
  const missing = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.status, EventStatus.ACTIVE),
        eq(events.triggerType, EventTriggerType.SCHEDULE),
        isNull(events.nextRunAt),
        // Broken schedules (refresh keeps materializing NULL) retry at most
        // once a minute instead of every dispatcher tick.
        sql`${events.updatedAt} < now() - interval '60 seconds'`,
      ),
    )
    .limit(MATERIALIZE_BATCH);

  for (const row of missing) {
    await refreshEventSchedule(row.id);
  }
}

/** Lock due events, plan their ticks, and advance next_run_at atomically. */
async function claimDuePlans(now: Date): Promise<EventPlan[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(events)
      .where(
        and(
          eq(events.status, EventStatus.ACTIVE),
          eq(events.triggerType, EventTriggerType.SCHEDULE),
          lte(events.nextRunAt, now),
        ),
      )
      .orderBy(events.nextRunAt)
      .limit(DISPATCH_BATCH)
      .for("update", { skipLocked: true });

    const plans: EventPlan[] = [];
    for (const event of due) {
      if (!event.nextRunAt) continue;

      const spec = specFromEvent(event);
      if (!spec) {
        // Inexpressible schedule: stop polling it and say why.
        await tx
          .update(events)
          .set({ nextRunAt: null, updatedAt: now })
          .where(eq(events.id, event.id));
        await tx.insert(scheduleIncidents).values({
          eventId: event.id,
          kind: ScheduleIncidentKind.MISSED,
          details: {
            scheduledFor: event.nextRunAt.toISOString(),
            reason: "unschedulable: invalid or missing schedule expression",
          },
        });
        continue;
      }

      const plan = planTicks({
        spec,
        dueAt: event.nextRunAt,
        now,
        catchupPolicy: event.catchupPolicy,
        misfireGraceS: event.misfireGraceS,
      });

      await tx
        .update(events)
        .set({ nextRunAt: plan.nextRunAt, updatedAt: now })
        .where(eq(events.id, event.id));

      plans.push({
        eventId: event.id,
        overlapPolicy: event.overlapPolicy,
        plan,
      });
    }
    return plans;
  });
}

/** QUEUE overlap policy: coalesce — at most one QUEUED job waits behind the
 * running one; further ticks fold into it. */
async function hasQueuedJob(eventId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.eventId, eventId), eq(jobs.status, JobStatus.QUEUED)))
    .limit(1);
  return !!row;
}

async function requestCancelOfLiveJobs(eventId: number): Promise<void> {
  await db
    .update(jobs)
    .set({ cancelRequested: true, updatedAt: new Date() })
    .where(
      and(
        eq(jobs.eventId, eventId),
        inArray(jobs.status, [
          JobStatus.QUEUED,
          JobStatus.CLAIMED,
          JobStatus.RUNNING,
        ]),
      ),
    );
}

export interface DispatchTickResult {
  dueEvents: number;
  dispatched: number;
  incidents: number;
  workflowRunsStarted: number;
}

interface WorkflowPlan {
  workflowId: number;
  plan: TickPlan;
}

/** Same materialize-missing pass for SCHEDULE-triggered workflows. */
async function materializeMissingWorkflows(): Promise<void> {
  const missing = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(
      and(
        eq(workflows.status, EventStatus.ACTIVE),
        eq(workflows.triggerType, WorkflowTriggerType.SCHEDULE),
        isNull(workflows.nextRunAt),
        sql`${workflows.updatedAt} < now() - interval '60 seconds'`,
      ),
    )
    .limit(MATERIALIZE_BATCH);
  for (const row of missing) {
    await refreshWorkflowSchedule(row.id);
  }
}

/** Lock due SCHEDULE workflows, plan ticks (default policies: SKIP catch-up,
 * 60s grace — workflows have no per-row policy columns yet), advance
 * next_run_at atomically. */
async function claimDueWorkflowPlans(now: Date): Promise<WorkflowPlan[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.status, EventStatus.ACTIVE),
          eq(workflows.triggerType, WorkflowTriggerType.SCHEDULE),
          lte(workflows.nextRunAt, now),
        ),
      )
      .orderBy(workflows.nextRunAt)
      .limit(DISPATCH_BATCH)
      .for("update", { skipLocked: true });

    const plans: WorkflowPlan[] = [];
    for (const workflow of due) {
      if (!workflow.nextRunAt) continue;
      const spec = specFromWorkflow(workflow);
      if (!spec) {
        await tx
          .update(workflows)
          .set({ nextRunAt: null, updatedAt: now })
          .where(eq(workflows.id, workflow.id));
        await tx.insert(scheduleIncidents).values({
          workflowId: workflow.id,
          kind: ScheduleIncidentKind.MISSED,
          details: {
            scheduledFor: workflow.nextRunAt.toISOString(),
            reason: "unschedulable: invalid or missing schedule expression",
          },
        });
        continue;
      }
      const plan = planTicks({
        spec,
        dueAt: workflow.nextRunAt,
        now,
        catchupPolicy: CatchupPolicy.SKIP,
        misfireGraceS: 60,
      });
      await tx
        .update(workflows)
        .set({ nextRunAt: plan.nextRunAt, updatedAt: now })
        .where(eq(workflows.id, workflow.id));
      plans.push({ workflowId: workflow.id, plan });
    }
    return plans;
  });
}

export async function runDispatchTick(
  now: Date = new Date(),
): Promise<DispatchTickResult> {
  await materializeMissing();
  await materializeMissingWorkflows();

  const plans = await claimDuePlans(now);
  let dispatched = 0;
  let incidents = 0;
  let workflowRunsStarted = 0;

  for (const { eventId, overlapPolicy, plan } of plans) {
    for (const incident of plan.incidents) {
      await db.insert(scheduleIncidents).values({
        eventId,
        kind: incident.kind,
        details: incident.details,
      });
      incidents++;
    }

    for (const tick of plan.ticks) {
      try {
        // Fresh row with relations each tick: dispatch needs envVars/servers,
        // and maxExecutions bookkeeping must not act on a stale count.
        const event = await storage.getEventWithRelations(eventId);
        if (!event || event.status !== EventStatus.ACTIVE) break;

        if (overlapPolicy === OverlapPolicy.QUEUE) {
          if (await hasQueuedJob(eventId)) {
            await db.insert(scheduleIncidents).values({
              eventId,
              kind: ScheduleIncidentKind.SKIPPED_OVERLAP,
              details: {
                scheduledFor: tick.at.toISOString(),
                foldedIntoQueuedJob: true,
              },
            });
            incidents++;
            continue;
          }
        } else if (overlapPolicy === OverlapPolicy.CANCEL_PREVIOUS) {
          await requestCancelOfLiveJobs(eventId);
        }

        const result = await dispatchEventJob(event, {
          triggeredBy: "schedule",
          scheduledMiss: tick.miss,
        });

        if (result.skipped === "max_executions") {
          // dispatch auto-paused the event; drop remaining ticks.
          break;
        }
        if (!result.skipped) dispatched++;
        // "overlap" skip: dispatch already recorded the incident.
      } catch (error) {
        // A failed dispatch must be loud, and one bad event must not stall
        // the rest of the batch.
        console.error(
          `[Dispatcher] Failed to dispatch event ${eventId} tick ${tick.at.toISOString()}:`,
          error instanceof Error ? error.message : String(error),
        );
        await db
          .insert(scheduleIncidents)
          .values({
            eventId,
            kind: ScheduleIncidentKind.MISSED,
            details: {
              scheduledFor: tick.at.toISOString(),
              reason: `dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          })
          .catch(() => undefined);
        incidents++;
      }
    }
  }

  // --- SCHEDULE-triggered workflows (review C2: these never fired before) ---
  const workflowPlans = await claimDueWorkflowPlans(now);
  for (const { workflowId, plan } of workflowPlans) {
    for (const incident of plan.incidents) {
      await db.insert(scheduleIncidents).values({
        workflowId,
        kind: incident.kind,
        details: incident.details,
      });
      incidents++;
    }
    for (const tick of plan.ticks) {
      try {
        const { startWorkflowRun } = await import("./workflow-engine");
        const { WorkflowTriggerType: TriggerType } =
          await import("@/shared/schema");
        const result = await startWorkflowRun(workflowId, {
          triggerType: TriggerType.SCHEDULE,
        });
        if (result.success) {
          workflowRunsStarted++;
        } else {
          await db.insert(scheduleIncidents).values({
            workflowId,
            kind: ScheduleIncidentKind.MISSED,
            details: {
              scheduledFor: tick.at.toISOString(),
              reason: `start failed: ${result.output ?? "unknown"}`,
            },
          });
          incidents++;
        }
      } catch (error) {
        console.error(
          `[Dispatcher] Failed to start scheduled workflow ${workflowId}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  return {
    dueEvents: plans.length,
    dispatched,
    incidents,
    workflowRunsStarted,
  };
}
