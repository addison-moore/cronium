import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { ConditionalActionType, EventStatus, LogStatus } from "@/shared/schema";
import {
  createEventSchema,
  updateEventSchema,
  eventQuerySchema,
  eventIdSchema,
  executeEventSchema,
  eventLogsSchema,
  eventActivationSchema,
  eventDownloadSchema,
} from "@shared/schemas/events";
import { storage } from "@/server/storage";
import { scheduler } from "@/lib/scheduler";

// Custom procedure that handles auth for tRPC fetch adapter
const eventProcedure = publicProcedure.use(async ({ ctx, next }) => {
  // Try to get session from headers/cookies
  let session = null;
  let userId = null;

  try {
    // If session exists in context, use it
    if (ctx.session?.user?.id) {
      session = ctx.session;
      userId = ctx.session.user.id;
    } else {
      // For development, get first admin user
      if (process.env.NODE_ENV === "development") {
        const allUsers = await storage.getAllUsers();
        const adminUsers = allUsers.filter((user) => user.role === "ADMIN");
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
        session,
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
    .input(eventQuerySchema)
    .query(async ({ ctx, input }) => {
      try {
        const events = await storage.getAllEvents(ctx.userId);

        // Apply filters
        let filteredEvents = events;

        if (input.search) {
          const searchLower = input.search.toLowerCase();
          filteredEvents = filteredEvents.filter(
            (event) =>
              event.name.toLowerCase().includes(searchLower) ||
              event.description?.toLowerCase().includes(searchLower),
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
    try {
      // Check permissions
      const canView = await storage.canViewEvent(input.id, ctx.userId);
      if (!canView) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }

      const event = await storage.getEventWithRelations(input.id);
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }

      return event;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch event",
        cause: error,
      });
    }
  }),

  // Create new event
  create: eventProcedure
    .input(createEventSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Add user ID to event data
        const eventData = {
          ...input,
          userId: ctx.userId,
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
          input.runLocation === "REMOTE" &&
          input.selectedServerIds.length > 0
        ) {
          await storage.setEventServers(event.id, input.selectedServerIds);
        }

        // Handle conditional actions - Fixed to use proper storage methods and data structure
        if (input.onSuccessActions && input.onSuccessActions.length > 0) {
          for (const conditionalAction of input.onSuccessActions) {
            await storage.createAction({
              type: conditionalAction.action as ConditionalActionType, // Use action, not type
              successEventId: event.id, // Link to parent event
              targetEventId: conditionalAction.details?.targetEventId || null,
              toolId: conditionalAction.details?.toolId || null,
              message: conditionalAction.details?.message || "",
              emailAddresses: conditionalAction.details?.emailAddresses || "",
              emailSubject: conditionalAction.details?.emailSubject || "",
            });
          }
        }

        if (input.onFailActions && input.onFailActions.length > 0) {
          for (const conditionalAction of input.onFailActions) {
            await storage.createAction({
              type: conditionalAction.action as ConditionalActionType, // Use action, not type
              failEventId: event.id, // Link to parent event
              targetEventId: conditionalAction.details?.targetEventId || null,
              toolId: conditionalAction.details?.toolId || null,
              message: conditionalAction.details?.message || "",
              emailAddresses: conditionalAction.details?.emailAddresses || "",
              emailSubject: conditionalAction.details?.emailSubject || "",
            });
          }
        }

        // Get the complete event with relations
        const completeEvent = await storage.getEventWithRelations(event.id);
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
    .input(updateEventSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, ctx.userId);
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
          // Delete existing conditional actions
          await storage.deleteActionsByEventId(id);

          // Create new success events
          if (onSuccessActions && onSuccessActions.length > 0) {
            for (const conditionalAction of onSuccessActions) {
              await storage.createAction({
                type: conditionalAction.action as ConditionalActionType, // Use action, not type
                successEventId: id, // Link to parent event
                targetEventId: conditionalAction.details?.targetEventId || null,
                toolId: conditionalAction.details?.toolId || null,
                message: conditionalAction.details?.message || "",
                emailAddresses: conditionalAction.details?.emailAddresses || "",
                emailSubject: conditionalAction.details?.emailSubject || "",
              });
            }
          }

          // Create new failure events
          if (onFailActions && onFailActions.length > 0) {
            for (const conditionalAction of onFailActions) {
              await storage.createAction({
                type: conditionalAction.action as ConditionalActionType, // Use action, not type
                failEventId: id, // Link to parent event
                targetEventId: conditionalAction.details?.targetEventId || null,
                toolId: conditionalAction.details?.toolId || null,
                message: conditionalAction.details?.message || "",
                emailAddresses: conditionalAction.details?.emailAddresses || "",
                emailSubject: conditionalAction.details?.emailSubject || "",
              });
            }
          }
        }

        // Get the updated event with relations
        const updatedEvent = await storage.getEventWithRelations(id);
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
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, ctx.userId);
        if (!canEdit) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to delete this event",
          });
        }

        await storage.deleteScript(input.id);
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
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, ctx.userId);
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
        const event = await storage.getEvent(input.id);
        if (event) {
          await scheduler.scheduleScript(event);
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
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, ctx.userId);
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
    .input(executeEventSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check permissions
        const canView = await storage.canViewEvent(input.id, ctx.userId);
        if (!canView) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        const event = await storage.getEvent(input.id);
        if (!event) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        // Create log entry
        const log = await storage.createLog({
          eventId: input.id,
          status: LogStatus.RUNNING,
          startTime: new Date(),
          eventName: event.name,
          scriptType: event.type,
          userId: ctx.userId,
        });

        // Add existing logId to event object to prevent duplicate log creation
        const eventWithLogId = {
          ...event,
          existingLogId: log.id,
        };

        // Execute the event asynchronously
        scheduler.executeScript(eventWithLogId);

        return { success: true, logId: log.id };
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
      try {
        // Check permissions
        const canView = await storage.canViewEvent(input.id, ctx.userId);
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
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, ctx.userId);
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
      try {
        // Check permissions
        const canView = await storage.canViewEvent(input.id, ctx.userId);
        if (!canView) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        const workflows = await storage.getWorkflowsUsingEvent(
          input.id,
          ctx.userId,
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
      try {
        // Check permissions for all events
        const userEvents = await storage.getAllEvents(ctx.userId);
        const userEventIds = userEvents.map((e: any) => e.id);
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
            return {
              format: "json",
              filename: `${event.name}.json`,
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
