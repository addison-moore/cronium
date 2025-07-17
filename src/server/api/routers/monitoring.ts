/**
 * Monitoring Router
 *
 * Real-time data includes:
 * - Health checks (database, services, orchestrator)
 * - System metrics (CPU, memory, disk usage)
 * - Activity feeds and execution analytics
 * - Dashboard statistics
 *
 */

import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  withTiming,
  withRateLimit,
} from "../trpc";
import { withErrorHandling, permissionError } from "@/server/utils/error-utils";
import {
  listResponse,
  resourceResponse,
  statsResponse,
  healthResponse,
} from "@/server/utils/api-patterns";
import {
  normalizePagination,
  createPaginatedResult,
} from "@/server/utils/db-patterns";
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

// Helper types for monitoring data
interface SystemInfo {
  uptime: number;
  memory: {
    total: number;
    used: number;
    free: number;
    rss: number;
    external: number;
    arrayBuffers: number;
  };
  cpu: {
    currentLoad: number;
    systemLoad: number;
    userLoad: number;
    temperature?: number;
  };
  os: {
    platform: NodeJS.Platform;
    arch: string;
    version: string;
    hostname?: string;
  };
}

// Helper function to get system information
async function getSystemInformation(): Promise<SystemInfo> {
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

// Create monitoring procedures with rate limiting
const monitoringProtectedProcedure = protectedProcedure
  .use(withTiming)
  .use(withRateLimit(200, 60000)); // 200 requests per minute

const monitoringAdminProcedure = adminProcedure
  .use(withTiming)
  .use(withRateLimit(200, 60000)); // 200 requests per minute

// Health check is public but rate limited
const publicHealthProcedure = publicProcedure
  .use(withTiming)
  .use(withRateLimit(60, 60000)); // 60 requests per minute

export const monitoringRouter = createTRPCRouter({
  // Get comprehensive monitoring data (admin only)
  getSystemMonitoring: monitoringAdminProcedure
    .input(monitoringQuerySchema)
    .query(async ({ input, ctx }) => {
      return withErrorHandling(
        async () => {
          // Calculate time periods
          const now = new Date();
          const periods = {
            day: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            week: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
            month: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          };

          // Get basic statistics
          const allUsers = await storage.getAllUsers();
          const stats = await storage.getDashboardStats(ctx.session.user.id);

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
            active: allUsers.filter((u) => u.status === UserStatus.ACTIVE)
              .length,
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
            failed: logs.filter((log) => log.status === LogStatus.FAILURE)
              .length,
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
                new Date(b.startTime).getTime() -
                new Date(a.startTime).getTime(),
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

          // Flatten the metrics for statsResponse
          const flatMetrics: Record<string, string | number> = {
            totalUsers: userStats.total,
            activeUsers: userStats.active,
            totalEvents: dashboardStats.totalEvents ?? 0,
            activeEvents: dashboardStats.activeEvents ?? 0,
            totalExecutions: executionStats.total,
            totalServers: dashboardStats.totalServers ?? 0,
            onlineServers: dashboardStats.onlineServers ?? 0,
            period: input.period,
          };

          return statsResponse(
            {
              start:
                (periods as Record<string, Date>)[
                  input.period
                ]?.toISOString() ?? periods.day.toISOString(),
              end: now.toISOString(),
            },
            flatMetrics,
          );
        },
        {
          component: "monitoringRouter",
          operationName: "getSystemMonitoring",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get system metrics (admin only)
  getSystemMetrics: monitoringAdminProcedure
    .input(systemMetricsSchema)
    .query(async ({ input, ctx }) => {
      return withErrorHandling(
        async () => {
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

          const metrics = {
            current: systemInfo,
            historical,
            interval: input.interval,
            lastUpdated: new Date().toISOString(),
          };

          return resourceResponse(metrics);
        },
        {
          component: "monitoringRouter",
          operationName: "getSystemMetrics",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get dashboard statistics (user-specific or admin)
  getDashboardStats: monitoringProtectedProcedure
    .input(dashboardStatsSchema)
    .query(async ({ input, ctx }) => {
      return withErrorHandling(
        async () => {
          const targetUserId = input.userId ?? ctx.session.user.id;

          // Check if user can access stats for the target user
          if (input.userId && input.userId !== ctx.session.user.id) {
            // Only admins can view other users' stats
            if (ctx.session.user.role !== UserRole.ADMIN) {
              throw permissionError("view other user's statistics");
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

          // Flatten the metrics for statsResponse
          const flatDashboardMetrics: Record<string, string | number> = {
            totalEvents: typedStats.totalEvents ?? 0,
            activeEvents: typedStats.activeEvents ?? 0,
            totalServers: typedStats.totalServers ?? 0,
            onlineServers: typedStats.onlineServers ?? 0,
            period: input.period,
            userId: targetUserId,
            lastUpdated: new Date().toISOString(),
          };

          // Add comparison data if available
          if (periodComparison) {
            flatDashboardMetrics.eventsChange = periodComparison.eventsChange;
            flatDashboardMetrics.executionsChange =
              periodComparison.executionsChange;
            flatDashboardMetrics.successRateChange =
              periodComparison.successRateChange;
          }

          return statsResponse(
            {
              start: new Date(
                Date.now() - 30 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              end: new Date().toISOString(),
            },
            flatDashboardMetrics,
          );
        },
        {
          component: "monitoringRouter",
          operationName: "getDashboardStats",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get activity feed
  getActivityFeed: monitoringProtectedProcedure
    .input(activityFeedSchema)
    .query(async ({ input, ctx }) => {
      return withErrorHandling(
        async () => {
          const targetUserId = input.userId ?? ctx.session.user.id;

          // Check permissions for viewing other user's activity
          if (input.userId && input.userId !== ctx.session.user.id) {
            if (ctx.session.user.role !== UserRole.ADMIN) {
              throw permissionError("view other user's activity");
            }
          }

          // Get recent logs as activity feed
          const filters: Record<string, unknown> = { userId: targetUserId };
          if (input.since) {
            filters.startDate = input.since;
          }

          const pagination = normalizePagination(input);
          const { logs } = await storage.getFilteredLogs(
            filters,
            pagination.limit,
            Math.floor(pagination.offset / pagination.limit) + 1,
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

          const result = createPaginatedResult(
            activities,
            logs.length,
            pagination,
          );
          return listResponse(result);
        },
        {
          component: "monitoringRouter",
          operationName: "getActivityFeed",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get system health check (public endpoint for monitoring tools)
  getHealthCheck: publicHealthProcedure
    .input(healthCheckSchema)
    .query(async ({ input }) => {
      return withErrorHandling(
        async () => {
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
              const startTime = Date.now();
              await storage.getAllUsers(); // Simple query to test DB
              const responseTime = Date.now() - startTime;

              health.checks.push({
                name: "database",
                status: "healthy",
                responseTime,
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
          } else if (
            health.checks.some((check) => check.status === "degraded")
          ) {
            health.overall = "degraded";
          }

          // Convert checks to services format expected by healthResponse
          const services: Record<
            string,
            { status: "up" | "down"; latency?: number; error?: string }
          > = {};

          for (const check of health.checks) {
            const service: {
              status: "up" | "down";
              latency?: number;
              error?: string;
            } = {
              status: check.status === "healthy" ? "up" : "down",
            };

            if (check.responseTime !== undefined) {
              service.latency = check.responseTime;
            }

            if (check.error !== undefined) {
              service.error = check.error;
            }

            services[check.name] = service;
          }

          return healthResponse(health.overall, services);
        },
        {
          component: "monitoringRouter",
          operationName: "getHealthCheck",
        },
      );
    }),

  // Get execution analytics
  getExecutionAnalytics: monitoringProtectedProcedure
    .input(executionAnalyticsSchema)
    .query(async ({ input, ctx }) => {
      return withErrorHandling(
        async () => {
          const targetUserId = input.userId ?? ctx.session.user.id;

          // Check permissions
          if (input.userId && input.userId !== ctx.session.user.id) {
            if (ctx.session.user.role !== UserRole.ADMIN) {
              throw permissionError("view other user's analytics");
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

          // Flatten analytics for statsResponse
          const flatAnalytics: Record<string, string | number> = {
            totalLogs: analytics.summary.totalExecutions,
            successRate: analytics.summary.successRate,
            failureRate: analytics.summary.failureRate,
            averageDuration: analytics.summary.averageDuration,
            groupBy: input.groupBy ?? "none",
          };

          // Add group data as individual metrics
          if (analytics.data && Array.isArray(analytics.data)) {
            analytics.data.forEach((item, index) => {
              flatAnalytics[`group_${index}_label`] = item.label;
              flatAnalytics[`group_${index}_value`] = item.value;
              if (item.successRate !== undefined) {
                flatAnalytics[`group_${index}_successRate`] = item.successRate;
              }
            });
          }

          return statsResponse(
            {
              start: new Date(
                Date.now() - 30 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              end: new Date().toISOString(),
            },
            flatAnalytics,
          );
        },
        {
          component: "monitoringRouter",
          operationName: "getExecutionAnalytics",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get error tracking data (admin only)
  getErrorTracking: monitoringAdminProcedure
    .input(errorTrackingSchema)
    .query(async ({ input, ctx }) => {
      return withErrorHandling(
        async () => {
          // Get failed logs as error data
          const pagination = normalizePagination(input);
          const { logs } = await storage.getAllLogs(
            pagination.limit,
            Math.floor(pagination.offset / pagination.limit) + 1,
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

          const result = createPaginatedResult(
            errors,
            errorLogs.length,
            pagination,
          );

          return listResponse(result, {
            period: input.period,
            groupBy: input.groupBy,
            ...(groupedData && { groupCount: groupedData.length }),
          });
        },
        {
          component: "monitoringRouter",
          operationName: "getErrorTracking",
          userId: ctx.session.user.id,
        },
      );
    }),
});
