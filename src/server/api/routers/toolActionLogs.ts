import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import { toolActionLogs } from "@/shared/schema";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { TRPCError } from "@trpc/server";

export const toolActionLogsRouter = createTRPCRouter({
  // Get recent tool action logs
  getRecent: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        toolType: z.string().optional(),
        status: z.enum(["SUCCESS", "FAILURE"]).optional(),
      }),
    )
    .query(async ({ input }) => {
      try {
        // Build conditions array first
        const conditions = [];
        if (input.toolType) {
          conditions.push(eq(toolActionLogs.toolType, input.toolType));
        }
        if (input.status) {
          conditions.push(eq(toolActionLogs.status, input.status));
        }

        // Build query with or without where clause
        const logs = await (conditions.length > 0
          ? db
              .select()
              .from(toolActionLogs)
              .where(conditions.length === 1 ? conditions[0] : and(...conditions))
              .orderBy(desc(toolActionLogs.createdAt))
              .limit(input.limit)
          : db
              .select()
              .from(toolActionLogs)
              .orderBy(desc(toolActionLogs.createdAt))
              .limit(input.limit));

        return { logs };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch tool action logs",
          cause: error,
        });
      }
    }),

  // Get logs for a specific event
  getByEventId: publicProcedure
    .input(z.object({ eventId: z.number() }))
    .query(async ({ input }) => {
      try {
        const logs = await db
          .select()
          .from(toolActionLogs)
          .where(eq(toolActionLogs.eventId, input.eventId))
          .orderBy(desc(toolActionLogs.createdAt));

        return { logs };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch event tool action logs",
          cause: error,
        });
      }
    }),

  // Get aggregated stats
  getStats: publicProcedure
    .input(
      z.object({
        period: z.enum(["hour", "day", "week", "month"]).default("day"),
      }),
    )
    .query(async ({ input }) => {
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

// Add missing import
import { and } from "drizzle-orm";
