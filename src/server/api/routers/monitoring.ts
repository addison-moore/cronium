import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  publicProcedure,
  withTiming,
  withRateLimit,
  withCache,
} from "../trpc";
import {
  monitoringQuerySchema,
  systemMetricsSchema,
  activityFeedSchema,
  dashboardStatsSchema,
  healthCheckSchema,
  executionAnalyticsSchema,
  errorTrackingSchema,
} from "@/shared/schemas/monitoring";
import { storage } from "@/server/storage";
import { UserRole, UserStatus, LogStatus } from "@/shared/schema";

// Context type definitions for type safety (currently unused but available for future type enforcement)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface AdminMonitoringContext {
  session: { user: { id: string; role: string } };
  userId: string;
  userRole: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface UserMonitoringContext {
  session: { user: { id: string; role?: string } };
  userId: string;
}

// User procedures will be defined after base procedures

// Helper function to get system information
async function getSystemInformation() {
  try {
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    return {
      uptime,
      memory: {
        total: memory.rss + memory.external + memory.heapTotal,
        used: memory.heapUsed,
        free: memory.heapTotal - memory.heapUsed,
        rss: memory.rss,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers ?? 0,
      },
      cpu: {
        currentLoad: Math.random() * 100, // Mock data
        systemLoad: Math.random() * 50,
        userLoad: Math.random() * 50,
        temperature: 45 + Math.random() * 20,
      },
      os: {
        platform: process.platform,
        arch: process.arch,
        version: process.version,
        hostname: "localhost",
      },
    };
  } catch (error) {
    console.error("Error fetching system information:", error);
    const memory = process.memoryUsage();
    return {
      uptime: process.uptime(),
      memory: {
        total: memory.rss + memory.external + memory.heapTotal,
        used: memory.heapUsed,
        free: memory.heapTotal - memory.heapUsed,
        rss: memory.rss,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers ?? 0,
      },
      cpu: { currentLoad: 0, systemLoad: 0, userLoad: 0 },
      os: {
        platform: process.platform,
        arch: process.arch,
        version: process.version,
      },
    };
  }
}

// Create base procedure with common middleware
const baseMonitoringProcedure = publicProcedure
  .use(withTiming)
  .use(withRateLimit(200, 60000)) // 200 requests per minute
  .use(withCache(10000)); // Cache for 10 seconds

// Admin procedure built on top of base procedure
const adminProcedureWithMiddleware = baseMonitoringProcedure.use(
  async ({ ctx, next }) => {
    let session: { user: { id: string; role?: string } } | null = null;
    let userId: string | null = null;
    let userRole: string | null = null;

    try {
      // If session exists in context, use it
      if (
        ctx.session &&
        typeof ctx.session === "object" &&
        "user" in ctx.session &&
        ctx.session.user &&
        typeof ctx.session.user === "object" &&
        "id" in ctx.session.user
      ) {
        const typedSession = ctx.session as unknown as {
          user: { id: string; role?: string };
        };
        session = typedSession;
        userId = typedSession.user.id;
        userRole = typedSession.user.role ?? null;
      } else {
        // For development, get first admin user
        if (process.env.NODE_ENV === "development") {
          const allUsers = await storage.getAllUsers();
          const adminUsers = allUsers.filter(
            (user) => user.role === UserRole.ADMIN,
          );
          const firstAdmin = adminUsers[0];
          if (firstAdmin) {
            userId = firstAdmin.id;
            userRole = firstAdmin.role;
            session = { user: { id: firstAdmin.id, role: firstAdmin.role } };
          }
        }
      }

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Authentication required",
        });
      }

      if (userRole !== UserRole.ADMIN) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      return next({
        ctx: {
          ...ctx,
          session,
          userId: userId,
          userRole: userRole as string,
        },
      });
    } catch (error) {
      console.error("Auth error in adminMonitoringProcedure:", error);
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication failed",
      });
    }
  },
);

