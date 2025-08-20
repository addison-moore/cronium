import { EventStatus, TimeUnit, type ConditionalAction } from "@/shared/schema";
import { scheduleJob, RecurrenceRule, gracefulShutdown } from "node-schedule";
import type { Job as NodeScheduleJob } from "node-schedule";
import { storage, type EventWithRelations } from "@/server/storage";

// Import modules
import {
  handleSuccessActions,
  handleFailureActions,
  handleAlwaysActions,
  handleConditionActions,
  processEvent,
} from "./event-handlers";
import { handleExecutionCount } from "./execution-counter";

// Type definitions

// ConditionalEvent interface removed - using ConditionalAction from schema instead

interface ExecutionData {
  executionTime?: string;
  duration?: number;
  output?: string;
  error?: string;
}

interface ExecutionResult {
  success: boolean;
  output: string;
  duration?: number;
  scriptOutput?: unknown;
  condition?: boolean | undefined;
}

export class ScriptScheduler {
  private jobs = new Map<number, NodeScheduleJob>();
  private isInitialized = false;
  private initializationInProgress = false;
  private lastInitializedAt: Date | null = null;
  // Track event execution times to prevent duplicate runs
  private lastExecutionTimes = new Map<number, Date>();
  // Track events that are currently executing to prevent parallel execution
  private executingEvents = new Set<number>();
  // Track events that are currently being scheduled to prevent duplicate job creation
  private schedulingInProgress = new Set<number>();

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
          `Cancelling existing job for event ${String(eventId)} during initialization`,
        );
        job.cancel();
        this.jobs.delete(eventId);
      });

      // Clean all tracking state to start fresh
      this.lastExecutionTimes.clear();
      this.executingEvents.clear();

      // Load ALL active events with relations in a single optimized query
      const activeEvents = await storage.getActiveEventsWithRelations();

      console.log(
        `Found ${String(activeEvents.length)} active events to schedule`,
      );

      // Schedule each active event with a fresh state
      for (const event of activeEvents) {
        if (event.status === EventStatus.ACTIVE) {
          await this.scheduleScript(event);
        }
      }

      this.isInitialized = true;
      this.lastInitializedAt = now;
      console.log(
        `Event scheduler initialized with ${String(activeEvents.length)} active events`,
      );

      // Handle graceful shutdown
      process.on("SIGTERM", () => {
        this.shutdown();
      });

      process.on("SIGINT", () => {
        this.shutdown();
      });
    } catch (error) {
      console.error(
        "Failed to initialize event scheduler:",
        error instanceof Error ? error.message : String(error),
      );
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

  async scheduleScript(event: EventWithRelations) {
    console.log(
      `Attempting to schedule event ${String(event.id)}: ${String(event.name ?? "")}`,
    );

    // Prevent duplicate scheduling attempts during the process
    if (this.schedulingInProgress.has(event.id)) {
      console.log(
        `Event ${String(event.id)} is already being scheduled elsewhere. Skipping duplicate attempt.`,
      );
      return;
    }

    // Cancel existing job if it exists
    if (this.jobs.has(event.id)) {
      console.log(`Cancelling existing job for event ${String(event.id)}`);
      this.jobs.get(event.id)?.cancel();
      this.jobs.delete(event.id);
    }

    if (event.status !== EventStatus.ACTIVE) {
      console.log(
        `Script ${String(event.id)} is not active, skipping scheduling`,
      );
      return;
    }

    try {
      // Ensure we have the most up-to-date event data
      // This is important for when a event transitions from DRAFT to ACTIVE
      const refreshedScript = (await storage.getEventWithRelations(
        event.id,
      )) as EventWithRelations | null;
      if (!refreshedScript) {
        console.error(
          `Script ${String(event.id)} not found during scheduling refresh`,
        );
        return;
      }
      const typedRefreshedScript = refreshedScript;

      // Debug log to help diagnose issues
      console.log(
        `Scheduling event ${String(typedRefreshedScript.id)} (${String(typedRefreshedScript.name ?? "")})`,
      );
      console.log(
        `Script status: ${String(typedRefreshedScript.status ?? "")}, Start time: ${typedRefreshedScript.startTime ? new Date(typedRefreshedScript.startTime as string | number | Date).toISOString() : "Not set"}`,
      );

      // Check if event has a start time in the future
      const hasStartTime = typedRefreshedScript.startTime != null;
      const startDate =
        hasStartTime && typedRefreshedScript.startTime
          ? new Date(typedRefreshedScript.startTime)
          : null;
      const now = new Date();
      const startTimeInFuture = hasStartTime && startDate && startDate > now;

      console.log(
        `Current time: ${now.toISOString()}, Start time in future: ${String(startTimeInFuture)}`,
      );

      if (startTimeInFuture) {
        console.log(
          `Script ${String(typedRefreshedScript.id)} has future start time: ${startDate?.toISOString() ?? ""}. Scheduling initial activation.`,
        );

        // Schedule a one-time job at the start time
        const initialJob = scheduleJob(startDate, () => {
          console.log(
            `Start time reached for event ${String(typedRefreshedScript.id)}. Executing and activating recurring schedule.`,
          );

          // Execute the event immediately when the start time is reached
          void (async () => {
            try {
              await this.executeScript(typedRefreshedScript);
              // Then set up the recurring schedule
              this.setupRecurringSchedule(typedRefreshedScript);
            } catch (error) {
              console.error(
                `Error executing event ${String(typedRefreshedScript.id)} at start time:`,
                error instanceof Error ? error.message : String(error),
              );
            }
          })();
        });

        // Store the initial job
        this.jobs.set(typedRefreshedScript.id, initialJob);
        console.log(
          `Initial job scheduled for event ${String(typedRefreshedScript.id)}: ${String(typedRefreshedScript.name ?? "")} at ${String(startDate?.toISOString() ?? "")}`,
        );
      } else {
        // Set up the recurring schedule immediately
        console.log(
          `Script ${String(typedRefreshedScript.id)} has no future start time or start time has passed. Setting up recurring schedule immediately.`,
        );
        this.setupRecurringSchedule(typedRefreshedScript);
      }
    } catch (error) {
      console.error(
        `Error scheduling event ${String(event.id)}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Set up a recurring schedule for an event with race condition handling
   */
  private setupRecurringSchedule(event: EventWithRelations) {
    // Create a unique ID for this setup process for better debugging
    const setupId = `setup-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    console.log(
      `[${setupId}] Setting up schedule for event ${String(event.id)}: ${String(event.name ?? "")}`,
    );

    // Prevent duplicate scheduling attempts
    if (this.schedulingInProgress.has(event.id)) {
      console.log(
        `[${setupId}] Event ${String(event.id)} is already being scheduled. Skipping duplicate attempt.`,
      );
      return;
    }

    // Check if a job already exists for this event
    if (this.jobs.has(event.id)) {
      console.log(
        `[${setupId}] Event ${String(event.id)} already has an active job. Skipping duplicate scheduling.`,
      );
      return;
    }

    this.schedulingInProgress.add(event.id);

    try {
      // DUPLICATE EXECUTION FIX: Cancel any existing job for this event
      // This is critical to prevent multiple executions of the same event
      if (this.jobs.has(event.id)) {
        console.log(
          `[${setupId}] Cancelling existing job for event ${String(event.id)}`,
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
          `[${setupId}] Using custom schedule: ${String(event.customSchedule)}`,
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
              `[${setupId}] For ${String(event.scheduleNumber)}-second schedule, using precise schedule`,
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
              `[${setupId}] For ${String(event.scheduleNumber)}-minute schedule, using minutes: ${minutesArray.join(", ")}`,
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
              `[${setupId}] For ${String(event.scheduleNumber)}-hour schedule, using hours: ${hoursArray.join(", ")}`,
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
              `[${setupId}] For ${String(event.scheduleNumber)}-day schedule, using days: ${daysArray.join(", ")}`,
            );
            break;
          }
          default: {
            const exhaustiveCheck = event.scheduleUnit;
            console.error(
              `[${setupId}] Unsupported schedule unit: ${String(exhaustiveCheck)}`,
            );
            throw new Error(
              `Unsupported schedule unit: ${String(exhaustiveCheck)}`,
            );
          }
        }
      }

      // Capture event ID to avoid closure issues
      const eventId = event.id;

      // Schedule the job with a dedicated execution handler
      // Create a unique job to prevent duplicate schedules
      const job = scheduleJob(rule, () => {
        // Create a unique execution ID for this particular scheduled run
        const execId = `exec-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        console.log(
          `[${execId}] Scheduled trigger for event ${String(eventId)}`,
        );

        // Execute async logic in a promise
        void (async () => {
          try {
            // CRITICAL: Check if this event is already executing FIRST
            // This prevents duplicate executions from multiple jobs
            if (this.executingEvents.has(eventId)) {
              console.log(
                `[${execId}] Event ${String(eventId)} is already executing. Skipping this run.`,
              );
              return;
            }

            // Mark as executing immediately to prevent race conditions
            this.executingEvents.add(eventId);

            try {
              // Get the most current event data each time
              const currentScript = (await storage.getEventWithRelations(
                eventId,
              )) as EventWithRelations | null;

              // Basic checks - is the event still active?
              if (!currentScript) {
                console.log(
                  `[${execId}] Event ${String(eventId)} no longer exists. Removing schedule.`,
                );
                this.jobs.get(eventId)?.cancel();
                this.jobs.delete(eventId);
                return;
              }

              if (currentScript.status !== EventStatus.ACTIVE) {
                console.log(
                  `[${execId}] Script ${String(eventId)} is no longer active. Cancelling schedule.`,
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
                      `[${execId}] Too soon after last execution (${String(timeSinceLastExecution)}ms < ${String(minimumInterval)}ms). Skipping.`,
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
                      `[${execId}] Too soon after last execution (${String(timeSinceLastExecution)}ms < ${String(minimumInterval)}ms). Skipping.`,
                    );
                    return;
                  }
                } else if (currentScript.customSchedule) {
                  // For custom schedules, use a small fixed buffer
                  if (timeSinceLastExecution < 500) {
                    console.log(
                      `[${execId}] Too soon after last execution for custom schedule (${String(timeSinceLastExecution)}ms < 500ms). Skipping.`,
                    );
                    return;
                  }
                } else {
                  // Default case - minimal buffer
                  if (timeSinceLastExecution < 500) {
                    console.log(
                      `[${execId}] Too soon after last execution (${String(timeSinceLastExecution)}ms < 500ms). Skipping.`,
                    );
                    return;
                  }
                }
              }

              // We've passed all checks - this execution can proceed
              // Record the timestamp before executing
              this.lastExecutionTimes.set(eventId, now);
              console.log(
                `[${execId}] Starting execution for event ${String(eventId)} at ${now.toISOString()}`,
              );

              // Execute the event using our managed method
              await this.executeScript(currentScript);
            } catch (error) {
              console.error(
                `[${execId}] Error during execution:`,
                error instanceof Error ? error.message : String(error),
              );
            } finally {
              // Always clear the executing flag when done to prevent stuck jobs
              this.executingEvents.delete(eventId);
              console.log(
                `[${execId}] Cleared executing state for event ${String(eventId)}`,
              );
            }

            // Update next execution time
            try {
              // Use type casting to access the nextInvocation method
              const nextRun = (
                job as unknown as { nextInvocation?: () => Date }
              ).nextInvocation?.();
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
                      err instanceof Error ? err.message : String(err),
                    ),
                  );
              }
            } catch (error) {
              console.error(
                `[${execId}] Error getting next invocation time:`,
                error instanceof Error ? error.message : String(error),
              );
            }
          } catch (error) {
            console.error(
              `[${execId}] Error during scheduled execution:`,
              error instanceof Error ? error.message : String(error),
            );
          }
        })();
      });

      // Final check before storing the job - this is critical to prevent duplicates
      if (this.jobs.has(event.id)) {
        console.log(
          `[${setupId}] Another job was created for event ${String(event.id)} during setup. Cancelling the new job.`,
        );
        job.cancel();
        return;
      }

      // Store job and update next run time
      this.jobs.set(event.id, job);

      // Try to set initial next run time
      try {
        // Use type cast to access the nextInvocation method
        const nextRun = (
          job as unknown as { nextInvocation?: () => Date }
        ).nextInvocation?.();
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
                err instanceof Error ? err.message : String(err),
              );
            });
        }
      } catch (err) {
        console.error(
          `[${setupId}] Error setting initial next run time:`,
          err instanceof Error ? err.message : String(err),
        );
      }

      console.log(
        `[${setupId}] Successfully scheduled event ${String(event.id)}: ${String(event.name ?? "")}`,
      );
    } catch (error) {
      console.error(
        `[${setupId}] Error setting up schedule:`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      // Always clean up the scheduling lock
      this.schedulingInProgress.delete(event.id);
    }
  }

  // Execute a script by creating a job in the queue
  async executeScript(
    event: EventWithRelations,
    inputData?: Record<string, unknown>,
  ) {
    // Create a unique execution ID to help with debugging
    const executionId = `exec-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    console.log(
      `[${executionId}] Creating job for script ${String(event.id)}: ${event.name ?? ""}`,
    );

    try {
      // Import necessary modules
      const { jobService } = await import("@/lib/services/job-service");
      const { JobType, LogStatus } = await import("@/shared/schema");

      // Determine job type based on event type
      const jobTypeMap: Record<string, (typeof JobType)[keyof typeof JobType]> =
        {
          HTTP_REQUEST: JobType.HTTP_REQUEST,
          TOOL_ACTION: JobType.TOOL_ACTION,
        };
      const jobType = jobTypeMap[event.type] ?? JobType.SCRIPT;

      // Create log entry
      const log = await storage.createLog({
        eventId: event.id,
        status: LogStatus.PENDING,
        startTime: new Date(),
        eventName: event.name ?? "Unknown",
        eventType: event.type,
        userId: event.userId,
      });

      // Import job payload builder
      const { buildJobPayload } = await import(
        "@/lib/scheduler/job-payload-builder"
      );

      // Build comprehensive job payload
      const jobPayload = buildJobPayload(event, log.id, inputData);

      // Create job in the queue
      const job = await jobService.createJob({
        eventId: event.id,
        userId: String(event.userId),
        type: jobType,
        payload: jobPayload,
        metadata: {
          eventName: event.name,
          triggeredBy: "schedule",
          logId: log.id,
        },
      });

      // Update log with job ID
      await storage.updateLog(log.id, {
        jobId: job.id,
        status: LogStatus.PENDING,
      });

      console.log(
        `[${executionId}] Created job ${job.id} for script ${String(event.id)}: ${event.name ?? ""}`,
      );

      // Return a result that matches the expected interface
      return {
        success: true,
        output: `Job ${job.id} created and queued for execution`,
      };
    } catch (error) {
      console.error(
        `[${executionId}] Error creating job for script ${String(event.id)}:`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
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
    conditional_event: ConditionalAction,
    event: EventWithRelations,
    isSuccess: boolean,
    executionData?: ExecutionData,
  ) {
    return processEvent(conditional_event, event, isSuccess, executionData);
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
    // Log all arguments to debug
    console.log(`[DEBUG executeEvent] Called with:`, {
      eventId,
      workflowExecutionId,
      _sequenceOrder,
      inputKeys: Object.keys(input),
      workflowId,
      waitForCompletion,
      waitForCompletionType: typeof waitForCompletion,
    });
    const event = (await storage.getEventWithRelations(
      eventId,
    )) as EventWithRelations | null;
    if (!event) throw new Error(`Event with ID ${String(eventId)} not found`);

    console.log(
      `Executing event ${String(eventId)} for workflow execution ${workflowExecutionId ?? "standalone"}`,
    );

    const startTime = Date.now();

    // Import necessary modules
    const { jobService } = await import("@/lib/services/job-service");
    const { JobType, LogStatus } = await import("@/shared/schema");

    // Determine job type based on event type
    const jobTypeMap: Record<string, (typeof JobType)[keyof typeof JobType]> = {
      HTTP_REQUEST: JobType.HTTP_REQUEST,
      TOOL_ACTION: JobType.TOOL_ACTION,
    };
    const jobType = jobTypeMap[event.type] ?? JobType.SCRIPT;

    // Create log entry
    const log = await storage.createLog({
      eventId: event.id,
      workflowId: workflowId,
      status: LogStatus.PENDING,
      startTime: new Date(),
      eventName: event.name ?? "Unknown",
      eventType: event.type,
      userId: event.userId,
    });

    // Import job payload builder
    const { buildJobPayload } = await import(
      "@/lib/scheduler/job-payload-builder"
    );

    // Build comprehensive job payload
    const basePayload = buildJobPayload(event, log.id, input);
    const jobPayload = {
      ...basePayload,
      ...(workflowId !== undefined && { workflowId }),
      ...(workflowExecutionId !== undefined && { workflowExecutionId }),
    };

    // Create job in the queue
    const job = await jobService.createJob({
      eventId: event.id,
      userId: String(event.userId),
      type: jobType,
      payload: jobPayload,
      metadata: {
        eventName: event.name,
        triggeredBy: "workflow",
        logId: log.id,
        workflowId: workflowId,
        workflowExecutionId: workflowExecutionId,
      },
    });

    // Update log with job ID
    await storage.updateLog(log.id, {
      jobId: job.id,
      status: LogStatus.PENDING,
    });

    // If waitForCompletion is true (for workflows), wait for job to complete
    console.log(
      `[DEBUG] executeEvent - waitForCompletion: ${waitForCompletion}, type: ${typeof waitForCompletion}, workflowId: ${workflowId}, job: ${job.id}`,
    );
    console.log(`[DEBUG] executeEvent - All params:`, {
      eventId,
      workflowExecutionId,
      _sequenceOrder,
      workflowId,
      waitForCompletion,
    });

    // Force waiting for workflows by checking workflowId as well
    const shouldWait =
      waitForCompletion === true ||
      (workflowId !== undefined && workflowId !== null);
    console.log(
      `[DEBUG] executeEvent - shouldWait: ${shouldWait} (waitForCompletion=${waitForCompletion}, workflowId=${workflowId})`,
    );

    if (shouldWait) {
      console.log(
        `[DEBUG] executeEvent - Entering wait block for job ${job.id}`,
      );

      const { waitForJobCompletion } = await import(
        "@/lib/services/job-polling-service"
      );

      console.log(
        `Waiting for job ${job.id} to complete for workflow execution...`,
      );

      try {
        // Poll for job completion with appropriate timeout based on event settings
        const timeoutMs = event.timeoutValue
          ? event.timeoutValue *
            ((event.timeoutUnit as string) === "MINUTES"
              ? 60000
              : (event.timeoutUnit as string) === "HOURS"
                ? 3600000
                : (event.timeoutUnit as string) === "DAYS"
                  ? 86400000
                  : 1000)
          : 5 * 60 * 1000; // Default 5 minutes

        const result = await waitForJobCompletion({
          jobId: job.id,
          maxWaitTime: timeoutMs,
          pollInterval: 1000, // Poll every second
        });

        console.log(`Job ${job.id} completed with status: ${result.status}`);

        // Return the full execution result
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

    const duration = Date.now() - startTime;

    // Return immediately with job creation info (for standalone events)
    return {
      success: true,
      output: `Job ${job.id} created and queued for execution`,
      duration,
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

    // Use the same executeScript method which now creates jobs
    return this.executeScript(event);
  }

  // Update an existing script's schedule
  async updateScript(eventId: number) {
    try {
      // Get the current job and cancel it
      if (this.jobs.has(eventId)) {
        console.log(
          `Cancelling job for event ${String(eventId)} during update`,
        );
        this.jobs.get(eventId)?.cancel();
        this.jobs.delete(eventId);
      }

      // Get the script details and check if it's still active
      const event = (await storage.getEventWithRelations(
        eventId,
      )) as EventWithRelations | null;
      if (!event) {
        console.log(`Event ${String(eventId)} not found. Skipping update.`);
        return;
      }

      if (event.status === EventStatus.ACTIVE) {
        console.log(
          `Re-scheduling updated event ${String(eventId)}: ${String(event.name ?? "")}`,
        );
        await this.scheduleScript(event);
      } else {
        console.log(
          `Updated script ${String(eventId)}: ${String(event.name ?? "")} is not active. Skipping scheduling.`,
        );
      }
    } catch (error) {
      console.error(
        `Error updating event ${String(eventId)}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Delete a script's schedule
  async deleteScript(eventId: number) {
    try {
      // Get the current job and cancel it
      if (this.jobs.has(eventId)) {
        console.log(
          `Cancelling job for event ${String(eventId)} during deletion`,
        );
        this.jobs.get(eventId)?.cancel();
        this.jobs.delete(eventId);
      }
    } catch (error) {
      console.error(
        `Error deleting event ${String(eventId)} schedule:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
