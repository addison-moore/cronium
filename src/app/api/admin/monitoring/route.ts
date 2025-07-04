import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/server/db";
import { UserRole, LogStatus, EventStatus, UserStatus } from "@/shared/schema";
import { users, logs, servers, events } from "@/shared/schema";
import { sql, count, eq, desc } from "drizzle-orm";
import { storage } from "@/server/storage";
import si from "systeminformation";

/**
 * Get real-time system information using the systeminformation package
 */
async function getSystemInformation() {
  try {
    // Get CPU load information
    const cpuLoad = await si.currentLoad();

    // Get CPU temperature information
    const cpuInfo = await si.cpu();

    // Get memory information
    const memory = await si.mem();

    // Get system time information (includes uptime)
    const time = si.time();

    // Get CPU temperature information
    const temperature = await si.cpuTemperature();

    // Get OS information
    const osInfo = await si.osInfo();

    return {
      uptime: time.uptime,
      memory: {
        total: memory.total,
        used: memory.used,
        free: memory.free,
        rss: process.memoryUsage().rss,
        external: process.memoryUsage().external || 0,
        arrayBuffers: process.memoryUsage().arrayBuffers || 0,
      },
      cpu: {
        currentLoad: cpuLoad.currentLoad / 200,
        systemLoad: cpuLoad.currentLoadSystem / 200,
        userLoad: cpuLoad.currentLoadUser / 200,
        temperature: temperature.main,
        manufacturer: cpuInfo.manufacturer,
        brand: cpuInfo.brand,
        speed: cpuInfo.speed,
        cores: cpuInfo.cores,
      },
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        arch: osInfo.arch,
        hostname: osInfo.hostname,
      },
    };
  } catch (error) {
    console.error("Error fetching system information:", error);

    // Fallback to basic process information if systeminformation fails
    return {
      uptime: process.uptime(),
      memory: {
        total: 8 * 1024 * 1024 * 1024, // 8GB (example)
        used: process.memoryUsage().rss,
        free: 8 * 1024 * 1024 * 1024 - process.memoryUsage().rss,
        rss: process.memoryUsage().rss,
        external: process.memoryUsage().external || 0,
        arrayBuffers: process.memoryUsage().arrayBuffers || 0,
      },
      cpuUsage: {
        user: 0.25, // Example (25%)
        system: 0.15, // Example (15%)
      },
    };
  }
}

