import { EventStatus, TimeUnit } from "@/shared/schema";
import {
  scheduleJob,
  RecurrenceRule,
  Job as NodeScheduleJob,
  gracefulShutdown,
} from "node-schedule";
import { db } from "@/server/db";
import { sql } from "drizzle-orm";
import { storage } from "@/server/storage";
import { events } from "@/shared/schema";

// Import modules
import { executeScript } from "./execute-script";
import {
  handleSuccessActions,
  handleFailureActions,
  handleAlwaysActions,
  handleConditionActions,
  processEvent,
} from "./event-handlers";
import { handleExecutionCount } from "./execution-counter";

export class ScriptScheduler {
  private jobs: Map<number, NodeScheduleJob> = new Map();
  private isInitialized = false;
  private initializationInProgress = false;
  private lastInitializedAt: Date | null = null;
  // Track event execution times to prevent duplicate runs
  private lastExecutionTimes: Map<number, Date> = new Map();
  // Track events that are currently executing to prevent parallel execution
  private executingEvents: Set<number> = new Set();
  // Track events that are currently being scheduled to prevent duplicate job creation
  private schedulingInProgress: Set<number> = new Set();

  constructor() {}

  async initialize() {
    // Check if already initialized or initialization is in progress
    if (this.isInitialized) {
      console.log("Scheduler already initialized. Skipping initialization.");
      return;
    }

    if (this.initializationInProgress) {
      console.log(
        "Scheduler initialization already in progress. Skipping duplicate call.",
      );
      return;
    }

    // Set initialization in progress flag
    this.initializationInProgress = true;

    try {
      // If we've initialized within the last minute, don't reload all events
      // This prevents multiple rapid initializations during app startup
      const now = new Date();
      if (
        this.lastInitializedAt &&
        now.getTime() - this.lastInitializedAt.getTime() < 60000
      ) {
        console.log(
          "Scheduler was recently initialized. Skipping re-initialization.",
        );
        this.isInitialized = true;
        this.initializationInProgress = false;
        return;
      }

      // IMPORTANT: Cancel ALL existing jobs before loading fresh ones
      // This ensures we don't have any lingering jobs from previous runs
      console.log("Cancelling all existing scheduled jobs");
      this.jobs.forEach((job, eventId) => {
        console.log(
          `Cancelling existing job for event ${eventId} during initialization`,
        );
        job.cancel();
        this.jobs.delete(eventId);
      });

      // Clean all tracking state to start fresh
      this.lastExecutionTimes.clear();
      this.executingEvents.clear();

      // Load ONLY active events from the database
      const activeEvents = await db
        .select()
        .from(events)
        .where(sql`${events.status} = 'ACTIVE'`);

      console.log(`Found ${activeEvents.length} active events to schedule`);

      // Schedule each active event with a fresh state
      for (const event of activeEvents) {
        const fullEvent = await storage.getEventWithRelations(event.id);
        if (fullEvent && fullEvent.status === "ACTIVE") {
          await this.scheduleScript(fullEvent);
        }
      }

      this.isInitialized = true;
      this.lastInitializedAt = now;
      console.log(
        `Event scheduler initialized with ${activeEvents.length} active events`,
      );

      // Handle graceful shutdown
      process.on("SIGTERM", () => {
        this.shutdown();
      });

      process.on("SIGINT", () => {
        this.shutdown();
      });
    } catch (error) {
      console.error("Failed to initialize event scheduler:", error);
      throw error;
    } finally {
      this.initializationInProgress = false;
    }
  }

  private shutdown() {
    console.log("Shutting down event scheduler...");
    gracefulShutdown();
    process.exit(0);
  }

