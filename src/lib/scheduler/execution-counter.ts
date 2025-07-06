import { storage } from "@/server/storage";
import { EventStatus, LogStatus } from "@/shared/schema";
import { scheduler } from "@/lib/scheduler";

/**
 * Handle execution count and max executions
 * Increments the execution count and pauses the event if it reaches max executions
 */
export async function handleExecutionCount(eventId: number) {
  try {
    // Get the latest event data to ensure accurate count
    const event = await storage.getEvent(eventId);
    if (!event) {
      console.error(`Event ${eventId} not found when updating execution count`);
      return;
    }

    // Check if event has max executions configured (0 means unlimited)
    if (event.maxExecutions && event.maxExecutions > 0) {
      // Calculate new execution count
      const newExecutionCount = (event.executionCount || 0) + 1;

      // Check if we've hit the max execution limit
      if (newExecutionCount >= event.maxExecutions) {
        console.log(
          `Event ${eventId}: ${event.name} reached maximum executions (${event.maxExecutions}). Pausing.`,
        );

        // Pause the event automatically
        await storage.updateScript(eventId, {
          status: EventStatus.PAUSED,
          // Clear any nextRunAt to ensure it doesn't get rescheduled
          nextRunAt: null,
        });

        // IMPORTANT: Cancel the job in the scheduler to prevent further executions
        try {
          // Cancel any currently scheduled job for this event using the public API
          console.log(
            `Cancelling job for event ${eventId} after reaching max executions`,
          );
          await scheduler.deleteScript(eventId);
        } catch (err) {
          console.error(
            `Error cancelling scheduled job for event ${eventId} after max executions:`,
            err,
          );
        }

        // Log a message about why it was paused
        // Use PAUSED status instead of SUCCESS for clarity
        await storage.createLog({
          eventId: eventId,
          output: `Automatically paused after reaching max executions (${event.maxExecutions})`,
          status: LogStatus.PAUSED,
          startTime: new Date(),
          endTime: new Date(),
          successful: false, // Not a successful execution
          eventName: event.name,
          scriptType: event.type,
          userId: event.userId,
        });
      }
    } else {
      // Just increment the execution count without checking max
      // Get current count first to ensure accurate updates
      const currentCount = event.executionCount || 0;
      await storage.updateScript(eventId, {
        executionCount: currentCount + 1,
      });
    }
  } catch (err) {
    const error = err as Error;
    console.error(
      `Error handling execution count for event ${eventId}:`,
      error,
    );
  }
}
