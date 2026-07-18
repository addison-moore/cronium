/**
 * Monitoring Router — admin-only system health.
 *
 * Powers the Admin page's Monitoring tab:
 * - getHealthCheck: database / cache / memory / CPU health with latency
 * - getSystemMetrics: uptime, process memory, CPU load, OS info
 *
 * Deliberately contains NO event logs, activity feeds, or execution
 * analytics — those live on the Logs page. Docker/uptime probes use the
 * REST /api/health route, not this router.
 */

import {
  createTRPCRouter,
  adminProcedure,
  withTiming,
  withRateLimit,
} from "../trpc";
import { withErrorHandling } from "@/server/utils/error-utils";
import { resourceResponse, healthResponse } from "@/server/utils/api-patterns";
import {
  systemMetricsSchema,
  healthCheckSchema,
} from "@/shared/schemas/monitoring";
import { storage } from "@/server/storage";

// Helper types for monitoring data
export interface SystemInfo {
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
    const os = await import("os");
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    // 1-minute load average normalized to CPU count, as a percentage.
    // Real data with no extra dependencies (0 on platforms without loadavg).
    const cpuCount = os.cpus().length || 1;
    const [load1] = os.loadavg();
    const normalizedLoad = Math.min(((load1 ?? 0) / cpuCount) * 100, 100);

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
        currentLoad: normalizedLoad,
        systemLoad: normalizedLoad,
        userLoad: normalizedLoad,
      },
      os: {
        platform: process.platform,
        arch: process.arch,
        version: process.version,
        hostname: os.hostname(),
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

// Admin-only, rate-limited monitoring procedure
const monitoringAdminProcedure = adminProcedure
  .use(withTiming)
  .use(withRateLimit(200, 60000)); // 200 requests per minute

export const monitoringRouter = createTRPCRouter({
  // System health: database, cache, memory, CPU
  getHealthCheck: monitoringAdminProcedure
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

          // External services: check the cache (Redis/Valkey), the one
          // external dependency the app relies on at runtime
          if (input.includeExternalServices) {
            const { cacheService } = await import("@/lib/cache/cache-service");
            const cacheStart = Date.now();
            const cacheAvailable = cacheService.isAvailable();
            health.checks.push({
              name: "cache",
              status: cacheAvailable ? "healthy" : "degraded",
              responseTime: Date.now() - cacheStart,
              message: cacheAvailable
                ? "Cache (Valkey/Redis) is available"
                : "Cache (Valkey/Redis) is unavailable; falling back to degraded mode",
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

  // System metrics: uptime, process memory, CPU load, OS info
  getSystemMetrics: monitoringAdminProcedure
    .input(systemMetricsSchema)
    .query(async ({ input, ctx }) => {
      return withErrorHandling(
        async () => {
          const systemInfo = await getSystemInformation();

          const metrics = {
            current: systemInfo,
            historical: null,
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
});