  async scheduleScript(event: any) {
    console.log(`Attempting to schedule event ${event.id}: ${event.name}`);

    // Prevent duplicate scheduling attempts during the process
    if (this.schedulingInProgress.has(event.id)) {
      console.log(
        `Event ${event.id} is already being scheduled elsewhere. Skipping duplicate attempt.`,
      );
      return;
    }

    // Cancel existing job if it exists
    if (this.jobs.has(event.id)) {
      console.log(`Cancelling existing job for event ${event.id}`);
      this.jobs.get(event.id)?.cancel();
      this.jobs.delete(event.id);
    }

    if (event.status !== "ACTIVE") {
      console.log(`Script ${event.id} is not active, skipping scheduling`);
      return;
    }

    try {
      // Ensure we have the most up-to-date event data
      // This is important for when a event transitions from DRAFT to ACTIVE
      const refreshedScript = await storage.getEventWithRelations(event.id);
      if (!refreshedScript) {
        console.error(`Script ${event.id} not found during scheduling refresh`);
        return;
      }

      // Debug log to help diagnose issues
      console.log(
        `Scheduling event ${refreshedScript.id} (${refreshedScript.name})`,
      );
      console.log(
        `Script status: ${refreshedScript.status}, Start time: ${refreshedScript.startTime ? new Date(refreshedScript.startTime).toISOString() : "Not set"}`,
      );

      // Check if event has a start time in the future
      const hasStartTime = refreshedScript.startTime != null;
      const startDate = hasStartTime
        ? new Date(refreshedScript.startTime)
        : null;
      const now = new Date();
      const startTimeInFuture = hasStartTime && startDate && startDate > now;

      console.log(
        `Current time: ${now.toISOString()}, Start time in future: ${startTimeInFuture}`,
      );

      if (startTimeInFuture) {
        console.log(
          `Script ${refreshedScript.id} has future start time: ${startDate?.toISOString()}. Scheduling initial activation.`,
        );

        // Schedule a one-time job at the start time
        const initialJob = scheduleJob(startDate, async () => {
          console.log(
            `Start time reached for event ${refreshedScript.id}. Executing and activating recurring schedule.`,
          );

          // Execute the event immediately when the start time is reached
          await this.executeScript(refreshedScript);

          // Then set up the recurring schedule
          this.setupRecurringSchedule(refreshedScript);
        });

        // Store the initial job
        this.jobs.set(refreshedScript.id, initialJob);
        console.log(
          `Initial job scheduled for event ${refreshedScript.id}: ${refreshedScript.name} at ${startDate?.toISOString()}`,
        );
      } else {
        // Set up the recurring schedule immediately
        console.log(
          `Script ${refreshedScript.id} has no future start time or start time has passed. Setting up recurring schedule immediately.`,
        );
        this.setupRecurringSchedule(refreshedScript);
      }
    } catch (error) {
      console.error(`Error scheduling event ${event.id}:`, error);
    }
  }

