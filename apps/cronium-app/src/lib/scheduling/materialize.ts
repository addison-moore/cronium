/**
 * next_run_at materialization (_plans/scheduling/PLAN.md §3.1).
 *
 * The dispatcher's only input is events.next_run_at. This module recomputes it
 * whenever a schedule-affecting mutation happens (create/update/activate/
 * deactivate) and notifies the worker so the change takes effect without
 * waiting for the next poll tick.
 *
 * Re-anchoring rule: any refresh computes from "now" with no prevNext — an
 * edited or resumed schedule starts its cadence fresh and never replays the
 * paused period (PLAN.md §3.1 un-pausing rule).
 */

import { db } from "@/server/db";
import { events, EventStatus, EventTriggerType } from "@/shared/schema";
import { eq, sql } from "drizzle-orm";
import { computeNextRun, specFromEvent } from "./schedule-math";

export async function notifyScheduleChanged(eventId: number): Promise<void> {
  try {
    await db.execute(
      sql`SELECT pg_notify('schedule_changed', ${String(eventId)})`,
    );
  } catch (error) {
    // Notification is an accelerant only; the dispatcher polls regardless.
    console.warn(
      `[Materialize] pg_notify failed for event ${eventId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Recompute and persist next_run_at for an event. Clears it when the event is
 * not an ACTIVE + SCHEDULE-triggered event or its schedule is inexpressible
 * (invalid cron — which the form validation should have rejected upstream).
 * Missing events are a no-op (deletion path).
 */
export async function refreshEventSchedule(
  eventId: number,
): Promise<Date | null> {
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) return null;

  let next: Date | null = null;
  if (
    event.status === EventStatus.ACTIVE &&
    event.triggerType === EventTriggerType.SCHEDULE
  ) {
    const spec = specFromEvent(event);
    next = spec
      ? computeNextRun(spec, { from: new Date(), prevNext: null })
      : null;
    if (!next) {
      console.warn(
        `[Materialize] Event ${eventId} is ACTIVE + SCHEDULE but has no computable next run (invalid schedule?)`,
      );
    }
  }

  await db
    .update(events)
    .set({ nextRunAt: next, updatedAt: new Date() })
    .where(eq(events.id, eventId));
  await notifyScheduleChanged(eventId);
  return next;
}
