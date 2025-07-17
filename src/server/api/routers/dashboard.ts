import { z } from "zod";
import { createTRPCRouter, protectedProcedure, withTiming } from "../trpc";
import { withErrorHandling } from "@/server/utils/error-utils";
import { statsResponse, listResponse } from "@/server/utils/api-patterns";
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
      return withErrorHandling(
        async () => {
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

          return statsResponse(
            {
              start: new Date(
                Date.now() - days * 24 * 60 * 60 * 1000,
              ).toISOString(),
              end: new Date().toISOString(),
            },
            stats as unknown as Record<string, number | string>,
          );
        },
        {
          component: "dashboardRouter",
          operationName: "getStats",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get recent activity - now using optimized queries
  getRecentActivity: protectedProcedure
    .input(
      z.object({ limit: z.number().min(1).max(50).default(10) }).optional(),
    )
    .query(async ({ ctx, input = {} }) => {
      return withErrorHandling(
        async () => {
          const userId = ctx.session.user.id;
          const limit = input.limit ?? 10;

          // Use the optimized dashboard service that executes queries efficiently
          const recentActivity = await dashboardService.getRecentActivity(
            userId,
            limit,
          );

          return listResponse({
            items: recentActivity,
            total: recentActivity.length,
            hasMore: false,
            limit: limit,
            offset: 0,
          });
        },
        {
          component: "dashboardRouter",
          operationName: "getRecentActivity",
          userId: ctx.session.user.id,
        },
      );
    }),
});