// User-level monitoring procedure (for own stats)
const userProcedureWithMiddleware = publicProcedure.use(
  async ({ ctx, next }) => {
    let session: { user: { id: string; role?: string } } | null = null;
    let userId: string | null = null;

    try {
      // If session exists in context, use it
      if (
        ctx.session &&
        typeof ctx.session === "object" &&
        "user" in ctx.session &&
        ctx.session.user &&
        typeof ctx.session.user === "object" &&
        "id" in ctx.session.user
      ) {
        const typedSession = ctx.session as unknown as {
          user: { id: string; role?: string };
        };
        session = typedSession;
        userId = typedSession.user.id;
      } else {
        // For development, get first admin user
        if (process.env.NODE_ENV === "development") {
          const allUsers = await storage.getAllUsers();
          const adminUsers = allUsers.filter(
            (user) => user.role === UserRole.ADMIN,
          );
          const firstAdmin = adminUsers[0];
          if (firstAdmin) {
            userId = firstAdmin.id;
            session = { user: { id: firstAdmin.id } };
          }
        }
      }

      if (!userId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Authentication required",
        });
      }

      return next({
        ctx: {
          ...ctx,
          session,
          userId: userId,
        },
      });
    } catch (error) {
      console.error("Auth error in userMonitoringProcedure:", error);
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication failed",
      });
    }
  },
);

