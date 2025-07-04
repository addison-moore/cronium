import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { scheduler } from "@/lib/scheduler";
import { initializeSystemTemplates } from "@/lib/template-seeding";
import { UserRole } from "@/shared/schema";

export const systemRouter = createTRPCRouter({
  // Get system health status
  healthCheck: protectedProcedure.query(async ({ ctx }) => {
    try {
      return {
        status: "ok",
        timestamp: new Date().toISOString(),
        user: ctx.session.user.email,
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
  startServices: adminProcedure.mutation(async ({ ctx }) => {
    try {
      // Initialize system templates first
      await initializeSystemTemplates();

      // Initialize the scheduler
      await scheduler.initialize();

      return {
        success: true,
        message: "Services initialized successfully",
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
      const isAdmin = ctx.session.user.role === UserRole.ADMIN;

      // Basic system info available to all users
      const systemInfo = {
        timestamp: new Date().toISOString(),
        userRole: ctx.session.user.role,
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
