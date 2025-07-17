import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import { withErrorHandling } from "@/server/utils/error-utils";
import {
  resourceResponse,
  mutationResponse,
  healthResponse,
} from "@/server/utils/api-patterns";
import { scheduler } from "@/lib/scheduler";
import { UserRole } from "@/shared/schema";

export const systemRouter = createTRPCRouter({
  // Get system health status
  healthCheck: protectedProcedure.query(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        const health = {
          overall: "healthy" as "healthy" | "unhealthy" | "degraded",
          timestamp: new Date().toISOString(),
          checks: [
            {
              name: "authentication",
              status: "healthy",
              message: `Authenticated as ${ctx.session.user.email ?? "Unknown"}`,
            },
          ],
        };

        // Convert checks to services format for healthResponse
        const services: Record<
          string,
          { status: "up" | "down"; latency?: number; error?: string }
        > = {};
        for (const check of health.checks) {
          services[check.name] = {
            status: check.status === "healthy" ? "up" : "down",
          };
        }

        return healthResponse(health.overall, services);
      },
      {
        component: "systemRouter",
        operationName: "healthCheck",
        userId: ctx.session.user.id,
      },
    );
  }),

  // Initialize system services (admin only)
  startServices: adminProcedure.mutation(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        const results = [];

        // OLD TEMPLATE SYSTEM REMOVED - Now using tool action templates

        // Initialize the scheduler
        try {
          await scheduler.initialize();
          results.push("Scheduler initialized successfully");
        } catch (error) {
          console.warn("Scheduler initialization failed:", error);
          results.push("Scheduler initialization failed");
        }

        return mutationResponse(
          {
            success: true,
            message: "Services initialization completed",
            details: results,
          },
          "Services initialization completed",
        );
      },
      {
        component: "systemRouter",
        operationName: "startServices",
        userId: ctx.session.user.id,
      },
    );
  }),

  // Get system status information
  getSystemInfo: protectedProcedure.query(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        const userRole = ctx.session.user.role;
        const isAdmin = userRole === UserRole.ADMIN;

        // Basic system info available to all users
        const systemInfo = {
          timestamp: new Date().toISOString(),
          userRole,
          isHealthy: true,
        };

        // Additional info for admins
        if (isAdmin) {
          const extendedInfo = {
            ...systemInfo,
            nodeVersion: process.version,
            platform: process.platform,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
          };
          return resourceResponse(extendedInfo);
        }

        return resourceResponse(systemInfo);
      },
      {
        component: "systemRouter",
        operationName: "getSystemInfo",
        userId: ctx.session.user.id,
      },
    );
  }),
});
