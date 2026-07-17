/**
 * Events Router
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
import type { ScriptType } from "@/shared/schema";
import {
  createEventSchema,
  updateEventSchema,
  eventQuerySchema,
  eventIdSchema,
  executeEventSchema,
  eventLogsSchema,
  eventActivationSchema,
  eventDownloadSchema,
  eventFilterSchema,
} from "@/shared/schemas/events";
import { storage } from "@/server/storage";
import { scheduler } from "@/lib/scheduler";
import { payloadService } from "@/lib/services/payload-service";

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
        const result = await storage.queryEvents(userId, input);

        return {
          events: result.items,
          total: result.total,
          hasMore: result.hasMore,
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

        // Handle server associations for remote execution (REMOTE or
        // LOCAL_AND_REMOTE)
        if (
          input.runLocation !== RunLocation.LOCAL &&
          input.selectedServerIds.length > 0
        ) {
          await storage.setEventServers(event.id, input.selectedServerIds);
        }

        // Payload generation moved to orchestrator
        // The orchestrator will create payloads from job script content

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

        const { id, envVars, selectedServerIds, ...eventData } = input;

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

        // Get the updated event with relations
        const updatedEvent = await storage.getEventWithRelations(id);

        // Re-sync the in-memory schedule when status or schedule fields
        // changed (updateScript cancels the old job and re-schedules only
        // if the event is ACTIVE)
        if (
          input.status !== undefined ||
          input.scheduleNumber !== undefined ||
          input.scheduleUnit !== undefined ||
          input.customSchedule !== undefined ||
          input.startTime !== undefined
        ) {
          await scheduler.updateScript(id);
        }

        // Payload generation moved to orchestrator
        // The orchestrator will create payloads from job script content
        // Clean up old payloads if they exist
        if (
          updatedEvent &&
          updatedEvent.runLocation !== RunLocation.LOCAL &&
          (input.content !== undefined || input.envVars !== undefined)
        ) {
          try {
            // Just clean up old payloads without generating new ones
            await payloadService.removeOldPayloads(id, 0); // Remove all payloads
          } catch {
            // Ignore cleanup errors
          }
        }

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

        // Clean up payloads before deleting the event
        await payloadService.cleanupEventPayloads(input.id);

        // Cancel the in-memory scheduled job before removing the event
        await scheduler.deleteScript(input.id);

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

        // Cancel the in-memory scheduled job so paused events stop firing
        await scheduler.deleteScript(input.id);

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
        const { buildJobPayload } =
          await import("@/lib/scheduler/job-payload-builder");

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

        // Payload generation moved to orchestrator
        // No need to get payload path - orchestrator creates payloads on-demand

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

        // Tool actions run in-process (the orchestrator only runs container/ssh
        // scripts). Fire-and-forget: the runner finalizes the job/log itself and
        // the UI polls the log for the result.
        const { isInProcessJobType, runInProcessJob } =
          await import("@/lib/scheduler/in-process-executor");
        if (isInProcessJobType(jobType)) {
          void runInProcessJob(
            job,
            event,
            (input as { input?: Record<string, unknown> }).input,
          );
        }

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
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to download events",
          cause: error,
        });
      }
    }),

  // Fork event (duplicate shared event without conditional actions)
  fork: protectedProcedure
    .use(withTiming)
    .use(withRateLimit(50, 60000)) // 50 forks per minute
    .use(withTransaction)
    .input(eventIdSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session?.user?.id) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not authenticated",
        });
      }
      const userId = ctx.session.user.id;

      try {
        // Check if the user can view the event (includes shared events)
        const canView = await storage.canViewEvent(input.id, userId);
        if (!canView) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        // Get the original event with all its data
        const originalEvent = await storage.getEventWithRelations(input.id);
        if (!originalEvent) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        // Create forked event data
        const forkedEventData = {
          name: `${originalEvent.name} (fork)`,
          type: originalEvent.type,
          description: originalEvent.description,
          content: originalEvent.content,
          status: EventStatus.DRAFT,
          shared: false, // Forked events are not shared by default
          tags: (originalEvent.tags as string[]) ?? [],
          httpMethod: originalEvent.httpMethod,
          httpUrl: originalEvent.httpUrl,
          httpHeaders:
            (originalEvent.httpHeaders as Array<{
              key: string;
              value: string;
            }>) ?? [],
          httpBody: originalEvent.httpBody,
          scheduleNumber: originalEvent.scheduleNumber,
          scheduleUnit: originalEvent.scheduleUnit,
          customSchedule: originalEvent.customSchedule,
          runLocation: originalEvent.runLocation,
          serverId: originalEvent.serverId,
          timeoutValue: originalEvent.timeoutValue,
          timeoutUnit: originalEvent.timeoutUnit,
          retries: originalEvent.retries,
          userId: userId, // Set the current user as the owner
          startTime: originalEvent.startTime,
        };

        // Create the forked event
        const forkedEvent = await storage.createScript(forkedEventData);

        // Copy environment variables
        if (originalEvent.envVars && originalEvent.envVars.length > 0) {
          for (const envVar of originalEvent.envVars) {
            await storage.createEnvVar({
              eventId: forkedEvent.id,
              key: envVar.key,
              value: envVar.value,
            });
          }
        }

        // Copy server associations
        const servers = originalEvent.servers;
        if (servers && Array.isArray(servers) && servers.length > 0) {
          const serverIds: number[] = [];
          for (const server of servers) {
            if (
              server &&
              typeof server === "object" &&
              "id" in server &&
              typeof server.id === "number"
            ) {
              serverIds.push(server.id);
            }
          }
          if (serverIds.length > 0) {
            await storage.setEventServers(forkedEvent.id, serverIds);
          }
        }

        // Note: We intentionally do NOT copy conditional actions (successEvents, failEvents, etc.)
        // as per the requirement

        // Get the complete forked event with relations
        const completeForkedEvent = await storage.getEventWithRelations(
          forkedEvent.id,
        );

        return completeForkedEvent;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fork event",
          cause: error,
        });
      }
    }),

  // Get lightweight event data for filters/dropdowns
  getForFilters: protectedProcedure
    .use(withTiming)
    .input(eventFilterSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      try {
        // Get all events for the user with minimal data
        const events = await storage.getAllEvents(userId);

        // Apply filters if provided
        let filteredEvents = events;

        if (input.search) {
          const searchLower = input.search.toLowerCase();
          filteredEvents = filteredEvents.filter((event) =>
            event.name.toLowerCase().includes(searchLower),
          );
        }

        if (input.status) {
          filteredEvents = filteredEvents.filter(
            (event) => event.status === input.status,
          );
        }

        // Apply pagination
        const start = input.offset;
        const end = start + input.limit;
        const paginatedEvents = filteredEvents.slice(start, end);

        // Return only id and name for each event
        const lightweightEvents = paginatedEvents.map((event) => ({
          id: event.id,
          name: event.name,
        }));

        return {
          events: lightweightEvents,
          total: filteredEvents.length,
          hasMore: end < filteredEvents.length,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch events for filters",
          cause: error,
        });
      }
    }),
});
