import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { scheduler } from "@/lib/scheduler";
import { UserRole } from "@/shared/schema";

export const systemRouter = createTRPCRouter({
  // Get system health status
  healthCheck: protectedProcedure.query(async ({ ctx }) => {
    try {
      return {
        status: "ok",
        timestamp: new Date().toISOString(),
        user: ctx.session.user.email ?? "Unknown",
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Health check failed",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }),

  // Initialize system services (admin only)
  startServices: adminProcedure.mutation(async () => {
    const results = [];

    try {
      // OLD TEMPLATE SYSTEM REMOVED - Now using tool action templates

      // Initialize the scheduler
      try {
        await scheduler.initialize();
        results.push("Scheduler initialized successfully");
      } catch (error) {
        console.warn("Scheduler initialization failed:", error);
        results.push("Scheduler initialization failed");
      }

      return {
        success: true,
        message: "Services initialization completed",
        details: results,
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to initialize services",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }),

  // Get system status information
  getSystemInfo: protectedProcedure.query(async ({ ctx }) => {
    try {
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
        return {
          ...systemInfo,
          nodeVersion: process.version,
          platform: process.platform,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
        };
      }

      return systemInfo;
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get system information",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }),
});
