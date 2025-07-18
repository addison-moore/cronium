import { parseExpression } from "cron-parser";
import { jobService } from "@/lib/services/job-service";
import type { CreateJobInput } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import type { EventWithRelations } from "@/server/storage";
import { TimeUnit } from "@/shared/schema";

/**
 * Calculate the next execution time for a scheduled event
 */
export function calculateNextExecutionTime(
  event: EventWithRelations,
): Date | null {
  try {
    if (event.customSchedule) {
      // Parse cron expression
      const interval = parseExpression(String(event.customSchedule), {
        currentDate: new Date(),
      });
      return interval.next().toDate();
    }

    // For simple schedules, calculate based on last run
    const lastRun = event.lastRunAt
      ? new Date(event.lastRunAt as string | number | Date)
      : new Date();
    const now = new Date();

    // Calculate next run based on schedule unit and number
    let nextRun: Date;
    switch (event.scheduleUnit) {
      case TimeUnit.SECONDS:
        nextRun = new Date(
          lastRun.getTime() + (event.scheduleNumber ?? 5) * 1000,
        );
        break;
      case TimeUnit.MINUTES:
        nextRun = new Date(
          lastRun.getTime() + (event.scheduleNumber ?? 5) * 60 * 1000,
        );
        break;
      case TimeUnit.HOURS:
        nextRun = new Date(
          lastRun.getTime() + (event.scheduleNumber ?? 5) * 60 * 60 * 1000,
        );
        break;
      case TimeUnit.DAYS:
        nextRun = new Date(
          lastRun.getTime() + (event.scheduleNumber ?? 5) * 24 * 60 * 60 * 1000,
        );
        break;
      default:
        return null;
    }

    // If the calculated next run is in the past, use current time
    return nextRun > now ? nextRun : now;
  } catch (error) {
    console.error("Error calculating next execution time:", error);
    return null;
  }
}

/**
 * Create a job scheduled for future execution
 */
export async function createScheduledJob(
  input: Omit<CreateJobInput, "scheduledFor"> & {
    scheduledFor?: Date;
    isRecurring?: boolean;
  },
): Promise<string> {
  const scheduledFor = input.scheduledFor ?? new Date();

  const job = await jobService.createJob({
    ...input,
    scheduledFor,
    metadata: {
      ...input.metadata,
      isRecurring: input.isRecurring ?? false,
      scheduledAt: new Date().toISOString(),
    },
  });

  console.log(
    `Created job ${job.id} scheduled for ${scheduledFor.toISOString()}`,
  );
  return job.id;
}

/**
 * Create the next job for a recurring event
 */
export async function createNextRecurringJob(
  event: EventWithRelations,
  previousJobId?: string,
): Promise<string | null> {
  // Check if event should continue recurring
  if (event.maxExecutions > 0 && event.executionCount >= event.maxExecutions) {
    console.log(
      `Event ${String(event.id)} has reached max executions (${String(event.maxExecutions)})`,
    );
    return null;
  }

  // Calculate next execution time
  const nextExecutionTime = calculateNextExecutionTime(event);
  if (!nextExecutionTime) {
    console.error(
      `Could not calculate next execution time for event ${String(event.id)}`,
    );
    return null;
  }

  // Build job payload (reuse from job-payload-builder)
  const { buildJobPayload } = await import(
    "@/lib/scheduler/job-payload-builder"
  );

  const { LogStatus } = await import("@/shared/schema");

  // Create log entry for tracking
  const log = await storage.createLog({
    eventId: event.id,
    status: LogStatus.PENDING,
    startTime: new Date(),
    eventName: event.name ?? "Unknown",
    eventType: event.type,
    userId: event.userId,
  });

  const jobPayload = buildJobPayload(event, log.id);

  // Determine job type
  const { JobType, EventType } = await import("@/shared/schema");

  let jobType: (typeof JobType)[keyof typeof JobType];
  if (event.type === EventType.HTTP_REQUEST) {
    jobType = JobType.HTTP_REQUEST;
  } else if (event.toolActionConfig) {
    jobType = JobType.TOOL_ACTION;
  } else {
    jobType = JobType.SCRIPT;
  }

  // Create the scheduled job
  const jobId = await createScheduledJob({
    eventId: event.id,
    userId: String(event.userId),
    type: jobType,
    payload: jobPayload,
    scheduledFor: nextExecutionTime,
    isRecurring: true,
    metadata: {
      eventName: event.name ?? "Unknown",
      triggeredBy: "schedule",
      previousJobId,
      logId: log.id,
    },
  });

  // Update event with next run time
  await storage.updateScript(event.id, {
    nextRunAt: nextExecutionTime,
    lastRunAt: new Date(),
  });

  return jobId;
}

/**
 * Handle job completion for recurring events
 */
export async function handleRecurringJobCompletion(
  jobId: string,
  eventId: number,
): Promise<void> {
  try {
    // Get the event
    const event = await storage.getEventWithRelations(eventId);
    if (!event) {
      console.error(`Event ${eventId} not found`);
      return;
    }

    // Update execution count
    await storage.updateScript(eventId, {
      executionCount: Number(event.executionCount ?? 0) + 1,
    });

    const { EventStatus, EventTriggerType } = await import("@/shared/schema");

    // Create next job if event is still active and recurring
    if (
      event.status === EventStatus.ACTIVE &&
      event.triggerType === EventTriggerType.SCHEDULE
    ) {
      await createNextRecurringJob(event, jobId);
    }
  } catch (error) {
    console.error(`Error handling recurring job completion:`, error);
  }
}

/**
 * Validate a cron expression
 */
export function validateCronExpression(expression: string): {
  valid: boolean;
  error?: string;
  nextExecutions?: Date[];
} {
  try {
    const interval = parseExpression(expression);
    const nextExecutions = [];

    // Get next 5 execution times
    for (let i = 0; i < 5; i++) {
      nextExecutions.push(interval.next().toDate());
    }

    return {
      valid: true,
      nextExecutions,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid cron expression",
    };
  }
}