export async function GET(req: NextRequest) {
  try {
    // Check if the user is authenticated and is an admin
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { message: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }

    // Calculate time periods
    const now = new Date();
    const oneDayAgo = new Date(now);
    oneDayAgo.setDate(now.getDate() - 1);

    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(now.getDate() - 7);

    const oneMonthAgo = new Date(now);
    oneMonthAgo.setMonth(now.getMonth() - 1);

    // 1. User statistics
    const totalUsersResult = await db.select({ value: count() }).from(users);
    const totalUsers = totalUsersResult[0]?.value ?? 0;

    const activeUsersResult = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.status, UserStatus.ACTIVE));
    const activeUsers = activeUsersResult[0]?.value ?? 0;

    const invitedUsersResult = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.status, UserStatus.INVITED));
    const invitedUsers = invitedUsersResult[0]?.value ?? 0;

    const disabledUsersResult = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.status, UserStatus.DISABLED));
    const disabledUsers = disabledUsersResult[0]?.value ?? 0;

    const adminUsersResult = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.role, UserRole.ADMIN));
    const adminUsers = adminUsersResult[0]?.value ?? 0;

    // 2. Event statistics
    const totalEventsResult = await db.select({ value: count() }).from(events);
    const totalEvents = totalEventsResult[0]?.value ?? 0;

    const activeEventsResult = await db
      .select({ value: count() })
      .from(events)
      .where(eq(events.status, EventStatus.ACTIVE));
    const activeEvents = activeEventsResult[0]?.value ?? 0;

    const pausedEventsResult = await db
      .select({ value: count() })
      .from(events)
      .where(eq(events.status, EventStatus.PAUSED));
    const pausedEvents = pausedEventsResult[0]?.value ?? 0;

    const draftEventsResult = await db
      .select({ value: count() })
      .from(events)
      .where(eq(events.status, EventStatus.DRAFT));
    const draftEvents = draftEventsResult[0]?.value ?? 0;

    // 3. Execution statistics
    // Only count SUCCESS and FAILURE logs as actual executions (not PAUSED)
    const successfulExecutionsResult = await db
      .select({ value: count() })
      .from(logs)
      .where(eq(logs.status, LogStatus.SUCCESS));
    const successfulExecutions = successfulExecutionsResult[0]?.value ?? 0;

    const failedExecutionsResult = await db
      .select({ value: count() })
      .from(logs)
      .where(eq(logs.status, LogStatus.FAILURE));
    const failedExecutions = failedExecutionsResult[0]?.value ?? 0;

    const runningExecutionsResult = await db
      .select({ value: count() })
      .from(logs)
      .where(eq(logs.status, LogStatus.RUNNING));
    const runningExecutions = runningExecutionsResult[0]?.value ?? 0;

    // Calculate actual executions as sum of success and failure only
    const totalExecutions = successfulExecutions + failedExecutions;

    // 4. Recent activities
    const oneDayAgoStr = oneDayAgo.toISOString();
    const oneWeekAgoStr = oneWeekAgo.toISOString();
    const oneMonthAgoStr = oneMonthAgo.toISOString();

    // Only count SUCCESS and FAILURE logs as actual executions
    // Using SQL template literals to avoid and/or operator issues
    const executionsLast24h = await db.execute(
      sql`SELECT COUNT(*) FROM logs 
          WHERE start_time >= ${oneDayAgoStr}
          AND (status = 'SUCCESS' OR status = 'FAILURE')`,
    );

    const executionsLastWeek = await db.execute(
      sql`SELECT COUNT(*) FROM logs 
          WHERE start_time >= ${oneWeekAgoStr}
          AND (status = 'SUCCESS' OR status = 'FAILURE')`,
    );

    const executionsLastMonth = await db.execute(
      sql`SELECT COUNT(*) FROM logs 
          WHERE start_time >= ${oneMonthAgoStr}
          AND (status = 'SUCCESS' OR status = 'FAILURE')`,
    );

    // 5. Servers count
    const totalServersResult = await db
      .select({ value: count() })
      .from(servers);
    const totalServers = totalServersResult[0]?.value ?? 0;

    // 6. Get latest logs for activity feed
    const recentLogs = await db
      .select({
        id: logs.id,
        eventId: logs.eventId,
        eventName: logs.eventName,
        status: logs.status,
        startTime: logs.startTime,
        duration: logs.duration,
      })
      .from(logs)
      .orderBy(desc(logs.startTime))
      .limit(10);

    // 7. Get system settings
    const systemSettings = await storage.getAllSettings();

    // Get real-time system information
    const systemInfo = await getSystemInformation();

    // Build and return the monitoring data
    const monitoringData = {
      users: {
        total: totalUsers,
        active: activeUsers,
        invited: invitedUsers,
        disabled: disabledUsers,
        admins: adminUsers,
      },
      events: {
        total: totalEvents,
        active: activeEvents,
        paused: pausedEvents,
        draft: draftEvents,
      },
      executions: {
        total: totalExecutions,
        successful: successfulExecutions,
        failed: failedExecutions,
        running: runningExecutions,
        successRate:
          totalExecutions > 0
            ? Math.round((successfulExecutions / totalExecutions) * 100)
            : 0,
        failureRate:
          totalExecutions > 0
            ? Math.round((failedExecutions / totalExecutions) * 100)
            : 0,
      },
      activity: {
        last24Hours: parseInt(
          String(executionsLast24h.rows[0]?.count) || "0",
          10,
        ),
        lastWeek: parseInt(
          String(executionsLastWeek.rows[0]?.count) || "0",
          10,
        ),
        lastMonth: parseInt(
          String(executionsLastMonth.rows[0]?.count) || "0",
          10,
        ),
      },
      servers: {
        total: totalServers,
      },
      recentActivity: recentLogs,
      settings: systemSettings.reduce(
        (acc, setting) => {
          // Try to parse the value as JSON, if it fails just use the string
          try {
            acc[setting.key] = JSON.parse(setting.value);
          } catch (e) {
            acc[setting.key] = setting.value;
          }
          return acc;
        },
        {} as Record<string, any>,
      ),
      system: systemInfo,
    };

    return NextResponse.json(monitoringData);
  } catch (error) {
    console.error("Error fetching monitoring data:", error);
    return NextResponse.json(
      { message: "An error occurred while fetching monitoring data" },
      { status: 500 },
    );
  }
}
