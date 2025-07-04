import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";
import { db } from "@/server/db";
import {
  logs,
  events,
  workflows,
  EventStatus,
  LogStatus,
} from "@/shared/schema";
import { eq, desc, gte, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    // Check if the user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

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

    // Get execution stats from the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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
      .limit(10);

    // Get execution counts of actual executions (SUCCESS and FAILURE only, not PAUSED)
    // First, get all logs for this user from the last 30 days
    const recentLogsQuery = await db
      .select()
      .from(logs)
      .where(and(eq(logs.userId, userId), gte(logs.startTime, thirtyDaysAgo)));

    // Now manually filter to only count SUCCESS and FAILURE logs (not PAUSED)
    const successLogs = recentLogsQuery.filter(
      (log) => log.status === LogStatus.SUCCESS,
    );
    const failureLogs = recentLogsQuery.filter(
      (log) => log.status === LogStatus.FAILURE,
    );

    // Get the actual execution counts (success + failure only)
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
    // Note: We're filtering by userId to only get this user's events
    const userEvents = await db
      .select()
      .from(events)
      .where(eq(events.userId, userId));

    // Get workflows for the current user
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
        eventName: script?.name || log.eventName || `Script #${log.eventId}`,
        status: log.status,
        duration: log.duration || 0,
        startTime:
          log.startTime instanceof Date ? log.startTime.toISOString() : null,
        workflowId: log.workflowId,
        workflowName: log.workflowName,
      };
    });

    const stats = {
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
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { message: "An error occurred fetching dashboard stats" },
      { status: 500 },
    );
  }
}
