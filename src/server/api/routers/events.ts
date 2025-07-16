import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  publicProcedure,
  withTiming,
  withRateLimit,
  withCache,
  withTransaction,
} from "../trpc";
import { EventStatus, LogStatus, UserRole, RunLocation } from "@/shared/schema";
import type { ConditionalActionType } from "@/shared/schema";
import { validateConditionalActions } from "@/server/utils/event-validation";
import {
  createEventSchema,
  updateEventSchema,
  eventQuerySchema,
  eventIdSchema,
  executeEventSchema,
  eventLogsSchema,
  eventActivationSchema,
  eventDownloadSchema,
} from "@/shared/schemas/events";
import { storage } from "@/server/storage";
import { scheduler } from "@/lib/scheduler";
import { cachedQueries, cacheInvalidation } from "../middleware/cache";

// Type for authenticated event context
interface EventContext {
  userId: string;
}

// Type guard for checking if user id exists in session
function hasUserId(
  session: { user?: { id?: string | null } } | null,
): session is { user: { id: string } } {
  return (
    session?.user?.id !== null &&
    session?.user?.id !== undefined &&
    typeof session.user.id === "string" &&
    session.user.id.length > 0
  );
}

// Custom procedure that handles auth for tRPC fetch adapter
const eventProcedure = publicProcedure.use(async ({ ctx, next }) => {
  // Try to get session from headers/cookies
  let session: { user: { id: string } } | null = null;
  let userId: string | null = null;

  try {
    // If session exists in context, use it
    if (hasUserId(ctx.session as { user?: { id?: string | null } } | null)) {
      session = ctx.session as unknown as { user: { id: string } };
      userId = session.user.id;
    } else {
      // For development, get first admin user
      if (process.env.NODE_ENV === "development") {
        const allUsers = await storage.getAllUsers();
        const adminUsers = allUsers.filter(
          (user) => user.role === UserRole.ADMIN,
        );
        const firstAdmin = adminUsers[0];
        if (firstAdmin) {
          userId = firstAdmin.id;
          session = { user: { id: firstAdmin.id } };
        }
      }
    }

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    return next({
      ctx: {
        ...ctx,
        session: session as typeof ctx.session,
        userId,
      },
    });
  } catch (error) {
    console.error("Auth error in eventProcedure:", error);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication failed",
    });
  }
});

