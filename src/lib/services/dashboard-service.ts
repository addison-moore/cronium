import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  logs,
  events,
  workflows,
  EventStatus,
  LogStatus,
} from "@/shared/schema";
import { eq, desc, gte, and, sql, count } from "drizzle-orm";

export interface DashboardStats {
  totalScripts: number;
  activeScripts: number;
  pausedScripts: number;
  draftScripts: number;
  recentExecutions: number;
  successRate: number;
  failureRate: number;
  eventsCount: number;
  workflowsCount: number;
  serversCount: number;
  recentActivity: RecentActivity[];
  totalActivityCount: number;
}

export interface RecentActivity {
  id: number;
  eventId: number;
  eventName: string;
  status: LogStatus;
  duration: number;
  startTime: string | null;
  workflowId: number | null;
  workflowName: string | null;
}

export class DashboardService {
  /**
   * Get optimized dashboard statistics with minimal queries
   */
  async getDashboardStats(
    userId: string,
    days: number = 30,
    activityLimit: number = 50,
  ): Promise<DashboardStats> {
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - days);

    // Execute all queries in parallel for better performance
    const [
      userEvents,
      userWorkflows,
      userServers,
      totalActivityCount,
      recentLogs,
      executionStats,
    ] = await Promise.all([
      // Get all user events with their status counts in a single query
      db.query.events.findMany({
        where: eq(events.userId, userId),
        columns: {
          id: true,
          name: true,
          status: true,
        },
      }),

      // Get workflow count
      db.query.workflows.findMany({
        where: eq(workflows.userId, userId),
        columns: { id: true },
      }),

      // Get servers count
      storage.getAllServers(userId),

      // Get total activity count
      db
        .select({ count: count() })
        .from(logs)
        .where(eq(logs.userId, userId))
        .then((result) => result[0]?.count ?? 0),

      // Get recent logs with workflow information in a single query
      db
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
        .limit(activityLimit),

      // Get execution stats for the time period in a single aggregated query
      db
        .select({
          status: logs.status,
          count: count(),
        })
        .from(logs)
        .where(
          and(
            eq(logs.userId, userId),
            gte(logs.startTime, daysAgo),
            sql`${logs.status} IN (${LogStatus.SUCCESS}, ${LogStatus.FAILURE})`,
          ),
        )
        .groupBy(logs.status)
        .then((results) => {
          const stats = { success: 0, failure: 0 };
          results.forEach((row) => {
            if (row.status === LogStatus.SUCCESS) {
              stats.success = row.count;
            } else if (row.status === LogStatus.FAILURE) {
              stats.failure = row.count;
            }
          });
          return stats;
        }),
    ]);

    // Process event status counts
    const statusCounts = userEvents.reduce(
      (acc, event) => {
        switch (event.status) {
          case EventStatus.ACTIVE:
            acc.active++;
            break;
          case EventStatus.PAUSED:
            acc.paused++;
            break;
          case EventStatus.DRAFT:
            acc.draft++;
            break;
        }
        return acc;
      },
      { active: 0, paused: 0, draft: 0 },
    );

    // Calculate execution rates
    const totalExecutions = executionStats.success + executionStats.failure;
    const successRate =
      totalExecutions > 0
        ? Math.round((executionStats.success / totalExecutions) * 100)
        : 0;
    const failureRate =
      totalExecutions > 0
        ? Math.round((executionStats.failure / totalExecutions) * 100)
        : 0;

    // Create event name lookup map for efficient access
    const eventNameMap = new Map(
      userEvents.map((event) => [event.id, event.name]),
    );

    // Format recent activity
    const recentActivity: RecentActivity[] = recentLogs.map((log) => ({
      id: log.id,
      eventId: log.eventId,
      eventName:
        eventNameMap.get(log.eventId) ??
        log.eventName ??
        `Script #${log.eventId}`,
      status: log.status,
      duration: log.duration ?? 0,
      startTime:
        log.startTime instanceof Date ? log.startTime.toISOString() : null,
      workflowId: log.workflowId,
      workflowName: log.workflowName,
    }));

    return {
      totalScripts: userEvents.length,
      activeScripts: statusCounts.active,
      pausedScripts: statusCounts.paused,
      draftScripts: statusCounts.draft,
      recentExecutions: totalExecutions,
      successRate,
      failureRate,
      eventsCount: userEvents.length,
      workflowsCount: userWorkflows.length,
      serversCount: userServers.length,
      recentActivity,
      totalActivityCount,
    };
  }

  /**
   * Get recent activity for a user
   */
  async getRecentActivity(
    userId: string,
    limit: number = 10,
  ): Promise<RecentActivity[]> {
    // Get recent logs with workflow information and event names in a single query
    const [recentLogs, userEvents] = await Promise.all([
      db
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
        .limit(limit),

      // Get event names for mapping
      db.query.events.findMany({
        where: eq(events.userId, userId),
        columns: {
          id: true,
          name: true,
        },
      }),
    ]);

    // Create event name lookup map
    const eventNameMap = new Map(
      userEvents.map((event) => [event.id, event.name]),
    );

    // Format and return recent activity
    return recentLogs.map((log) => ({
      id: log.id,
      eventId: log.eventId,
      eventName:
        eventNameMap.get(log.eventId) ??
        log.eventName ??
        `Script #${log.eventId}`,
      status: log.status,
      duration: log.duration ?? 0,
      startTime:
        log.startTime instanceof Date ? log.startTime.toISOString() : null,
      workflowId: log.workflowId,
      workflowName: log.workflowName,
    }));
  }
}

// Export singleton instance
export const dashboardService = new DashboardService();