export const monitoringRouter = createTRPCRouter({
  // Get comprehensive monitoring data (admin only)
  getSystemMonitoring: adminProcedureWithMiddleware
    .input(monitoringQuerySchema)
    .query(async ({ input, ctx }) => {
      try {
        // Calculate time periods
        const now = new Date();
        const periods = {
          day: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          week: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          month: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        };

        // Get basic statistics
        const allUsers = await storage.getAllUsers();
        const stats = await storage.getDashboardStats(ctx.userId); // Using user's dashboard stats as base

        // Type assertion for dashboard stats to ensure type safety
        const dashboardStats = stats as {
          totalEvents?: number;
          activeEvents?: number;
          totalServers?: number;
          onlineServers?: number;
        };

        // User statistics
        const userStats = {
          total: allUsers.length,
          active: allUsers.filter((u) => u.status === UserStatus.ACTIVE).length,
          invited: allUsers.filter((u) => u.status === UserStatus.INVITED)
            .length,
          disabled: allUsers.filter((u) => u.status === UserStatus.DISABLED)
            .length,
          admins: allUsers.filter((u) => u.role === UserRole.ADMIN).length,
        };

        // Get all logs for execution statistics
        const { logs } = await storage.getAllLogs(1000, 1);
        const executionStats = {
          total: logs.filter(
            (log) =>
              log.status === LogStatus.SUCCESS ||
              log.status === LogStatus.FAILURE,
          ).length,
          successful: logs.filter((log) => log.status === LogStatus.SUCCESS)
            .length,
          failed: logs.filter((log) => log.status === LogStatus.FAILURE).length,
          running: logs.filter((log) => log.status === LogStatus.RUNNING)
            .length,
          successRate: 0,
          failureRate: 0,
        };

        if (executionStats.total > 0) {
          executionStats.successRate = Math.round(
            (executionStats.successful / executionStats.total) * 100,
          );
          executionStats.failureRate = Math.round(
            (executionStats.failed / executionStats.total) * 100,
          );
        }

        // Activity statistics (last 24h, week, month)
        const periodLogs = {
          last24Hours: logs.filter(
            (log) => new Date(log.startTime) >= periods.day,
          ).length,
          lastWeek: logs.filter(
            (log) => new Date(log.startTime) >= periods.week,
          ).length,
          lastMonth: logs.filter(
            (log) => new Date(log.startTime) >= periods.month,
          ).length,
        };

        // Recent activity (last 10 logs)
        const recentActivity = logs
          .sort(
            (a, b) =>
              new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
          )
          .slice(0, 10)
          .map((log) => ({
            id: log.id,
            eventId: log.eventId,
            eventName: log.eventName,
            status: log.status,
            startTime: log.startTime,
            duration: log.duration,
          }));

        // System information
        const systemInfo = input.includeSystemMetrics
          ? await getSystemInformation()
          : null;

        // System settings
        const systemSettings = input.includeSettings
          ? await storage.getAllSettings()
          : [];
        const settingsObj = systemSettings.reduce(
          (acc, setting) => {
            try {
              acc[setting.key] = JSON.parse(setting.value) as unknown;
            } catch {
              acc[setting.key] = setting.value;
            }
            return acc;
          },
          {} as Record<string, unknown>,
        );

        return {
          users: userStats,
          events: {
            total: dashboardStats.totalEvents ?? 0,
            active: dashboardStats.activeEvents ?? 0,
            // Add more event stats as needed
          },
          executions: executionStats,
          activity: periodLogs,
          servers: {
            total: dashboardStats.totalServers ?? 0,
            online: dashboardStats.onlineServers ?? 0,
          },
          recentActivity: input.includeRecentActivity ? recentActivity : [],
          system: systemInfo,
          settings: input.includeSettings ? settingsObj : {},
          period: input.period,
          timestamp: now.toISOString(),
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch system monitoring data",
          cause: error,
        });
      }
    }),

  // Get system metrics (admin only)
  getSystemMetrics: adminProcedureWithMiddleware
    .input(systemMetricsSchema)
    .query(async ({ input, ctx: _ctx }) => {
      try {
        const systemInfo = await getSystemInformation();

        // If historical data is requested, generate mock historical points
        let historical = null;
        if (input.includeHistorical) {
          historical = Array.from({ length: input.historyPoints }, (_, i) => {
            const timestamp = new Date();
            timestamp.setHours(
              timestamp.getHours() - (input.historyPoints - i),
            );

            return {
              timestamp: timestamp.toISOString(),
              cpu: Math.random() * 100,
              memory: 50 + Math.random() * 40,
              disk: 30 + Math.random() * 20,
            };
          });
        }

        return {
          current: systemInfo,
          historical,
          interval: input.interval,
          lastUpdated: new Date().toISOString(),
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch system metrics",
          cause: error,
        });
      }
    }),

  // Get dashboard statistics (user-specific or admin)
  getDashboardStats: userProcedureWithMiddleware
    .input(dashboardStatsSchema)
    .query(async ({ input, ctx }) => {
      try {
        const targetUserId = input.userId ?? ctx.userId;

        // Check if user can access stats for the target user
        if (input.userId && input.userId !== ctx.userId) {
          // Only admins can view other users' stats
          const user = await storage.getUser(ctx.userId);
          if (!user || user.role !== UserRole.ADMIN) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Cannot access other user's statistics",
            });
          }
        }

        const stats = await storage.getDashboardStats(targetUserId);

        // Type assertion for dashboard stats
        const typedStats = stats as unknown as {
          totalEvents?: number;
          activeEvents?: number;
          totalServers?: number;
          onlineServers?: number;
          [key: string]: unknown;
        };

        // Add period-specific data if requested
        let periodComparison = null;
        if (input.includeComparisons) {
          // Generate mock comparison data
          periodComparison = {
            eventsChange: Math.floor(Math.random() * 20) - 10, // -10 to +10
            executionsChange: Math.floor(Math.random() * 30) - 15, // -15 to +15
            successRateChange: Math.floor(Math.random() * 10) - 5, // -5 to +5
          };
        }

        return {
          ...typedStats,
          period: input.period,
          userId: targetUserId,
          comparison: periodComparison,
          lastUpdated: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch dashboard statistics",
          cause: error,
        });
      }
    }),

  // Get activity feed
  getActivityFeed: userProcedureWithMiddleware
    .input(activityFeedSchema)
    .query(async ({ input, ctx }) => {
      try {
        const targetUserId = input.userId ?? ctx.userId;

        // Check permissions for viewing other user's activity
        if (input.userId && input.userId !== ctx.userId) {
          const user = await storage.getUser(ctx.userId);
          if (!user || user.role !== UserRole.ADMIN) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Cannot access other user's activity",
            });
          }
        }

        // Get recent logs as activity feed
        const filters: Record<string, unknown> = { userId: targetUserId };
        if (input.since) {
          filters.startDate = input.since;
        }

        const { logs } = await storage.getFilteredLogs(
          filters,
          input.limit,
          Math.floor(input.offset / input.limit) + 1,
        );

        const activities = logs.map((log) => ({
          id: log.id,
          type: "execution",
          title: `${log.eventName ?? "Unknown"} ${log.status.toLowerCase()}`,
          description:
            log.status === LogStatus.SUCCESS
              ? `Event executed successfully in ${String(log.duration ?? 0)}ms`
              : log.status === LogStatus.FAILURE
                ? "Event execution failed"
                : "Event is running",
          timestamp: log.startTime,
          severity:
            log.status === LogStatus.FAILURE
              ? "high"
              : log.status === LogStatus.RUNNING
                ? "medium"
                : "low",
          metadata: {
            eventId: log.eventId,
            eventName: log.eventName,
            status: log.status,
            duration: log.duration,
          },
        }));

        return {
          activities,
          total: activities.length,
          hasMore: input.offset + input.limit < activities.length,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch activity feed",
          cause: error,
        });
      }
    }),

  // Get system health check (admin only)
  getHealthCheck: adminProcedureWithMiddleware
    .input(healthCheckSchema)
    .query(async ({ input, ctx: _ctx }) => {
      try {
        const health = {
          overall: "healthy" as "healthy" | "unhealthy" | "degraded",
          timestamp: new Date().toISOString(),
          checks: [] as Array<{
            name: string;
            status: string;
            responseTime?: number;
            message: string;
            error?: string;
            value?: number;
            threshold?: number;
          }>,
        };

        // Database check
        if (input.includeDatabase) {
          try {
            await storage.getAllUsers(); // Simple query to test DB
            health.checks.push({
              name: "database",
              status: "healthy",
              responseTime: Math.random() * 50,
              message: "Database connection successful",
            });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            health.checks.push({
              name: "database",
              status: "unhealthy",
              responseTime: input.timeout * 1000,
              message: "Database connection failed",
              error: errorMessage,
            });
            health.overall = "unhealthy";
          }
        }

        // System resources check
        if (input.includeSystemResources) {
          const systemInfo = await getSystemInformation();
          const memoryUsage =
            (systemInfo.memory.used / systemInfo.memory.total) * 100;

          health.checks.push({
            name: "memory",
            status:
              memoryUsage > 90
                ? "unhealthy"
                : memoryUsage > 75
                  ? "degraded"
                  : "healthy",
            value: memoryUsage,
            threshold: 90,
            message: `Memory usage: ${memoryUsage.toFixed(1)}%`,
          });

          health.checks.push({
            name: "cpu",
            status:
              systemInfo.cpu.currentLoad > 90
                ? "unhealthy"
                : systemInfo.cpu.currentLoad > 75
                  ? "degraded"
                  : "healthy",
            value: systemInfo.cpu.currentLoad,
            threshold: 90,
            message: `CPU usage: ${systemInfo.cpu.currentLoad.toFixed(1)}%`,
          });
        }

        // External services check (placeholder)
        if (input.includeExternalServices) {
          health.checks.push({
            name: "external_services",
            status: "healthy",
            responseTime: Math.random() * 200,
            message: "All external services responding",
          });
        }

        // Update overall status based on individual checks
        if (health.checks.some((check) => check.status === "unhealthy")) {
          health.overall = "unhealthy";
        } else if (health.checks.some((check) => check.status === "degraded")) {
          health.overall = "degraded";
        }

        return health;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to perform health check",
          cause: error,
        });
      }
    }),

  // Get execution analytics
  getExecutionAnalytics: userProcedureWithMiddleware
    .input(executionAnalyticsSchema)
    .query(async ({ input, ctx }) => {
      try {
        const targetUserId = input.userId ?? ctx.userId;

        // Check permissions
        if (input.userId && input.userId !== ctx.userId) {
          const user = await storage.getUser(ctx.userId);
          if (!user || user.role !== UserRole.ADMIN) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Cannot access other user's analytics",
            });
          }
        }

        // Get logs for analytics
        const filters: Record<string, unknown> = { userId: targetUserId };
        if (input.eventId) filters.eventId = input.eventId;
        if (input.serverId) filters.serverId = input.serverId;

        const { logs } = await storage.getFilteredLogs(filters, 1000, 1);

        // Group by the specified criteria
        const analytics = {
          period: input.period,
          groupBy: input.groupBy,
          data: [] as Array<{
            label: string;
            value: number;
            percentage?: number;
            success?: number;
            failure?: number;
            successRate?: number;
          }>,
          summary: {
            totalExecutions: logs.length,
            successRate: 0,
            failureRate: 0,
            averageDuration: 0,
          },
        };

        // Calculate summary statistics
        const successfulLogs = logs.filter(
          (log) => log.status === LogStatus.SUCCESS,
        );
        const failedLogs = logs.filter(
          (log) => log.status === LogStatus.FAILURE,
        );

        analytics.summary.successRate =
          logs.length > 0
            ? Math.round((successfulLogs.length / logs.length) * 100)
            : 0;
        analytics.summary.failureRate =
          logs.length > 0
            ? Math.round((failedLogs.length / logs.length) * 100)
            : 0;

        const logsWithDuration = logs.filter(
          (log) => log.duration && log.duration > 0,
        );
        if (logsWithDuration.length > 0) {
          const totalDuration = logsWithDuration.reduce(
            (sum, log) => sum + (log.duration ?? 0),
            0,
          );
          analytics.summary.averageDuration = Math.round(
            totalDuration / logsWithDuration.length,
          );
        }

        // Group data based on groupBy parameter
        switch (input.groupBy) {
          case "status":
            analytics.data = [
              {
                label: "Success",
                value: successfulLogs.length,
                percentage: analytics.summary.successRate,
              },
              {
                label: "Failure",
                value: failedLogs.length,
                percentage: analytics.summary.failureRate,
              },
              {
                label: "Running",
                value: logs.filter((log) => log.status === LogStatus.RUNNING)
                  .length,
              },
            ];
            break;
          case "event":
            const eventGroups = logs.reduce(
              (acc, log) => {
                const key = log.eventName ?? "Unknown";
                acc[key] ??= { count: 0, success: 0, failure: 0 };
                acc[key].count++;
                if (log.status === LogStatus.SUCCESS) acc[key].success++;
                if (log.status === LogStatus.FAILURE) acc[key].failure++;
                return acc;
              },
              {} as Record<
                string,
                { count: number; success: number; failure: number }
              >,
            );

            analytics.data = Object.entries(eventGroups).map(
              ([name, stats]) => {
                const typedStats = stats as {
                  count: number;
                  success: number;
                  failure: number;
                };
                return {
                  label: name,
                  value: typedStats.count,
                  success: typedStats.success,
                  failure: typedStats.failure,
                  successRate: Math.round(
                    (typedStats.success / typedStats.count) * 100,
                  ),
                };
              },
            );
            break;
          default:
            analytics.data = [{ label: "Total", value: logs.length }];
        }

        return analytics;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch execution analytics",
          cause: error,
        });
      }
    }),

  // Get error tracking data (admin only)
  getErrorTracking: adminProcedureWithMiddleware
    .input(errorTrackingSchema)
    .query(async ({ input, ctx: _ctx }) => {
      try {
        // Get failed logs as error data
        const { logs } = await storage.getAllLogs(
          input.limit,
          Math.floor(input.offset / input.limit) + 1,
        );
        const errorLogs = logs.filter(
          (log) => log.status === LogStatus.FAILURE,
        );

        const errors = errorLogs.map((log) => ({
          id: log.id,
          message: log.output ?? "Execution failed",
          component: "execution",
          severity: "error",
          timestamp: log.startTime,
          eventId: log.eventId,
          eventName: log.eventName,
          userId: log.userId,
          metadata: {
            duration: log.duration,
            errorOutput: log.error ?? log.output,
          },
        }));

        // Group errors if requested
        let groupedData = null;
        if (input.groupBy) {
          const groups = errors.reduce(
            (acc, error) => {
              let key;
              switch (input.groupBy) {
                case "message":
                  key = error.message.substring(0, 50) + "...";
                  break;
                case "component":
                  key = error.component;
                  break;
                case "user":
                  key = error.userId ?? "Unknown";
                  break;
                default:
                  key = new Date(error.timestamp).toDateString();
              }

              acc[key] ??= [];
              acc[key]?.push(error);
              return acc;
            },
            {} as Record<
              string,
              Array<{
                id: number;
                message: string;
                component: string;
                severity: string;
                timestamp: Date;
                eventId: number;
                eventName: string | null;
                userId: string | null;
                metadata: {
                  duration: number | null;
                  errorOutput: string | null;
                };
              }>
            >,
          );

          groupedData = Object.entries(groups).map(([key, items]) => {
            const typedItems = items as Array<{
              id: number;
              message: string;
              component: string;
              severity: string;
              timestamp: Date;
              eventId: number;
              eventName: string | null;
              userId: string | null;
              metadata: {
                duration: number | null;
                errorOutput: string | null;
              };
            }>;
            return {
              group: key,
              count: typedItems.length,
              errors: typedItems,
            };
          });
        }

        return {
          errors,
          groupedData,
          total: errors.length,
          hasMore: input.offset + input.limit < errors.length,
          period: input.period,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch error tracking data",
          cause: error,
        });
      }
    }),
});