export const eventsRouter = createTRPCRouter({
  // Get all events for user
  getAll: eventProcedure
    .use(withTiming)
    .input(eventQuerySchema)
    .query(async ({ ctx, input }) => {
      const eventCtx = ctx as EventContext;
      try {
        // Use cached query wrapper for event lists
        const result = await cachedQueries.eventList(
          input,
          eventCtx.userId,
          async () => {
            const events = await storage.getAllEvents(eventCtx.userId);

            // Apply filters
            let filteredEvents = events;

            if (input.search) {
              const searchLower = input.search.toLowerCase();
              filteredEvents = filteredEvents.filter(
                (event) =>
                  (event.name?.toLowerCase().includes(searchLower) ?? false) ||
                  (event.description?.toLowerCase().includes(searchLower) ??
                    false),
              );
            }

            if (input.status) {
              filteredEvents = filteredEvents.filter(
                (event) => event.status === input.status,
              );
            }

            if (input.type) {
              filteredEvents = filteredEvents.filter(
                (event) => event.type === input.type,
              );
            }

            if (input.shared !== undefined) {
              filteredEvents = filteredEvents.filter(
                (event) => event.shared === input.shared,
              );
            }

            // Apply pagination
            const paginatedEvents = filteredEvents.slice(
              input.offset,
              input.offset + input.limit,
            );

            return {
              events: paginatedEvents,
              total: filteredEvents.length,
              hasMore: input.offset + input.limit < filteredEvents.length,
            };
          },
        );

        return result;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch events",
          cause: error,
        });
      }
    }),

  // Get single event by ID
  getById: eventProcedure.input(eventIdSchema).query(async ({ ctx, input }) => {
    const eventCtx = ctx as EventContext;
    try {
      // Check permissions first (not cached)
      const canView = await storage.canViewEvent(input.id, eventCtx.userId);
      if (!canView) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Event not found",
        });
      }

      // Use cached query wrapper for individual events
      const event = await cachedQueries.eventById(
        { id: input.id },
        eventCtx.userId,
        async () => {
          const event = await storage.getEventWithRelations(input.id);
          if (!event) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Event not found",
            });
          }
          return event;
        },
      );

      return event;
    } catch (error) {
      if (error instanceof TRPCError) throw error;

      console.error("Error in events.getById:", error);

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch event",
        cause: error,
      });
    }
  }),

  // Create new event
  create: eventProcedure
    .use(withTiming)
    .use(withRateLimit(50, 60000)) // 50 creates per minute
    .use(withTransaction)
    .input(createEventSchema)
    .mutation(async ({ ctx, input }) => {
      const eventCtx = ctx as EventContext;
      try {
        // Add user ID to event data
        const eventData = {
          ...input,
          userId: eventCtx.userId,
          startTime: input.startTime ? new Date(input.startTime) : null,
        };

        // Create the event
        const event = await storage.createScript(eventData);

        // Handle environment variables
        if (input.envVars && input.envVars.length > 0) {
          for (const envVar of input.envVars) {
            await storage.createEnvVar({
              eventId: event.id,
              key: envVar.key,
              value: envVar.value,
            });
          }
        }

        // Handle server associations for remote execution
        if (
          input.runLocation === RunLocation.REMOTE &&
          input.selectedServerIds.length > 0
        ) {
          await storage.setEventServers(event.id, input.selectedServerIds);
        }

        // Validate conditional actions before creating them
        const allConditionalActions = [
          ...(input.onSuccessActions ?? []),
          ...(input.onFailActions ?? []),
        ];

        const validationErrors = await validateConditionalActions(
          event.id,
          allConditionalActions,
        );

        if (validationErrors.length > 0) {
          // Rollback the event creation by deleting it
          await storage.deleteScript(event.id);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: validationErrors.join(" "),
          });
        }

        // Handle conditional actions - Fixed to use proper storage methods and data structure
        if (input.onSuccessActions && input.onSuccessActions.length > 0) {
          for (const conditionalAction of input.onSuccessActions) {
            await storage.createAction({
              type: conditionalAction.action as ConditionalActionType, // Use action, not type
              successEventId: event.id, // Link to parent event
              targetEventId: conditionalAction.details?.targetEventId ?? null,
              toolId: conditionalAction.details?.toolId ?? null,
              message: conditionalAction.details?.message ?? "",
              emailAddresses: conditionalAction.details?.emailAddresses ?? "",
              emailSubject: conditionalAction.details?.emailSubject ?? "",
            });
          }
        }

        if (input.onFailActions && input.onFailActions.length > 0) {
          for (const conditionalAction of input.onFailActions) {
            await storage.createAction({
              type: conditionalAction.action as ConditionalActionType, // Use action, not type
              failEventId: event.id, // Link to parent event
              targetEventId: conditionalAction.details?.targetEventId ?? null,
              toolId: conditionalAction.details?.toolId ?? null,
              message: conditionalAction.details?.message ?? "",
              emailAddresses: conditionalAction.details?.emailAddresses ?? "",
              emailSubject: conditionalAction.details?.emailSubject ?? "",
            });
          }
        }

        // Get the complete event with relations
        const completeEvent = await storage.getEventWithRelations(event.id);

        // Invalidate caches
        await cacheInvalidation.invalidateEvent(event.id, eventCtx.userId);

        return completeEvent;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create event",
          cause: error,
        });
      }
    }),

  // Update existing event
  update: eventProcedure
    .use(withTiming)
    .use(withRateLimit(100, 60000)) // 100 updates per minute
    .use(withTransaction)
    .input(updateEventSchema)
    .mutation(async ({ ctx, input }) => {
      const eventCtx = ctx as EventContext;
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, eventCtx.userId);
        if (!canEdit) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to edit this event",
          });
        }

        const {
          id,
          envVars,
          onSuccessActions,
          onFailActions,
          selectedServerIds,
          ...eventData
        } = input;

        // Update the event
        if (Object.keys(eventData).length > 0) {
          // Filter out undefined values to satisfy exactOptionalPropertyTypes
          const filteredEventData = Object.fromEntries(
            Object.entries(eventData).filter(
              ([, value]) => value !== undefined,
            ),
          );

          const updateData = {
            ...filteredEventData,
            ...(eventData.startTime && {
              startTime: new Date(eventData.startTime),
            }),
          };
          await storage.updateScript(id, updateData);
        }

        // Handle environment variables
        if (envVars !== undefined) {
          // Delete existing env vars
          await storage.deleteEnvVarsByEventId(id);

          // Create new env vars
          if (envVars.length > 0) {
            for (const envVar of envVars) {
              await storage.createEnvVar({
                eventId: id,
                key: envVar.key,
                value: envVar.value,
              });
            }
          }
        }

        // Handle server associations
        if (selectedServerIds !== undefined) {
          await storage.setEventServers(id, selectedServerIds);
        }

        // Handle conditional actions - Fixed to use proper storage methods and data structure
        if (onSuccessActions !== undefined || onFailActions !== undefined) {
          // Validate conditional actions before updating
          const allConditionalActions = [
            ...(onSuccessActions ?? []),
            ...(onFailActions ?? []),
          ];

          const validationErrors = await validateConditionalActions(
            id,
            allConditionalActions,
          );

          if (validationErrors.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: validationErrors.join(" "),
            });
          }

          // Delete existing conditional actions
          await storage.deleteActionsByEventId(id);

          // Create new success events
          if (onSuccessActions && onSuccessActions.length > 0) {
            for (const conditionalAction of onSuccessActions) {
              await storage.createAction({
                type: conditionalAction.action as ConditionalActionType, // Use action, not type
                successEventId: id, // Link to parent event
                targetEventId: conditionalAction.details?.targetEventId ?? null,
                toolId: conditionalAction.details?.toolId ?? null,
                message: conditionalAction.details?.message ?? "",
                emailAddresses: conditionalAction.details?.emailAddresses ?? "",
                emailSubject: conditionalAction.details?.emailSubject ?? "",
              });
            }
          }

          // Create new failure events
          if (onFailActions && onFailActions.length > 0) {
            for (const conditionalAction of onFailActions) {
              await storage.createAction({
                type: conditionalAction.action as ConditionalActionType, // Use action, not type
                failEventId: id, // Link to parent event
                targetEventId: conditionalAction.details?.targetEventId ?? null,
                toolId: conditionalAction.details?.toolId ?? null,
                message: conditionalAction.details?.message ?? "",
                emailAddresses: conditionalAction.details?.emailAddresses ?? "",
                emailSubject: conditionalAction.details?.emailSubject ?? "",
              });
            }
          }
        }

        // Get the updated event with relations
        const updatedEvent = await storage.getEventWithRelations(id);

        // Invalidate caches
        await cacheInvalidation.invalidateEvent(id, eventCtx.userId);

        return updatedEvent;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update event",
          cause: error,
        });
      }
    }),

  // Delete event
  delete: eventProcedure
    .input(eventIdSchema)
    .mutation(async ({ ctx, input }) => {
      const eventCtx = ctx as EventContext;
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, eventCtx.userId);
        if (!canEdit) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to delete this event",
          });
        }

        await storage.deleteScript(input.id);

        // Invalidate caches
        await cacheInvalidation.invalidateEvent(input.id, eventCtx.userId);

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete event",
          cause: error,
        });
      }
    }),

  // Activate event
  activate: eventProcedure
    .input(eventActivationSchema)
    .mutation(async ({ ctx, input }) => {
      const eventCtx = ctx as EventContext;
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, eventCtx.userId);
        if (!canEdit) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to activate this event",
          });
        }

        // Update event status to ACTIVE
        await storage.updateScript(input.id, { status: EventStatus.ACTIVE });

        // Reset counter if requested
        if (input.resetCounter) {
          await storage.updateScript(input.id, { executionCount: 0 });
        }

        // Schedule the event
        const event = await storage.getEventWithRelations(input.id);
        if (event) {
          // Apply type assertion to ensure tags is properly typed as string[]
          const eventWithTypedTags = {
            ...event,
            tags: event.tags as string[],
          };
          await scheduler.scheduleScript(eventWithTypedTags);
        }

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to activate event",
          cause: error,
        });
      }
    }),

  // Deactivate event
  deactivate: eventProcedure
    .input(eventIdSchema)
    .mutation(async ({ ctx, input }) => {
      const eventCtx = ctx as EventContext;
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, eventCtx.userId);
        if (!canEdit) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to deactivate this event",
          });
        }

        // Update event status to PAUSED
        await storage.updateScript(input.id, { status: EventStatus.PAUSED });

        // TODO: Implement unschedule functionality
        // await scheduler.unscheduleScript(input.id);

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to deactivate event",
          cause: error,
        });
      }
    }),

  // Execute event
  execute: eventProcedure
    .use(withTiming)
    .use(withRateLimit(50, 60000)) // 50 executions per minute
    .input(executeEventSchema)
    .mutation(async ({ ctx, input }) => {
      const eventCtx = ctx as EventContext;
      try {
        // Check permissions
        const canView = await storage.canViewEvent(input.id, eventCtx.userId);
        if (!canView) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        const event = await storage.getEventWithRelations(input.id);
        if (!event) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        // Import job service
        const { jobService } = await import("@/lib/services/job-service");
        const { JobType } = await import("@/shared/schema");

        // Determine job type based on event type
        const jobTypeMap: Record<
          string,
          (typeof JobType)[keyof typeof JobType]
        > = {
          HTTP_REQUEST: JobType.HTTP_REQUEST,
          TOOL_ACTION: JobType.TOOL_ACTION,
        };
        const jobType = jobTypeMap[event.type] ?? JobType.SCRIPT;

        // Create log entry
        const log = await storage.createLog({
          eventId: input.id,
          status: LogStatus.PENDING,
          startTime: new Date(),
          eventName: event.name ?? "Unknown",
          eventType: event.type,
          userId: eventCtx.userId as number,
        });

        // Import job payload builder
        const { buildJobPayload } = await import(
          "@/lib/scheduler/job-payload-builder"
        );

        // Build comprehensive job payload
        const jobPayload = buildJobPayload(
          event,
          log.id,
          input.input as Record<string, unknown> | undefined,
        ) as {
          script?: {
            type: ScriptType;
            content: string;
          };
          httpRequest?: {
            method: string;
            url: string;
            headers?: Record<string, string>;
            body?: string;
          };
          toolAction?: {
            toolType: string;
            config: Record<string, unknown>;
          };
          environment?: Record<string, string>;
          target?: {
            serverId?: number;
            containerImage?: string;
          };
          input?: Record<string, unknown>;
          workflowId?: number;
          executionLogId?: number;
          timeout?: {
            value: number;
            unit: string;
          };
          retries?: number;
        };

        // Create job in the queue
        const job = await jobService.createJob({
          eventId: input.id,
          userId: String(eventCtx.userId),
          type: jobType,
          payload: jobPayload,
          metadata: {
            eventName: event.name,
            triggeredBy: "manual",
            logId: log.id,
          },
        });

        // Update log with job ID
        await storage.updateLog(log.id, {
          jobId: job.id,
          status: LogStatus.PENDING,
        });

        return { success: true, logId: log.id, jobId: job.id };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to execute event",
          cause: error,
        });
      }
    }),

  // Get event logs
  getLogs: eventProcedure
    .input(eventLogsSchema)
    .query(async ({ ctx, input }) => {
      const eventCtx = ctx as EventContext;
      try {
        // Check permissions
        const canView = await storage.canViewEvent(input.id, eventCtx.userId);
        if (!canView) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        const logsResult = await storage.getLogsByEventId(input.id, {
          limit: input.limit,
          offset: input.offset,
        });

        // Ensure we're working with an array of logs
        const logsArray = Array.isArray(logsResult.logs) ? logsResult.logs : [];
        const total = logsResult.total || logsArray.length;

        return {
          logs: logsArray,
          total,
          hasMore: logsArray.length === input.limit,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch event logs",
          cause: error,
        });
      }
    }),

  // Reset execution counter
  resetCounter: eventProcedure
    .input(eventIdSchema)
    .mutation(async ({ ctx, input }) => {
      const eventCtx = ctx as EventContext;
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, eventCtx.userId);
        if (!canEdit) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to reset counter for this event",
          });
        }

        await storage.updateScript(input.id, { executionCount: 0 });
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to reset execution counter",
          cause: error,
        });
      }
    }),

  // Get workflows containing this event
  getWorkflows: eventProcedure
    .input(eventIdSchema)
    .query(async ({ ctx, input }) => {
      const eventCtx = ctx as EventContext;
      try {
        // Check permissions
        const canView = await storage.canViewEvent(input.id, eventCtx.userId);
        if (!canView) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        const workflows = await storage.getWorkflowsUsingEvent(
          input.id,
          eventCtx.userId,
        );
        return workflows;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch event workflows",
          cause: error,
        });
      }
    }),

  // Download events (JSON or ZIP)
  download: eventProcedure
    .input(eventDownloadSchema)
    .mutation(async ({ ctx, input }) => {
      const eventCtx = ctx as EventContext;
      try {
        // Check permissions for all events
        const userEvents = await storage.getAllEvents(eventCtx.userId);
        const userEventIds = userEvents.map((e) => e.id);
        const allowedEventIds = input.eventIds.filter((id) =>
          userEventIds.includes(id),
        );

        if (allowedEventIds.length === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No authorized events found",
          });
        }

        if (input.format === "json") {
          // Single event JSON download
          if (allowedEventIds.length === 1) {
            const eventId = allowedEventIds[0];
            if (!eventId) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Invalid event ID",
              });
            }
            const event = await storage.getEventWithRelations(eventId);
            if (!event) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Event not found",
              });
            }
            return {
              format: "json",
              filename: `${String(event.name ?? "event")}.json`,
              data: JSON.stringify(event, null, 2),
            };
          }

          // Multiple events JSON download
          const events = await Promise.all(
            allowedEventIds.map((id) => storage.getEventWithRelations(id)),
          );
          return {
            format: "json",
            filename: "events.json",
            data: JSON.stringify(events, null, 2),
          };
        } else {
          // ZIP download
          throw new TRPCError({
            code: "NOT_IMPLEMENTED",
            message: "ZIP download not implemented in tRPC - use REST endpoint",
          });
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to download events",
          cause: error,
        });
      }
    }),
});
