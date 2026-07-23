import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  withTiming,
} from "@/server/api/trpc";
import {
  WebhookManager,
  WebhookConfigSchema,
  type WebhookConfig,
} from "@/lib/webhooks";
import { withErrorHandling, notFoundError } from "@/server/utils/error-utils";
import {
  listResponse,
  resourceResponse,
  mutationResponse,
  statsResponse,
} from "@/server/utils/api-patterns";
import { webhooks, webhookDeliveries, webhookEvents } from "@/shared/schema";
import { eq, and, desc, count } from "drizzle-orm";

const webhookManager = WebhookManager.getInstance();

/**
 * Partial-update input. `WebhookConfigSchema.partial()` cannot express "only
 * the provided fields": under zod v4, `.partial()` still fires each field's
 * `.default()` for absent keys, so `active: z.boolean().default(true)` made
 * every partial update silently re-enable a disabled webhook. This schema is
 * the same shape without defaults; `secret` stays accepted-but-ignored
 * (rotation goes through regenerateSecret).
 */
const WebhookUpdateSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).optional(),
  secret: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  active: z.boolean().optional(),
  retryConfig: z
    .object({
      maxRetries: z.number().default(3),
      retryDelay: z.number().default(1000),
      backoffMultiplier: z.number().default(2),
    })
    .optional(),
});

/** True when a webhook has any custom headers configured, in either the
 * encrypted (`{ __enc }`) or legacy plaintext (`{ key: value }`) at-rest form. */
function hasConfiguredHeaders(stored: unknown): boolean {
  if (!stored || typeof stored !== "object") return false;
  return Object.keys(stored).length > 0;
}

