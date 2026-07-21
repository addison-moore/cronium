import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { events, toolActionLogs } from "@/shared/schema";
import { desc, eq, and } from "drizzle-orm";
import { db } from "@/server/db";
import { TRPCError } from "@trpc/server";

// Tool-action logs can contain message payloads, recipients, and API
// responses, so every read is scoped to logs belonging to the caller's own
// events. The join to `events` (an inner join) both enforces ownership and
// excludes orphaned logs with no owning event.
export const toolActionLogsRouter = createTRPCRouter({
  // Get recent tool action logs for the current user
  getRecent: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        toolType: z.string().optional(),
        status: z.enum(["SUCCESS", "FAILURE"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const conditions = [eq(events.userId, ctx.session.user.id)];
        if (input.toolType) {
          conditions.push(eq(toolActionLogs.toolType, input.toolType));
        }
        if (input.status) {
          conditions.push(eq(toolActionLogs.status, input.status));
        }

        const rows = await db
          .select({ log: toolActionLogs })
          .from(toolActionLogs)
          .innerJoin(events, eq(toolActionLogs.eventId, events.id))
          .where(and(...conditions))
          .orderBy(desc(toolActionLogs.createdAt))
          .limit(input.limit);

        return { logs: rows.map((r) => r.log) };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch tool action logs",
          cause: error,
        });
      }
    }),

  // Get logs for a specific event owned by the current user
  getByEventId: protectedProcedure
    .input(z.object({ eventId: z.number() }))
    .query(async ({ ctx, input }) => {
      try {
        const rows = await db
          .select({ log: toolActionLogs })
          .from(toolActionLogs)
          .innerJoin(events, eq(toolActionLogs.eventId, events.id))
          .where(
            and(
              eq(toolActionLogs.eventId, input.eventId),
              eq(events.userId, ctx.session.user.id),
            ),
          )
          .orderBy(desc(toolActionLogs.createdAt));

        return { logs: rows.map((r) => r.log) };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch event tool action logs",
          cause: error,
        });
      }
    }),

  // Get aggregated stats
  getStats: protectedProcedure
    .input(
      z.object({
        period: z.enum(["hour", "day", "week", "month"]).default("day"),
      }),
    )
    .query(async () => {
      try {
        // For now, return mock stats
        // TODO: Implement actual aggregation queries
        const stats = {
          totalExecutions: 0,
          successCount: 0,
          failureCount: 0,
          avgExecutionTime: 0,
          toolTypeBreakdown: {},
        };

        return stats;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch tool action stats",
          cause: error,
        });
      }
    }),
});
