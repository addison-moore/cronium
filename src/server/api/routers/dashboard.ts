import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  withTiming,
  withCache,
} from "../trpc";
import { TRPCError } from "@trpc/server";
import { storage } from "@/server/storage";
import { db } from "@/server/db";
import {
  logs,
  events,
  workflows,
  EventStatus,
  LogStatus,
} from "@/shared/schema";
import { eq, desc, gte, and, sql } from "drizzle-orm";

// Schemas
const dashboardStatsSchema = z.object({
  days: z.number().min(1).max(365).default(30),
  activityLimit: z.number().min(1).max(100).default(50),
});

export const dashboardRouter = createTRPCRouter({
  // Get dashboard statistics
  getStats: protectedProcedure
    .use(withTiming)
    .use(withCache(30000)) // Cache for 30 seconds
    .input(dashboardStatsSchema.optional())
    .query(async ({ ctx, input = {} }) => {
      try {
        const userId = ctx.session.user.id;
        const days = input.days ?? 30;
        const activityLimit = input.activityLimit ?? 50;

        // Get script counts
        const allScripts = await storage.getAllEvents(userId);

        const totalScripts = allScripts.length;
        const activeScripts = allScripts.filter(
          (s) => s.status === EventStatus.ACTIVE,
        ).length;
        const pausedScripts = allScripts.filter(
          (s) => s.status === EventStatus.PAUSED,
        ).length;
        const draftScripts = allScripts.filter(
          (s) => s.status === EventStatus.DRAFT,
        ).length;

        // Get execution stats from the specified time period
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - days);

        // Get total count of logs for the user
        const countResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(logs)
          .where(eq(logs.userId, userId));
        const totalActivityCount = countResult[0]?.count ?? 0;

        // Get recent logs with workflow information
        const recentLogs = await db
          .select({
            id: logs.id,
            eventId: logs.eventId,
            workflowId: logs.workflowId,
            status: logs.status,
            startTime: logs.startTime,
            duration: logs.duration,
            eventName: logs.eventName,
            workflowName: workflows.name,
          })
          .from(logs)
          .leftJoin(workflows, eq(logs.workflowId, workflows.id))
          .where(eq(logs.userId, userId))
          .orderBy(desc(logs.startTime))
          .limit(activityLimit);

        // Get execution counts of actual executions (SUCCESS and FAILURE only, not PAUSED)
        const recentLogsQuery = await db
          .select()
          .from(logs)
          .where(and(eq(logs.userId, userId), gte(logs.startTime, daysAgo)));

        // Filter to only count SUCCESS and FAILURE logs (not PAUSED)
        const successLogs = recentLogsQuery.filter(
          (log) => log.status === LogStatus.SUCCESS,
        );
        const failureLogs = recentLogsQuery.filter(
          (log) => log.status === LogStatus.FAILURE,
        );

        // Get the actual execution counts
        const totalSuccessLogs = successLogs.length;
        const totalFailureLogs = failureLogs.length;
        const recentExecutions = totalSuccessLogs + totalFailureLogs;

        const successRate =
          recentExecutions > 0
            ? Math.round((totalSuccessLogs / recentExecutions) * 100)
            : 0;

        const failureRate =
          recentExecutions > 0
            ? Math.round((totalFailureLogs / recentExecutions) * 100)
            : 0;

        // Get counts for events, workflows, and servers
        const userEvents = await db
          .select()
          .from(events)
          .where(eq(events.userId, userId));

        const userWorkflows = await db
          .select()
          .from(workflows)
          .where(eq(workflows.userId, userId));

        const userServers = await storage.getAllServers(userId);

        // Format logs for recent activity
        const recentActivity = recentLogs.map((log) => {
          const script = allScripts.find((s) => s.id === log.eventId);
          return {
            id: log.id,
            eventId: log.eventId,
            eventName:
              script?.name ?? log.eventName ?? `Script #${log.eventId}`,
            status: log.status,
            duration: log.duration ?? 0,
            startTime:
              log.startTime instanceof Date
                ? log.startTime.toISOString()
                : null,
            workflowId: log.workflowId,
            workflowName: log.workflowName,
          };
        });

        return {
          totalScripts,
          activeScripts,
          pausedScripts,
          draftScripts,
          recentExecutions,
          successRate,
          failureRate,
          eventsCount: userEvents.length,
          workflowsCount: userWorkflows.length,
          serversCount: userServers.length,
          recentActivity,
          totalActivityCount,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch dashboard statistics",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Get recent activity (same as recentActivity from getStats but as separate endpoint)
  getRecentActivity: protectedProcedure
    .input(
      z.object({ limit: z.number().min(1).max(50).default(10) }).optional(),
    )
    .query(async ({ ctx, input = {} }) => {
      try {
        const userId = ctx.session.user.id;
        const limit = input.limit ?? 10;

        // Get all user scripts for name lookup
        const allScripts = await storage.getAllEvents(userId);

        // Get recent logs with workflow information
        const recentLogs = await db
          .select({
            id: logs.id,
            eventId: logs.eventId,
            workflowId: logs.workflowId,
            status: logs.status,
            startTime: logs.startTime,
            duration: logs.duration,
            eventName: logs.eventName,
            workflowName: workflows.name,
          })
          .from(logs)
          .leftJoin(workflows, eq(logs.workflowId, workflows.id))
          .where(eq(logs.userId, userId))
          .orderBy(desc(logs.startTime))
          .limit(limit);

        // Format logs for recent activity
        const recentActivity = recentLogs.map((log) => {
          const script = allScripts.find((s) => s.id === log.eventId);
          return {
            id: log.id,
            eventId: log.eventId,
            eventName:
              script?.name ?? log.eventName ?? `Script #${log.eventId}`,
            status: log.status,
            duration: log.duration ?? 0,
            startTime:
              log.startTime instanceof Date
                ? log.startTime.toISOString()
                : null,
            workflowId: log.workflowId,
            workflowName: log.workflowName,
          };
        });

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
