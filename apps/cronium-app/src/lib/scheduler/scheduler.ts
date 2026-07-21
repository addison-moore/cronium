import { storage, type EventWithRelations } from "@/server/storage";
import { refreshEventSchedule } from "@/lib/scheduling/materialize";

interface ExecutionResult {
  success: boolean;
  output: string;
  duration?: number;
  scriptOutput?: unknown;
  condition?: boolean | undefined;
}

/**
 * Scheduling facade.
 *
 * Since Phase 2 of the scheduling overhaul (_plans/scheduling/PLAN.md) this
 * class holds NO in-memory timers. Schedules are durable: mutations
 * materialize events.next_run_at (src/lib/scheduling/materialize.ts) and the
 * worker process's dispatcher loop (src/lib/scheduling/dispatcher.ts) turns
 * due rows into jobs. The schedule/update/delete methods below exist so the
 * events router's call sites keep working; they simply re-materialize.
 *
 * Execution helpers (executeScript / executeEvent / runScriptImmediately)
 * remain the entry points used by the workflow executor and internal callers;
 * all of them enqueue through the single dispatch path
 * (src/lib/scheduling/dispatch.ts).
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

  // Execute a script by creating a job in the queue (single enqueue path:
  // src/lib/scheduling/dispatch.ts)
  async executeScript(
    event: EventWithRelations,
    inputData?: Record<string, unknown>,
    triggeredBy: "schedule" | "manual" = "schedule",
  ) {
    try {
      const { dispatchEventJob } = await import("@/lib/scheduling/dispatch");
      const result = await dispatchEventJob(event, {
        triggeredBy,
        input: inputData,
      });

      if (result.skipped) {
        return {
          success: true,
          output: `Run skipped (${result.skipped})`,
        };
      }

      return {
        success: true,
        output: `Job ${result.job.id} created and queued for execution`,
      };
    } catch (error) {
      console.error(
        `Error creating job for script ${String(event.id)}:`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  // Execute an event for workflow usage (with workflow execution tracking)
  async executeEvent(
    eventId: number,
    workflowExecutionId?: number,
    _sequenceOrder?: number,
    input: Record<string, unknown> = {},
    workflowId?: number,
    waitForCompletion = false,
  ): Promise<ExecutionResult> {
    const event = (await storage.getEventWithRelations(
      eventId,
    )) as EventWithRelations | null;
    if (!event) throw new Error(`Event with ID ${String(eventId)} not found`);

    console.log(
      `Executing event ${String(eventId)} for workflow execution ${workflowExecutionId ?? "standalone"}`,
    );

    const startTime = Date.now();

    // Single enqueue path; the worker's executor pool picks up in-process
    // types, so the job-completion poll below observes their progress.
    const { dispatchEventJob } = await import("@/lib/scheduling/dispatch");
    const dispatched = await dispatchEventJob(event, {
      triggeredBy: "workflow",
      input,
      workflowId,
      workflowExecutionId,
    });

    if (dispatched.skipped) {
      return {
        success: false,
        output: `Run skipped (${dispatched.skipped})`,
        duration: Date.now() - startTime,
      };
    }
    const job = dispatched.job;

    // Workflows always wait for the step's job to finish
    const shouldWait =
      waitForCompletion === true ||
      (workflowId !== undefined && workflowId !== null);

    if (shouldWait) {
      const { waitForJobCompletion } =
        await import("@/lib/services/job-polling-service");
      const { eventTimeoutMs } = await import("@/lib/scheduler/event-timeout");

      try {
        const result = await waitForJobCompletion({
          jobId: job.id,
          maxWaitTime: eventTimeoutMs(event),
          pollInterval: 1000,
        });

        console.log(`Job ${job.id} completed with status: ${result.status}`);

        return {
          success: result.success,
          output: result.output ?? result.error ?? "",
          duration: result.duration ?? Date.now() - startTime,
          scriptOutput: result.scriptOutput,
          condition: result.condition,
        };
      } catch (error) {
        console.error(`Error waiting for job ${job.id}:`, error);
        return {
          success: false,
          output: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        };
      }
    }

    return {
      success: true,
      output: `Job ${job.id} created and queued for execution`,
      duration: Date.now() - startTime,
    };
  }

  // Execute a script immediately (on-demand)
  async runScriptImmediately(
    eventId: number,
  ): Promise<{ success: boolean; output: string }> {
    const event = (await storage.getEventWithRelations(
      eventId,
    )) as EventWithRelations | null;
    if (!event) throw new Error(`Script with ID ${String(eventId)} not found`);

    console.log(`Running script ${String(eventId)} immediately`);

    // Same enqueue path, attributed as a manual run (exempt from maxExecutions)
    return this.executeScript(event, undefined, "manual");
  }
}
