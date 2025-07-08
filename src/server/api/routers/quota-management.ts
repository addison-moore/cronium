import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "@/server/api/trpc";
import {
  QuotaManager,
  QuotaConfigSchema,
  RateLimiter,
  QuotaEnforcer,
  UsageReporter,
  type RateLimitKey,
  type QuotaConfig,
  type RateLimitConfig,
} from "@/lib/rate-limiting";
import { TRPCError } from "@trpc/server";

const quotaManager = QuotaManager.getInstance();
const rateLimiter = RateLimiter.getInstance();
const quotaEnforcer = QuotaEnforcer.getInstance();
const usageReporter = UsageReporter.getInstance();

export const quotaManagementRouter = createTRPCRouter({
  // Get current quota status
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const status = await quotaManager.getQuotaStatus(ctx.session.user.id);
    return status;
  }),

  // Get usage metrics
  getMetrics: protectedProcedure
    .input(
      z.object({
        period: z.enum(["day", "week", "month"]).default("month"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const metrics = await usageReporter.getUserMetrics(
        ctx.session.user.id,
        input.period,
      );
      return metrics;
    }),

  // Get usage trends
  getTrends: protectedProcedure.query(async ({ ctx }) => {
    const trends = await usageReporter.getUserTrends(ctx.session.user.id);
    return trends;
  }),

  // Get quota summary with recommendations
  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const summary = await usageReporter.getQuotaSummary(ctx.session.user.id);
    return summary;
  }),

  // Export usage report
  exportReport: protectedProcedure
    .input(
      z.object({
        format: z.enum(["json", "csv"]).default("json"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const report = await usageReporter.exportUsageReport(
        ctx.session.user.id,
        input.format,
      );
      return {
        data: report,
        filename: `usage-report-${new Date().toISOString()}.${input.format}`,
      };
    }),

  // Check specific quota
  checkQuota: protectedProcedure
    .input(
      z.object({
        resource: z.string(),
        amount: z.number().default(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await quotaManager.checkQuota(
        ctx.session.user.id,
        input.resource as any,
        input.amount,
      );
      return result;
    }),

  // Admin: Update user quota
  updateUserQuota: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        quotas: QuotaConfigSchema.partial(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Filter out undefined values to satisfy exactOptionalPropertyTypes
      const quotaUpdates = Object.entries(input.quotas).reduce(
        (acc, [key, value]) => {
          if (value !== undefined) {
            acc[key as keyof typeof input.quotas] = value;
          }
          return acc;
        },
        {} as Partial<QuotaConfig>,
      );
      await quotaManager.updateUserQuota(input.userId, quotaUpdates);
      return { success: true };
    }),

  // Admin: Reset user quotas
  resetUserQuotas: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        resources: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await quotaManager.resetQuotas(input.userId, input.resources as any);
      return { success: true };
    }),

  // Admin: Get rate limit statistics
  getRateLimitStats: adminProcedure.query(async () => {
    const stats = await rateLimiter.getStatistics();
    return stats;
  }),

  // Get rate limit status for current user
  getRateLimitStatus: protectedProcedure
    .input(
      z.object({
        key: z.object({
          type: z.enum(["user", "ip", "api_key", "tool", "webhook", "custom"]),
          identifier: z.string(),
          subIdentifier: z.string().optional(),
        }),
        config: z
          .object({
            windowMs: z.number().optional(),
            maxRequests: z.number().optional(),
          })
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify user can only check their own limits
      if (
        input.key.type === "user" &&
        input.key.identifier !== ctx.session.user.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot check rate limits for other users",
        });
      }

      // Filter out undefined subIdentifier to satisfy exactOptionalPropertyTypes
      const rateLimitKey: RateLimitKey = {
        type: input.key.type,
        identifier: input.key.identifier,
        ...(input.key.subIdentifier !== undefined && {
          subIdentifier: input.key.subIdentifier,
        }),
      };
      // Filter out undefined values from config to satisfy exactOptionalPropertyTypes
      const config = input.config
        ? Object.entries(input.config).reduce((acc, [key, value]) => {
            if (value !== undefined) {
              acc[key as keyof typeof input.config] = value;
            }
            return acc;
          }, {} as Partial<RateLimitConfig>)
        : undefined;
      const status = await rateLimiter.getStatus(rateLimitKey, config);
      return status;
    }),

  // Get all quotas and limits configuration
  getConfiguration: protectedProcedure.query(async ({ ctx }) => {
    const userQuota = await quotaManager.getQuotaStatus(ctx.session.user.id);
    // TODO: Implement getEnforcementRules method in QuotaEnforcer
    // const enforcementRules = quotaEnforcer.getEnforcementRules();

    return {
      quotas: userQuota,
      rules: {}, // TODO: Add enforcement rules when implemented
      features: {
        toolActions: {
          name: "Tool Actions",
          description: "Execute actions from integrated tools",
          quotas: {
            monthly: userQuota.toolActions,
            daily: await quotaManager.checkQuota(
              ctx.session.user.id,
              "toolActionsPerDay",
            ),
          },
        },
        webhooks: {
          name: "Webhooks",
          description: "Create and manage webhook endpoints",
          quotas: {
            total: userQuota.webhooks,
            monthlyEvents: await quotaManager.checkQuota(
              ctx.session.user.id,
              "webhookEventsPerMonth",
            ),
          },
        },
        events: {
          name: "Events/Scripts",
          description: "Create scheduled scripts and automations",
          quotas: {
            total: userQuota.events,
            monthlyExecutions: await quotaManager.checkQuota(
              ctx.session.user.id,
              "eventExecutionsPerMonth",
            ),
          },
        },
        workflows: {
          name: "Workflows",
          description: "Build multi-step automation workflows",
          quotas: {
            total: userQuota.workflows,
            monthlyExecutions: await quotaManager.checkQuota(
              ctx.session.user.id,
              "workflowExecutionsPerMonth",
            ),
          },
        },
        storage: {
          name: "Storage",
          description: "Store logs, files, and execution data",
          quotas: {
            totalMB: userQuota.storage,
          },
        },
        api: {
          name: "API Access",
          description: "Programmatic access via API",
          quotas: {
            monthly: userQuota.apiRequests,
            perMinute: await quotaManager.checkQuota(
              ctx.session.user.id,
              "apiRequestsPerMinute",
            ),
          },
        },
      },
    };
  }),
});
