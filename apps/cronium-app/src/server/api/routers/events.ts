/**
 * Events Router
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  withTiming,
  withRateLimit,
  withTransaction,
} from "../trpc";
import { EventStatus, RunLocation } from "@/shared/schema";
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
import {
  assertEventCapability,
  assertEventRelations,
  assertProposedEventServers,
} from "@/server/security/resource-access";
import {
  toEventApiDto,
  toEventForkSecurityProjection,
  toEventListApiDto,
} from "@/server/security/api-dto";

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
          events: result.items.map((event) => toEventListApiDto(event, userId)),
          total: result.total,
          hasMore: result.hasMore,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
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
        await assertEventRelations(input.id, userId, "view");

        // Direct storage call without caching
        const event = await storage.getEventWithRelations(input.id);
        if (!event) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }
        return toEventApiDto(event, userId);
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
        await assertProposedEventServers(
          userId,
          input.serverId,
          input.selectedServerIds,
        );
        // Add user ID to event data
        const eventData = {
          ...input,
          userId: userId,
          startTime: input.startTime ? new Date(input.startTime) : null,
          // Provenance (e.g. "mcp") for events created by an AI agent.
          source: ctx.requestSource ?? null,
        };

        // Create the event
        const event = await storage.createScript(eventData);

        if (ctx.requestSource === "mcp") {
          console.log(
            `[MCP-AUDIT] user=${userId} created event #${event.id} "${event.name}" (${event.type}) via mcp`,
          );
        }

        // Materialize the durable schedule — an event created directly as
        // ACTIVE + SCHEDULE starts firing without needing a separate edit
        // (scheduling review M6)
        await scheduler.updateScript(event.id);

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
          await storage.setEventServers(
            event.id,
            input.selectedServerIds,
            userId,
          );
        }

        // Payload generation moved to orchestrator
        // The orchestrator will create payloads from job script content

        // Get the complete event with relations
        const completeEvent = await storage.getEventWithRelations(event.id);

        return completeEvent ? toEventApiDto(completeEvent, userId) : undefined;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
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
        await assertEventCapability(input.id, userId, "edit");
        await assertProposedEventServers(
          userId,
          input.serverId,
          input.selectedServerIds,
        );

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
          await storage.setEventServers(id, selectedServerIds, userId);
        }

        // Get the updated event with relations
        const updatedEvent = await storage.getEventWithRelations(id);

        // Re-sync the in-memory schedule when status or schedule fields
        // changed (updateScript cancels the old job and re-schedules only
        // if the event is ACTIVE)
        if (
          input.status !== undefined ||
          input.triggerType !== undefined ||
          input.scheduleNumber !== undefined ||
          input.scheduleUnit !== undefined ||
          input.customSchedule !== undefined ||
          input.timezone !== undefined ||
          input.catchupPolicy !== undefined ||
          input.overlapPolicy !== undefined ||
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

        return updatedEvent ? toEventApiDto(updatedEvent, userId) : undefined;
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
        await assertEventCapability(input.id, userId, "edit");

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
        await assertEventRelations(input.id, userId, "execute");

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
        await assertEventCapability(input.id, userId, "edit");

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
        await assertEventRelations(input.id, userId, "execute");

        const event = await storage.getEventWithRelations(input.id);
        if (!event) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }

        // Single enqueue path (src/lib/scheduling/dispatch.ts); in-process
        // types (tool actions, HTTP requests) are started inside dispatch,
        // fire-and-forget — the runner finalizes the job/log itself and the
        // UI polls the log for the result.
        const { dispatchEventJob } = await import("@/lib/scheduling/dispatch");
        const result = await dispatchEventJob(event, {
          triggeredBy: "manual",
          input: input.input,
          authorizedUserId: String(userId),
          actor: `user:${String(userId)}`,
        });

        if (result.skipped) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "A previous run of this event is still active (overlap policy: SKIP)",
          });
        }

        return { success: true, logId: result.logId, jobId: result.job.id };
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
        // Logs may contain output or secret-derived data; sharing an event is
        // not a grant to read its execution history.
        await assertEventCapability(input.id, userId, "execute");

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
        await assertEventCapability(input.id, userId, "edit");

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
        await assertEventCapability(input.id, userId, "view");

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
          await assertEventRelations(eventId, userId, "view");
          return {
            format: "json",
            filename: `${String(event.name ?? "event")}.json`,
            data: JSON.stringify(toEventApiDto(event, userId), null, 2),
          };
        }

        // Multiple events JSON download
        await Promise.all(
          allowedEventIds.map((id) => assertEventRelations(id, userId, "view")),
        );
        const events = await Promise.all(
          allowedEventIds.map((id) => storage.getEventWithRelations(id)),
        );
        return {
          format: "json",
          filename: "events.json",
          data: JSON.stringify(
            events.map((event) =>
              event ? toEventApiDto(event, userId) : null,
            ),
            null,
            2,
          ),
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
        await assertEventCapability(input.id, userId, "fork");

        // Get the original event with all its data
        const originalEvent = await storage.getEventWithRelations(input.id);
        if (!originalEvent) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }
        const forkProjection = toEventForkSecurityProjection(
          originalEvent,
          userId,
        );
        if (forkProjection.owner) {
          await assertEventRelations(input.id, userId, "view");
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
          httpUrl: forkProjection.httpUrl,
          httpHeaders:
            (forkProjection.httpHeaders as Array<{
              key: string;
              value: string;
            }>) ?? [],
          httpBody: forkProjection.httpBody,
          scheduleNumber: originalEvent.scheduleNumber,
          scheduleUnit: originalEvent.scheduleUnit,
          customSchedule: originalEvent.customSchedule,
          runLocation: forkProjection.runLocation,
          serverId: forkProjection.serverId,
          timeoutValue: originalEvent.timeoutValue,
          timeoutUnit: originalEvent.timeoutUnit,
          retries: originalEvent.retries,
          userId: userId, // Set the current user as the owner
          startTime: originalEvent.startTime,
        };

        // Create the forked event
        const forkedEvent = await storage.createScript(forkedEventData);

        // Copy environment variables
        if (forkProjection.envVars && forkProjection.envVars.length > 0) {
          for (const envVar of forkProjection.envVars) {
            await storage.createEnvVar({
              eventId: forkedEvent.id,
              key: envVar.key,
              value: envVar.value,
            });
          }
        }

        // Copy server associations
        const servers = forkProjection.servers;
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
            await storage.setEventServers(forkedEvent.id, serverIds, userId);
          }
        }

        // Note: We intentionally do NOT copy conditional actions (successEvents, failEvents, etc.)
        // as per the requirement

        // Get the complete forked event with relations
        const completeForkedEvent = await storage.getEventWithRelations(
          forkedEvent.id,
        );

        return completeForkedEvent
          ? toEventApiDto(completeForkedEvent, userId)
          : undefined;
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

  // Validate a cron expression and preview upcoming fire times (schedule form)
  validateCron: protectedProcedure
    .input(
      z.object({
        expression: z.string().min(1).max(255),
        timezone: z.string().max(64).default("UTC"),
      }),
    )
    .query(async ({ input }) => {
      const { validateCronExpr } =
        await import("@/lib/scheduling/schedule-math");
      const result = validateCronExpr(input.expression, input.timezone);
      return {
        valid: result.valid,
        error: result.error ?? null,
        next: (result.next ?? []).map((d) => d.toISOString()),
      };
    }),

  // Recent schedule incidents (missed/skipped/auto-paused/lease-lost) for an
  // event — the "didn't run" half of the run history (PLAN.md §8)
  getScheduleIncidents: protectedProcedure
    .input(
      z.object({
        eventId: z.number().int().positive(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertEventCapability(
        input.eventId,
        ctx.session.user.id,
        "execute",
      );
      const { db } = await import("@/server/db");
      const { scheduleIncidents } = await import("@/shared/schema");
      const { desc: descOp, eq: eqOp } = await import("drizzle-orm");
      const incidents = await db
        .select()
        .from(scheduleIncidents)
        .where(eqOp(scheduleIncidents.eventId, input.eventId))
        .orderBy(descOp(scheduleIncidents.createdAt))
        .limit(input.limit);
      return { incidents };
    }),
});
