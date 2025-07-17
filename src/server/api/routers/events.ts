/**
 * Events Router
 *
 * Note: This router does NOT use caching for any operations.
 * As a CRUD-heavy application with real-time monitoring requirements,
 * caching was removed to ensure users always see the latest data.
 *
 * Previous issues with cache invalidation:
 * - Users saw stale event names after updates
 * - Event status changes weren't reflected immediately
 * - Only 9.5% of routers had proper cache invalidation
 *
 * Current approach: All queries fetch fresh data directly from storage.
 * For more details, see /docs/CACHING_STRATEGY.md
 */

import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  withTiming,
  withRateLimit,
  withTransaction,
} from "../trpc";
import { EventStatus, LogStatus, RunLocation } from "@/shared/schema";
import type { ConditionalActionType, ScriptType } from "@/shared/schema";
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

// Use the centralized development-friendly protected procedure
// This handles authentication and auto-login in development mode

export const eventsRouter = createTRPCRouter({
  // Get all events for user
  getAll: protectedProcedure
    .use(withTiming)
    .input(eventQuerySchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        // Direct storage call without caching
        const events = await storage.getAllEvents(userId);

        // Apply filters
        let filteredEvents = events;

        if (input.search) {
          const searchLower = input.search.toLowerCase();
          filteredEvents = filteredEvents.filter(
            (event) =>
              (event.name?.toLowerCase().includes(searchLower) ?? false) ||
              (event.description?.toLowerCase().includes(searchLower) ?? false),
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
  getById: protectedProcedure
    .input(eventIdSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        // Check permissions first (not cached)
        const canView = await storage.canViewEvent(input.id, userId);
        if (!canView) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        // Direct storage call without caching
        const event = await storage.getEventWithRelations(input.id);
        if (!event) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }
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
  create: protectedProcedure
    .use(withTiming)
    .use(withRateLimit(50, 60000)) // 50 creates per minute
    .use(withTransaction)
    .input(createEventSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session?.user?.id) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not authenticated",
        });
      }
      const userId = ctx.session.user.id;
      try {
        // Add user ID to event data
        const eventData = {
          ...input,
          userId: userId,
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
          allConditionalActions.map((action) => {
            const mappedAction: {
              action: string;
              details?: { targetEventId?: number };
            } = {
              action: action.action,
            };
            if (
              action.details?.targetEventId !== undefined &&
              action.details.targetEventId !== null
            ) {
              mappedAction.details = {
                targetEventId: action.details.targetEventId,
              };
            }
            return mappedAction;
          }),
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
  update: protectedProcedure
    .use(withTiming)
    .use(withRateLimit(100, 60000)) // 100 updates per minute
    .use(withTransaction)
    .input(updateEventSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session?.user?.id) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not authenticated",
        });
      }
      const userId = ctx.session.user.id;
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, userId);
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
            allConditionalActions.map((action) => {
              const mappedAction: {
                action: string;
                details?: { targetEventId?: number };
              } = {
                action: action.action,
              };
              if (
                action.details?.targetEventId !== undefined &&
                action.details.targetEventId !== null
              ) {
                mappedAction.details = {
                  targetEventId: action.details.targetEventId,
                };
              }
              return mappedAction;
            }),
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
  delete: protectedProcedure
    .input(eventIdSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, userId);
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
  activate: protectedProcedure
    .input(eventActivationSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, userId);
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
  deactivate: protectedProcedure
    .input(eventIdSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, userId);
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
  execute: protectedProcedure
    .use(withTiming)
    .use(withRateLimit(50, 60000)) // 50 executions per minute
    .input(executeEventSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session?.user?.id) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not authenticated",
        });
      }
      const userId = ctx.session.user.id;
      try {
        // Check permissions
        const canView = await storage.canViewEvent(input.id, userId);
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
          userId: userId,
        });

        // Import job payload builder
        const { buildJobPayload } = await import(
          "@/lib/scheduler/job-payload-builder"
        );

        // Build comprehensive job payload
        const jobPayload = buildJobPayload(
          event,
          log.id,
          (input as { input?: Record<string, unknown> }).input,
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
          userId: String(userId),
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
  getLogs: protectedProcedure
    .input(eventLogsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        // Check permissions
        const canView = await storage.canViewEvent(input.id, userId);
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
  resetCounter: protectedProcedure
    .input(eventIdSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        // Check permissions
        const canEdit = await storage.canEditEvent(input.id, userId);
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
  getWorkflows: protectedProcedure
    .input(eventIdSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        // Check permissions
        const canView = await storage.canViewEvent(input.id, userId);
        if (!canView) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        const workflows = await storage.getWorkflowsUsingEvent(
          input.id,
          userId,
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
  download: protectedProcedure
    .input(eventDownloadSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        // Check permissions for all events
        const userEvents = await storage.getAllEvents(userId);
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
