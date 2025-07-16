import { z } from "zod";
import { createTRPCRouter, protectedProcedure, withTiming } from "../trpc";
import { TRPCError } from "@trpc/server";
import { dashboardService } from "@/lib/services/dashboard-service";

// Schemas
const dashboardStatsSchema = z.object({
  days: z.number().min(1).max(365).default(30),
  activityLimit: z.number().min(1).max(100).default(50),
});

export const dashboardRouter = createTRPCRouter({
  // Get dashboard statistics - now using optimized queries
  getStats: protectedProcedure
    .use(withTiming)
    .input(dashboardStatsSchema.optional())
    .query(async ({ ctx, input = {} }) => {
      try {
        const userId = ctx.session.user.id;
        const days = input.days ?? 30;
        const activityLimit = input.activityLimit ?? 50;

        // Direct call to dashboard service without caching
        // Use the optimized dashboard service that executes queries in parallel
        // and eliminates N+1 query patterns
        const stats = await dashboardService.getDashboardStats(
          userId,
          days,
          activityLimit,
        );

        return stats;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch dashboard statistics",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Get recent activity - now using optimized queries
  getRecentActivity: protectedProcedure
    .input(
      z.object({ limit: z.number().min(1).max(50).default(10) }).optional(),
    )
    .query(async ({ ctx, input = {} }) => {
      try {
        const userId = ctx.session.user.id;
        const limit = input.limit ?? 10;

        // Use the optimized dashboard service that executes queries efficiently
        const recentActivity = await dashboardService.getRecentActivity(
          userId,
          limit,
        );

        return recentActivity;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch recent activity",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),
});
