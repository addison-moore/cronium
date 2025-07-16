import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import {
  WebhookManager,
  WebhookConfigSchema,
  type WebhookConfig,
} from "@/lib/webhooks";
import { TRPCError } from "@trpc/server";
import { webhooks, webhookDeliveries, webhookEvents } from "@/shared/schema";
import { eq, and, desc } from "drizzle-orm";

const webhookManager = WebhookManager.getInstance();

export const webhookSystemRouter = createTRPCRouter({
  // Create a new webhook
  create: protectedProcedure
    .input(WebhookConfigSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await webhookManager.registerWebhook(
          ctx.session.user.id,
          input,
        );

        return {
          id: result.id,
          key: result.key,
          url: `${process.env.PUBLIC_APP_URL ?? ""}/api/webhooks/${result.key}`,
        };
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create webhook",
        });
      }
    }),

  // List user's webhooks
  list: protectedProcedure.query(async ({ ctx }) => {
    const userWebhooks = await webhookManager.listWebhooks(ctx.session.user.id);

    return userWebhooks.map((webhook) => ({
      ...webhook,
      endpoint: `${process.env.PUBLIC_APP_URL ?? ""}/api/webhooks/${webhook.key}`,
    }));
  }),

  // Get webhook by ID
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const [webhook] = await ctx.db
        .select()
        .from(webhooks)
        .where(
          and(
            eq(webhooks.id, input.id),
            eq(webhooks.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!webhook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook not found",
        });
      }

      return {
        ...webhook,
        endpoint: `${process.env.PUBLIC_APP_URL ?? ""}/api/webhooks/${webhook.key}`,
      };
    }),

  // Update webhook
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        updates: WebhookConfigSchema.partial(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Partial<WebhookConfig> = {
        ...(input.updates.url !== undefined && { url: input.updates.url }),
        ...(input.updates.events !== undefined && {
          events: input.updates.events,
        }),
        ...(input.updates.secret !== undefined && {
          secret: input.updates.secret,
        }),
        ...(input.updates.headers !== undefined && {
          headers: input.updates.headers,
        }),
        ...(input.updates.active !== undefined && {
          active: input.updates.active,
        }),
        ...(input.updates.retryConfig !== undefined && {
          retryConfig: input.updates.retryConfig,
        }),
      };

      await webhookManager.updateWebhook(
        input.id,
        ctx.session.user.id,
        updates,
      );

      return { success: true };
    }),

  // Delete webhook
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await webhookManager.deleteWebhook(input.id, ctx.session.user.id);
      return { success: true };
    }),

  // Get webhook event history
  getEventHistory: protectedProcedure
    .input(
      z.object({
        webhookId: z.number(),
        limit: z.number().min(1).max(1000).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify webhook ownership
      const [webhook] = await ctx.db
        .select()
        .from(webhooks)
        .where(
          and(
            eq(webhooks.id, input.webhookId),
            eq(webhooks.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!webhook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook not found",
        });
      }

      const history = await webhookManager.getEventHistory(
        input.webhookId,
        input.limit,
      );

      return history;
    }),

  // Get webhook statistics
  getStats: protectedProcedure
    .input(z.object({ webhookId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Verify webhook ownership
      const [webhook] = await ctx.db
        .select()
        .from(webhooks)
        .where(
          and(
            eq(webhooks.id, input.webhookId),
            eq(webhooks.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!webhook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook not found",
        });
      }

      // Get delivery statistics
      const deliveries = await ctx.db
        .select({
          status: webhookDeliveries.status,
          count: ctx.db.$count(webhookDeliveries.id),
        })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookId, input.webhookId))
        .groupBy(webhookDeliveries.status);

      const stats = {
        total: 0,
        success: 0,
        failed: 0,
      };

      for (const delivery of deliveries) {
        stats.total += delivery.count;
        if (delivery.status === "success") {
          stats.success = delivery.count;
        } else if (delivery.status === "failed") {
          stats.failed = delivery.count;
        }
      }

      // Get recent events
      const recentEvents = await ctx.db
        .select()
        .from(webhookEvents)
        .innerJoin(
          webhookDeliveries,
          eq(webhookEvents.id, webhookDeliveries.webhookEventId),
        )
        .where(eq(webhookDeliveries.webhookId, input.webhookId))
        .orderBy(desc(webhookEvents.createdAt))
        .limit(10);

      return {
        stats,
        recentEvents: recentEvents.map((row) => ({
          event: row.webhook_events.event,
          createdAt: row.webhook_events.createdAt,
          status: row.webhook_deliveries.status,
          statusCode: row.webhook_deliveries.statusCode,
          duration: row.webhook_deliveries.duration,
        })),
      };
    }),

  // Retry failed webhook delivery
  retryDelivery: protectedProcedure
    .input(z.object({ deliveryId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify delivery ownership
      const [delivery] = await ctx.db
        .select({
          webhookUserId: webhooks.userId,
        })
        .from(webhookDeliveries)
        .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
        .where(eq(webhookDeliveries.deliveryId, input.deliveryId))
        .limit(1);

      if (!delivery || delivery.webhookUserId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Delivery not found",
        });
      }

      const result = await webhookManager.retryDelivery(input.deliveryId);
      return result;
    }),

  // Test webhook
  test: protectedProcedure
    .input(
      z.object({
        webhookId: z.number(),
        testData: z.record(z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify webhook ownership
      const [webhook] = await ctx.db
        .select()
        .from(webhooks)
        .where(
          and(
            eq(webhooks.id, input.webhookId),
            eq(webhooks.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (!webhook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook not found",
        });
      }

      // Trigger test event
      await webhookManager.triggerEvent(
        "webhook.test",
        {
          test: true,
          timestamp: new Date().toISOString(),
          ...input.testData,
        },
        {
          webhookId: input.webhookId,
          triggeredBy: ctx.session.user.id,
        },
      );

      return { success: true, message: "Test webhook sent" };
    }),

  // Generate new secret
  regenerateSecret: protectedProcedure
    .input(z.object({ webhookId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const webhookSecurity = new (
        await import("@/lib/webhooks")
      ).WebhookSecurity();
      const newSecret = webhookSecurity.generateSecret();

      await ctx.db
        .update(webhooks)
        .set({
          secret: newSecret,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(webhooks.id, input.webhookId),
            eq(webhooks.userId, ctx.session.user.id),
          ),
        );

      return { secret: newSecret };
    }),
});