export const webhookSystemRouter = createTRPCRouter({
  // Create a new webhook
  create: protectedProcedure
    .use(withTiming)
    .input(WebhookConfigSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const result = await webhookManager.registerWebhook(
            ctx.session.user.id,
            input,
          );

          return mutationResponse(
            {
              id: result.id,
              key: result.key,
              url: `${process.env.PUBLIC_APP_URL ?? ""}/api/webhooks/${result.key}`,
              // Shown once — the owner configures their sender's HMAC with it.
              secret: result.secret,
            },
            "Webhook created successfully",
          );
        },
        {
          component: "webhookSystemRouter",
          operationName: "create",
          userId: ctx.session.user.id,
        },
      );
    }),

  // List user's webhooks
  list: protectedProcedure.use(withTiming).query(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        const userWebhooks = await webhookManager.listWebhooks(
          ctx.session.user.id,
        );

        const webhooksWithEndpoints = userWebhooks.map((webhook) => ({
          ...webhook,
          // Never return the HMAC secret or credential-bearing custom headers on
          // a read (HI-09); report only that they are configured.
          secret: "",
          hasSecret: Boolean(webhook.secret),
          headers: {},
          hasHeaders: hasConfiguredHeaders(webhook.headers),
          endpoint: `${process.env.PUBLIC_APP_URL ?? ""}/api/webhooks/${webhook.key}`,
        }));

        return listResponse({
          items: webhooksWithEndpoints,
          total: webhooksWithEndpoints.length,
          hasMore: false,
          limit: 100,
          offset: 0,
        });
      },
      {
        component: "webhookSystemRouter",
        operationName: "list",
        userId: ctx.session.user.id,
      },
    );
  }),

  // Get webhook by ID
  get: protectedProcedure
    .use(withTiming)
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
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
            throw notFoundError("Webhook");
          }

          return resourceResponse({
            ...webhook,
            secret: "",
            hasSecret: Boolean(webhook.secret),
            headers: {},
            hasHeaders: hasConfiguredHeaders(webhook.headers),
            endpoint: `${process.env.PUBLIC_APP_URL ?? ""}/api/webhooks/${webhook.key}`,
          });
        },
        {
          component: "webhookSystemRouter",
          operationName: "get",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Update webhook
  update: protectedProcedure
    .use(withTiming)
    .input(
      z.object({
        id: z.number(),
        updates: WebhookUpdateSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const updates: Partial<WebhookConfig> = {
            ...(input.updates.url !== undefined && { url: input.updates.url }),
            ...(input.updates.events !== undefined && {
              events: input.updates.events,
            }),
            // The HMAC secret is not changed here — use regenerateSecret, which
            // encrypts and returns the new plaintext once.
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

          return mutationResponse(
            { id: input.id },
            "Webhook updated successfully",
          );
        },
        {
          component: "webhookSystemRouter",
          operationName: "update",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Delete webhook
  delete: protectedProcedure
    .use(withTiming)
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          await webhookManager.deleteWebhook(input.id, ctx.session.user.id);

          return mutationResponse(
            { id: input.id },
            "Webhook deleted successfully",
          );
        },
        {
          component: "webhookSystemRouter",
          operationName: "delete",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get webhook event history
  getEventHistory: protectedProcedure
    .use(withTiming)
    .input(
      z.object({
        webhookId: z.number(),
        limit: z.number().min(1).max(1000).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
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
            throw notFoundError("Webhook");
          }

          const history = await webhookManager.getEventHistory(
            input.webhookId,
            input.limit,
          );

          return listResponse({
            items: history,
            total: history.length,
            hasMore: false,
            limit: input.limit,
            offset: 0,
          });
        },
        {
          component: "webhookSystemRouter",
          operationName: "getEventHistory",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get webhook statistics
  getStats: protectedProcedure
    .use(withTiming)
    .input(z.object({ webhookId: z.number() }))
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
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
            throw notFoundError("Webhook");
          }

          // Get delivery statistics
          const deliveries = await ctx.db
            .select({
              status: webhookDeliveries.status,
              // count() aggregate, not db.$count(column): $count embeds a
              // `(select count(*) from <source>)` subquery and treating a
              // column as the source rendered `from "id"` — invalid SQL that
              // made this query fail on every call.
              count: count(webhookDeliveries.id),
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

          const recentEventsData = recentEvents.map((row) => ({
            event: row.webhook_events.event,
            createdAt: row.webhook_events.createdAt,
            status: row.webhook_deliveries.status,
            statusCode: row.webhook_deliveries.statusCode,
            duration: row.webhook_deliveries.duration,
          }));

          const metrics: Record<string, string | number> = {
            totalDeliveries: stats.total,
            successfulDeliveries: stats.success,
            failedDeliveries: stats.failed,
            recentEventsCount: recentEventsData.length,
          };

          return statsResponse(
            {
              start: new Date(
                Date.now() - 30 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              end: new Date().toISOString(),
            },
            metrics,
          );
        },
        {
          component: "webhookSystemRouter",
          operationName: "getStats",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Retry failed webhook delivery
  retryDelivery: protectedProcedure
    .use(withTiming)
    .input(z.object({ deliveryId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // Verify delivery ownership
          const [delivery] = await ctx.db
            .select({
              webhookUserId: webhooks.userId,
            })
            .from(webhookDeliveries)
            .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
            .where(eq(webhookDeliveries.deliveryId, input.deliveryId))
            .limit(1);

          if (delivery?.webhookUserId !== ctx.session.user.id) {
            throw notFoundError("Delivery");
          }

          const result = await webhookManager.retryDelivery(input.deliveryId);

          return mutationResponse(result, "Webhook delivery retry initiated");
        },
        {
          component: "webhookSystemRouter",
          operationName: "retryDelivery",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Test webhook
  test: protectedProcedure
    .use(withTiming)
    .input(
      z.object({
        webhookId: z.number(),
        testData: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
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
            throw notFoundError("Webhook");
          }

          // Trigger test event within the caller's own tenant.
          await webhookManager.triggerEvent(
            "webhook.test",
            {
              test: true,
              timestamp: new Date().toISOString(),
              ...input.testData,
            },
            webhook.userId,
            {
              webhookId: input.webhookId,
              triggeredBy: ctx.session.user.id,
            },
          );

          return mutationResponse(
            { webhookId: input.webhookId },
            "Test webhook sent",
          );
        },
        {
          component: "webhookSystemRouter",
          operationName: "test",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Generate new secret
  regenerateSecret: protectedProcedure
    .use(withTiming)
    .input(z.object({ webhookId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // Look up the webhook (owner-scoped) to bind the new secret's
          // encryption to its key/tenant.
          const [webhook] = await ctx.db
            .select({ key: webhooks.key })
            .from(webhooks)
            .where(
              and(
                eq(webhooks.id, input.webhookId),
                eq(webhooks.userId, ctx.session.user.id),
              ),
            )
            .limit(1);
          if (!webhook) {
            throw notFoundError("Webhook");
          }

          const webhookSecurity = new (
            await import("@/lib/webhooks")
          ).WebhookSecurity();
          const newSecret = webhookSecurity.generateSecret();
          const { encryptWebhookSecret } =
            await import("@/lib/webhooks/webhook-secret");

          await ctx.db
            .update(webhooks)
            .set({
              secret: encryptWebhookSecret(
                newSecret,
                webhook.key,
                ctx.session.user.id,
              ),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(webhooks.id, input.webhookId),
                eq(webhooks.userId, ctx.session.user.id),
              ),
            );

          // Return the plaintext once so the owner can update their sender.
          return mutationResponse(
            { secret: newSecret },
            "Webhook secret regenerated successfully",
          );
        },
        {
          component: "webhookSystemRouter",
          operationName: "regenerateSecret",
          userId: ctx.session.user.id,
        },
      );
    }),
});
