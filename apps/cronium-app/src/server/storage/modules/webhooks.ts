import { db } from "../../db";
import {
  webhooks,
  webhookDeliveries,
  webhookEvents,
} from "../../../shared/schema";
import { eq, and, or, desc, sql, count } from "drizzle-orm";

export class WebhookStorage {
  async getActiveWebhooksForEvent(
    event: string,
  ): Promise<(typeof webhooks.$inferSelect)[]> {
    // Optimized query that filters by event subscription in the database
    const activeWebhooks = await db
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.active, true),
          or(
            sql`${webhooks.events}::jsonb @> ${JSON.stringify([event])}::jsonb`,
            sql`${webhooks.events}::jsonb @> ${JSON.stringify(["*"])}::jsonb`,
          ),
        ),
      );

    return activeWebhooks;
  }

  async getWebhookDeliveryWithRelations(deliveryId: string): Promise<{
    delivery: typeof webhookDeliveries.$inferSelect;
    webhook: typeof webhooks.$inferSelect;
    event: typeof webhookEvents.$inferSelect;
  } | null> {
    // Single query to get delivery with webhook and event data
    const result = await db
      .select({
        delivery: webhookDeliveries,
        webhook: webhooks,
        event: webhookEvents,
      })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
      .innerJoin(
        webhookEvents,
        eq(webhookDeliveries.webhookEventId, webhookEvents.id),
      )
      .where(eq(webhookDeliveries.deliveryId, deliveryId))
      .limit(1);

    return result[0] ?? null;
  }

  async getUserWebhooksWithStats(userId: string): Promise<
    Array<{
      webhook: typeof webhooks.$inferSelect;
      totalDeliveries: number;
      successfulDeliveries: number;
      failedDeliveries: number;
    }>
  > {
    // Optimized query to get webhooks with delivery statistics
    const result = await db
      .select({
        webhook: webhooks,
        totalDeliveries: count(webhookDeliveries.id),
        successfulDeliveries: sql<number>`COUNT(CASE WHEN ${webhookDeliveries.status} = 'success' THEN 1 END)`,
        failedDeliveries: sql<number>`COUNT(CASE WHEN ${webhookDeliveries.status} = 'failed' THEN 1 END)`,
      })
      .from(webhooks)
      .leftJoin(webhookDeliveries, eq(webhooks.id, webhookDeliveries.webhookId))
      .where(eq(webhooks.userId, userId))
      .groupBy(webhooks.id)
      .orderBy(desc(webhooks.createdAt));

    return result;
  }
}
