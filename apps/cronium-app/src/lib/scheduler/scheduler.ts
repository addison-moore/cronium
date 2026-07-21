import type { EventWithRelations } from "@/server/storage";
import { refreshEventSchedule } from "@/lib/scheduling/materialize";

/**
 * Scheduling facade.
 *
 * Since Phase 2 of the scheduling overhaul (_plans/scheduling/PLAN.md) this
 * class holds NO in-memory timers and, since Phase 6, no execution helpers
 * either. Schedules are durable: mutations materialize events.next_run_at
 * (src/lib/scheduling/materialize.ts) and the worker's dispatcher loop turns
 * due rows into jobs. Execution goes through the single enqueue path
 * (src/lib/scheduling/dispatch.ts) and, for workflows, the event-sourced
 * engine (src/lib/scheduling/workflow-engine.ts).
 *
 * The three methods below exist so the events router's call sites read
 * naturally; they all just re-materialize.
 */
export class ScriptScheduler {
  /** Recompute the durable schedule for an event (post create/activate). */
  async scheduleScript(event: EventWithRelations) {
    await refreshEventSchedule(event.id);
  }

  /** Recompute after a schedule-affecting update (also clears when paused). */
  async updateScript(eventId: number) {
    await refreshEventSchedule(eventId);
  }

  /** Clear scheduling state on deactivate/delete (refresh handles both: a
   * non-ACTIVE event materializes to NULL; a deleted event is a no-op). */
  async deleteScript(eventId: number) {
    await refreshEventSchedule(eventId);
  }
}