  /**
   * Set up a recurring schedule for an event with race condition handling
   */
  private setupRecurringSchedule(event: any) {
    // Create a unique ID for this setup process for better debugging
    const setupId = `setup-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    console.log(
      `[${setupId}] Setting up schedule for event ${event.id}: ${event.name}`,
    );

    // Prevent duplicate scheduling attempts
    if (this.schedulingInProgress.has(event.id)) {
      console.log(
        `[${setupId}] Event ${event.id} is already being scheduled. Skipping duplicate attempt.`,
      );
      return;
    }

    // Check if a job already exists for this event
    if (this.jobs.has(event.id)) {
      console.log(
        `[${setupId}] Event ${event.id} already has an active job. Skipping duplicate scheduling.`,
      );
      return;
    }

    this.schedulingInProgress.add(event.id);

    try {
      // DUPLICATE EXECUTION FIX: Cancel any existing job for this event
      // This is critical to prevent multiple executions of the same event
      if (this.jobs.has(event.id)) {
        console.log(
          `[${setupId}] Cancelling existing job for event ${event.id}`,
        );
        const job = this.jobs.get(event.id);
        if (job) {
          job.cancel();
        }
        this.jobs.delete(event.id);
      }

      // Also ensure any execution state is cleared completely
      this.executingEvents.delete(event.id);

      // Since we cleared the existing job above, we can proceed with scheduling
      // No need for additional locking mechanism that causes TypeScript issues

      // Create a single precise schedule rule based on event configuration
      let rule: RecurrenceRule | string;

      if (event.customSchedule) {
        // Use custom cron schedule
        rule = event.customSchedule;
        console.log(
          `[${setupId}] Using custom schedule: ${event.customSchedule}`,
        );
      } else {
        // Create a precise recurrence rule
        rule = new RecurrenceRule();

        switch (event.scheduleUnit) {
          case TimeUnit.SECONDS: {
            // For second-based schedules, set up a single specific time pattern
            if (event.scheduleNumber === 15) {
              rule.second = [0, 15, 30, 45];
            } else if (event.scheduleNumber === 30) {
              rule.second = [0, 30];
            } else {
              // For other schedules, just run on that specific second
              rule.second = event.scheduleNumber;
            }
            console.log(
              `[${setupId}] For ${event.scheduleNumber}-second schedule, using precise schedule`,
            );
            break;
          }
          case TimeUnit.MINUTES: {
            // For minute-based schedules, define specific minutes
            const minutesArray = [];
            for (let i = 0; i < 60; i += event.scheduleNumber) {
              minutesArray.push(i);
            }
            rule.minute = minutesArray;
            rule.second = 0; // Only at the start of each minute
            console.log(
              `[${setupId}] For ${event.scheduleNumber}-minute schedule, using minutes: ${minutesArray.join(", ")}`,
            );
            break;
          }
          case TimeUnit.HOURS: {
            // For hour-based schedules, define specific hours
            const hoursArray = [];
            for (let i = 0; i < 24; i += event.scheduleNumber) {
              hoursArray.push(i);
            }
            rule.hour = hoursArray;
            rule.minute = 0; // At the start of the hour
            rule.second = 0; // At the start of the minute
            console.log(
              `[${setupId}] For ${event.scheduleNumber}-hour schedule, using hours: ${hoursArray.join(", ")}`,
            );
            break;
          }
          case TimeUnit.DAYS: {
            // For day-based schedules, define specific days
            const daysArray = [];
            for (let i = 0; i < 7; i += event.scheduleNumber) {
              daysArray.push(i);
            }
            rule.dayOfWeek = daysArray;
            rule.hour = 0; // At midnight
            rule.minute = 0; // At the start of the hour
            rule.second = 0; // At the start of the minute
            console.log(
              `[${setupId}] For ${event.scheduleNumber}-day schedule, using days: ${daysArray.join(", ")}`,
            );
            break;
          }
          default:
            console.error(
              `[${setupId}] Unsupported schedule unit: ${event.scheduleUnit}`,
            );
            throw new Error(`Unsupported schedule unit: ${event.scheduleUnit}`);
        }
      }

      // Capture event ID to avoid closure issues
      const eventId = event.id;

      // Schedule the job with a dedicated execution handler
      // Create a unique job to prevent duplicate schedules
      const job = scheduleJob(rule, async () => {
        // Create a unique execution ID for this particular scheduled run
        const execId = `exec-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        console.log(`[${execId}] Scheduled trigger for event ${eventId}`);

        try {
          // CRITICAL: Check if this event is already executing FIRST
          // This prevents duplicate executions from multiple jobs
          if (this.executingEvents.has(eventId)) {
            console.log(
              `[${execId}] Event ${eventId} is already executing. Skipping this run.`,
            );
            return;
          }

          // Mark as executing immediately to prevent race conditions
          this.executingEvents.add(eventId);

          try {
            // Get the most current event data each time
            const currentScript = await storage.getEventWithRelations(eventId);

            // Basic checks - is the event still active?
            if (!currentScript) {
              console.log(
                `[${execId}] Event ${eventId} no longer exists. Removing schedule.`,
              );
              this.jobs.get(eventId)?.cancel();
              this.jobs.delete(eventId);
              return;
            }

            if (currentScript.status !== EventStatus.ACTIVE) {
              console.log(
                `[${execId}] Script ${eventId} is no longer active. Cancelling schedule.`,
              );
              // Cancel this job since the script is no longer active
              this.jobs.get(eventId)?.cancel();
              this.jobs.delete(eventId);
              return;
            }

            // Check if we're too close to the last execution
            const now = new Date();
            const lastExecution = this.lastExecutionTimes.get(eventId);

            if (lastExecution) {
              const timeSinceLastExecution =
                now.getTime() - lastExecution.getTime();

              // Calculate minimum interval between runs based on schedule type
              let minimumInterval: number;

              if (currentScript.scheduleUnit === TimeUnit.SECONDS) {
                // For seconds, use 80% of the interval (allow some variance)
                minimumInterval = Math.max(
                  500,
                  currentScript.scheduleNumber * 1000 * 0.8,
                );

                if (timeSinceLastExecution < minimumInterval) {
                  console.log(
                    `[${execId}] Too soon after last execution (${timeSinceLastExecution}ms < ${minimumInterval}ms). Skipping.`,
                  );
                  return;
                }
              } else if (currentScript.scheduleUnit === TimeUnit.MINUTES) {
                // For minutes, use a fixed 2-second buffer for 1 minute, or 10% for others
                minimumInterval =
                  currentScript.scheduleNumber === 1
                    ? 2000
                    : Math.max(
                        500,
                        currentScript.scheduleNumber * 60 * 1000 * 0.1,
                      );

                if (timeSinceLastExecution < minimumInterval) {
                  console.log(
                    `[${execId}] Too soon after last execution (${timeSinceLastExecution}ms < ${minimumInterval}ms). Skipping.`,
                  );
                  return;
                }
              } else if (currentScript.customSchedule) {
                // For custom schedules, use a small fixed buffer
                if (timeSinceLastExecution < 500) {
                  console.log(
                    `[${execId}] Too soon after last execution for custom schedule (${timeSinceLastExecution}ms < 500ms). Skipping.`,
                  );
                  return;
                }
              } else {
                // Default case - minimal buffer
                if (timeSinceLastExecution < 500) {
                  console.log(
                    `[${execId}] Too soon after last execution (${timeSinceLastExecution}ms < 500ms). Skipping.`,
                  );
                  return;
                }
              }
            }

            // We've passed all checks - this execution can proceed
            // Record the timestamp before executing
            this.lastExecutionTimes.set(eventId, now);
            console.log(
              `[${execId}] Starting execution for event ${eventId} at ${now.toISOString()}`,
            );

            // Execute the event using our managed method
            await this.executeScript(currentScript);
          } catch (error) {
            console.error(`[${execId}] Error during execution:`, error);
          } finally {
            // Always clear the executing flag when done to prevent stuck jobs
            this.executingEvents.delete(eventId);
            console.log(
              `[${execId}] Cleared executing state for event ${eventId}`,
            );
          }

          // Update next execution time
          try {
            // Use type casting to access the nextInvocation method
            const nextRun = (job as any).nextInvocation?.();
            if (nextRun) {
              storage
                .updateScript(eventId, { nextRunAt: nextRun })
                .then(() => {
                  console.log(
                    `[${execId}] Next execution set to: ${nextRun.toISOString()}`,
                  );
                })
                .catch((err) =>
                  console.error(
                    `[${execId}] Failed to update next run time:`,
                    err,
                  ),
                );
            }
          } catch (error) {
            console.error(
              `[${execId}] Error getting next invocation time:`,
              error,
            );
          }
        } catch (error) {
          console.error(`[${execId}] Error during scheduled execution:`, error);
        }
      });

      // Final check before storing the job - this is critical to prevent duplicates
      if (this.jobs.has(event.id)) {
        console.log(
          `[${setupId}] Another job was created for event ${event.id} during setup. Cancelling the new job.`,
        );
        job.cancel();
        return;
      }

      // Store job and update next run time
      this.jobs.set(event.id, job);

      // Try to set initial next run time
      try {
        // Use type cast to access the nextInvocation method
        const nextRun = (job as any).nextInvocation?.();
        if (nextRun) {
          storage
            .updateScript(event.id, { nextRunAt: nextRun })
            .then(() => {
              console.log(
                `[${setupId}] Initial execution scheduled for: ${nextRun.toISOString()}`,
              );
            })
            .catch((err) => {
              console.error(
                `[${setupId}] Error setting initial next run time:`,
                err,
              );
            });
        }
      } catch (err) {
        console.error(`[${setupId}] Error setting initial next run time:`, err);
      }

      console.log(
        `[${setupId}] Successfully scheduled event ${event.id}: ${event.name}`,
      );
    } catch (error) {
      console.error(`[${setupId}] Error setting up schedule:`, error);
      throw error;
    } finally {
      // Always clean up the scheduling lock
      this.schedulingInProgress.delete(event.id);
    }
  }

  // Execute a script by delegating to the appropriate execution module
  async executeScript(event: any) {
    // Create a unique execution ID to help with debugging
    const executionId = `exec-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    console.log(
      `[${executionId}] Starting execution of script ${event.id}: ${event.name}`,
    );

    // Check for existing execution locks before we do anything else
    const currentExecutions = Array.from(this.executingEvents);
    if (currentExecutions.length > 0) {
      console.log(
        `[${executionId}] Current executions in progress: ${currentExecutions.join(", ")}`,
      );
    }

    try {
      // IMPORTANT FIX: We're getting false positives on the execution tracking
      // Let's RESET our tracking state completely and start fresh with this execution
      if (this.executingEvents.has(event.id)) {
        console.log(
          `[${executionId}] Clearing previous execution state for script ${event.id}`,
        );
        this.executingEvents.delete(event.id);
      }

      // Mark it as executing
      this.executingEvents.add(event.id);
      console.log(
        `[${executionId}] Added script ${event.id} to executing set: ${Array.from(this.executingEvents).join(", ")}`,
      );

      // Execute the script through the modular function
      // IMPORTANT: Pass this.executingEvents directly to ensure proper tracking
      const result = await executeScript(
        event,
        this.executingEvents, // Pass the actual Set we're tracking
        this.handleSuccessActions.bind(this),
        this.handleFailureActions.bind(this),
        this.handleAlwaysActions.bind(this),
        this.handleConditionActions.bind(this),
        this.handleExecutionCount.bind(this),
        {}, // No input data for scheduled executions
        undefined, // No workflowId for regular script executions
      );

      console.log(
        `[${executionId}] Finished execution of script ${event.id}: ${event.name}, success: ${result.success}`,
      );
      return result;
    } catch (error) {
      console.error(
        `[${executionId}] Error executing script ${event.id}:`,
        error,
      );
      throw error;
    } finally {
      // Make sure we ALWAYS clear the executing state, even on errors
      this.executingEvents.delete(event.id);
      console.log(
        `[${executionId}] Cleared executing state for script ${event.id}, remaining: ${Array.from(this.executingEvents).join(", ")}`,
      );
    }
  }

  // Expose methods from the imported modules but bind them to this instance
  private async handleExecutionCount(eventId: number) {
    return handleExecutionCount(eventId);
  }

  private async handleSuccessActions(eventId: number) {
    return handleSuccessActions(eventId, this.processEvent.bind(this));
  }

  private async handleFailureActions(eventId: number) {
    return handleFailureActions(eventId, this.processEvent.bind(this));
  }

  private async handleAlwaysActions(eventId: number) {
    return handleAlwaysActions(eventId, this.processEvent.bind(this));
  }

  private async handleConditionActions(eventId: number, condition: boolean) {
    return handleConditionActions(
      eventId,
      condition,
      this.processEvent.bind(this),
    );
  }

  private async processEvent(
    conditional_event: any,
    event: any,
    isSuccess: boolean,
    executionData?: {
      executionTime?: string;
      duration?: number;
      output?: string;
      error?: string;
    },
  ) {
    return processEvent(conditional_event, event, isSuccess, executionData);
  }

  // Execute an event for workflow usage (with workflow execution tracking)
  async executeEvent(
    eventId: number,
    workflowExecutionId?: number,
    sequenceOrder?: number,
    input: Record<string, any> = {},
    workflowId?: number,
  ): Promise<{
    success: boolean;
    output: string;
    duration?: number;
    scriptOutput?: any;
    condition?: boolean;
  }> {
    const event = await storage.getEventWithRelations(eventId);
    if (!event) throw new Error(`Event with ID ${eventId} not found`);

    console.log(
      `Executing event ${eventId} for workflow execution ${workflowExecutionId || "standalone"}`,
    );

    const startTime = Date.now();

    // Make sure we're not tracking it as already executing
    this.executingEvents.delete(eventId);

    // Execute directly with the imported function, passing input data and workflowId
    const result = await executeScript(
      event,
      new Set<number>(), // Empty set to avoid double checking
      this.handleSuccessActions.bind(this),
      this.handleFailureActions.bind(this),
      this.handleAlwaysActions.bind(this),
      this.handleConditionActions.bind(this),
      this.handleExecutionCount.bind(this),
      input,
      workflowId,
    );

    const duration = Date.now() - startTime;

    return {
      ...result,
      duration,
    };
  }

  // Execute a script immediately (on-demand)
  async runScriptImmediately(
    eventId: number,
  ): Promise<{ success: boolean; output: string }> {
    const event = await storage.getEventWithRelations(eventId);
    if (!event) throw new Error(`Script with ID ${eventId} not found`);

    console.log(`Running script ${eventId} immediately`);

    // Make sure we're not tracking it as already executing
    this.executingEvents.delete(eventId);

    // Execute directly with the imported function
    return executeScript(
      event,
      new Set<number>(), // Empty set to avoid double checking
      this.handleSuccessActions.bind(this),
      this.handleFailureActions.bind(this),
      this.handleAlwaysActions.bind(this),
      this.handleConditionActions.bind(this),
      this.handleExecutionCount.bind(this),
      {}, // No input data for immediate execution
      undefined, // No workflowId for immediate script executions
    );
  }

  // Update an existing script's schedule
  async updateScript(eventId: number) {
    try {
      // Get the current job and cancel it
      if (this.jobs.has(eventId)) {
        console.log(`Cancelling job for event ${eventId} during update`);
        this.jobs.get(eventId)?.cancel();
        this.jobs.delete(eventId);
      }

      // Get the script details and check if it's still active
      const event = await storage.getEventWithRelations(eventId);
      if (!event) {
        console.log(`Event ${eventId} not found. Skipping update.`);
        return;
      }

      if (event.status === EventStatus.ACTIVE) {
        console.log(`Re-scheduling updated event ${eventId}: ${event.name}`);
        await this.scheduleScript(event);
      } else {
        console.log(
          `Updated script ${eventId}: ${event.name} is not active. Skipping scheduling.`,
        );
      }
    } catch (error) {
      console.error(`Error updating event ${eventId}:`, error);
    }
  }

  // Delete a script's schedule
  async deleteScript(eventId: number) {
    try {
      // Get the current job and cancel it
      if (this.jobs.has(eventId)) {
        console.log(`Cancelling job for event ${eventId} during deletion`);
        this.jobs.get(eventId)?.cancel();
        this.jobs.delete(eventId);
      }
    } catch (error) {
      console.error(`Error deleting event ${eventId} schedule:`, error);
    }
  }
}
