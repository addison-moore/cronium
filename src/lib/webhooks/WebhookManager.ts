import { EventEmitter } from "events";
import crypto from "crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { webhooks, webhookEvents, webhookDeliveries } from "@/shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { storage } from "@/server/storage";
import { WebhookSecurity } from "./WebhookSecurity";
import { WebhookQueue } from "./WebhookQueue";
import { nanoid } from "nanoid";

// Webhook configuration schema
export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()),
  secret: z.string().optional(),
  headers: z.record(z.string()).optional(),
  active: z.boolean().default(true),
  retryConfig: z
    .object({
      maxRetries: z.number().default(3),
      retryDelay: z.number().default(1000),
      backoffMultiplier: z.number().default(2),
    })
    .optional(),
});

export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

export interface WebhookPayload {
  id: string;
  event: string;
  timestamp: Date;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface WebhookDeliveryResult {
  id: string;
  webhookId: number;
  success: boolean;
  statusCode?: number;
  response?: string;
  error?: string;
  duration: number;
  retryCount: number;
}

export class WebhookManager extends EventEmitter {
  private static instance: WebhookManager;
  private webhookQueue: WebhookQueue;
  private webhookSecurity: WebhookSecurity;

  private constructor() {
    super();
    this.webhookQueue = new WebhookQueue();
    this.webhookSecurity = new WebhookSecurity();
  }

  static getInstance(): WebhookManager {
    if (!WebhookManager.instance) {
      WebhookManager.instance = new WebhookManager();
    }
    return WebhookManager.instance;
  }

  /**
   * Register a new webhook
   */
  async registerWebhook(
    userId: string,
    config: WebhookConfig,
  ): Promise<{ id: number; key: string }> {
    const key = nanoid(32);
    const secretKey = config.secret ?? crypto.randomBytes(32).toString("hex");

    const result = await db
      .insert(webhooks)
      .values({
        userId,
        name: `Webhook ${new Date().toISOString()}`,
        url: config.url,
        events: config.events,
        secret: secretKey,
        headers: config.headers ?? {},
        active: config.active,
        retryConfig: config.retryConfig ?? {
          maxRetries: 3,
          retryDelay: 1000,
          backoffMultiplier: 2,
        },
        key,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    if (!result[0]) {
      throw new Error("Failed to create webhook");
    }

    return { id: result[0].id, key };
  }

  /**
   * Update webhook configuration
   */
  async updateWebhook(
    webhookId: number,
    userId: string,
    updates: Partial<WebhookConfig>,
  ): Promise<void> {
    await db
      .update(webhooks)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)));
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(webhookId: number, userId: string): Promise<void> {
    await db
      .delete(webhooks)
      .where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)));
  }

  /**
   * Get webhook by key
   */
  async getWebhookByKey(key: string) {
    const [webhook] = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.key, key))
      .limit(1);

    return webhook;
  }

  /**
   * List webhooks for a user
   */
  async listWebhooks(userId: string) {
    return await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.userId, userId))
      .orderBy(desc(webhooks.createdAt));
  }

  /**
   * Trigger a webhook event
   */
  async triggerEvent(
    event: string,
    data: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    // Use optimized query to find all active webhooks subscribed to this event
    const subscribedWebhooks = await storage.getActiveWebhooksForEvent(event);

    if (subscribedWebhooks.length === 0) {
      return;
    }

    // Create webhook event record
    const result = await db
      .insert(webhookEvents)
      .values({
        event,
        payload: { data, metadata },
        createdAt: new Date(),
      })
      .returning();

    if (!result[0]) {
      throw new Error("Failed to create webhook event");
    }

    const webhookEvent = result[0];

    // Queue deliveries for each webhook
    const payload: WebhookPayload = {
      id: webhookEvent.id.toString(),
      event,
      timestamp: webhookEvent.createdAt,
      data,
      ...(metadata !== undefined && { metadata }),
    };

    for (const webhook of subscribedWebhooks) {
      const retryConfig = webhook.retryConfig as
        | {
            maxRetries: number;
            retryDelay: number;
            backoffMultiplier: number;
          }
        | undefined;

      await this.webhookQueue.enqueue({
        webhookId: webhook.id,
        webhookEventId: webhookEvent.id,
        url: webhook.url,
        secret: webhook.secret,
        headers: webhook.headers as Record<string, string>,
        payload,
        ...(retryConfig !== undefined && { retryConfig }),
      });
    }

    this.emit("event:triggered", {
      event,
      webhookCount: subscribedWebhooks.length,
    });
  }

  /**
   * Process webhook delivery (called by queue)
   */
  async processDelivery(
    webhookId: number,
    webhookEventId: number,
    url: string,
    secret: string,
    headers: Record<string, string>,
    payload: WebhookPayload,
  ): Promise<WebhookDeliveryResult> {
    const startTime = Date.now();
    const deliveryId = nanoid();

    try {
      // Generate signature
      const signature = this.webhookSecurity.generateSignature(
        JSON.stringify(payload),
        secret,
      );

      // Prepare headers
      const requestHeaders = {
        "Content-Type": "application/json",
        "X-Webhook-Id": webhookId.toString(),
        "X-Webhook-Event": payload.event,
        "X-Webhook-Signature": signature,
        "X-Webhook-Timestamp": payload.timestamp.toISOString(),
        "X-Delivery-Id": deliveryId,
        ...headers,
      };

      // Send webhook
      const response = await fetch(url, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      const duration = Date.now() - startTime;
      const responseText = await response.text();

      // Record delivery
      await db.insert(webhookDeliveries).values({
        webhookId,
        webhookEventId,
        deliveryId,
        status: response.ok ? "success" : "failed",
        statusCode: response.status,
        response: responseText.substring(0, 1000), // Limit response size
        headers: requestHeaders,
        duration,
        attemptedAt: new Date(),
      });

      return {
        id: deliveryId,
        webhookId,
        success: response.ok,
        statusCode: response.status,
        response: responseText,
        duration,
        retryCount: 0,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Record failed delivery
      await db.insert(webhookDeliveries).values({
        webhookId,
        webhookEventId,
        deliveryId,
        status: "failed",
        error: errorMessage,
        headers: {},
        duration,
        attemptedAt: new Date(),
      });

      return {
        id: deliveryId,
        webhookId,
        success: false,
        error: errorMessage,
        duration,
        retryCount: 0,
      };
    }
  }

  /**
   * Get webhook event history
   */
  async getEventHistory(webhookId: number, limit = 100) {
    return await db
      .select({
        event: webhookEvents,
        delivery: webhookDeliveries,
      })
      .from(webhookDeliveries)
      .innerJoin(
        webhookEvents,
        eq(webhookDeliveries.webhookEventId, webhookEvents.id),
      )
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .orderBy(desc(webhookDeliveries.attemptedAt))
      .limit(limit);
  }

  /**
   * Retry failed webhook delivery
   */
  async retryDelivery(deliveryId: string): Promise<WebhookDeliveryResult> {
    // Use optimized query to get delivery with webhook and event in single query
    const result = await storage.getWebhookDeliveryWithRelations(deliveryId);

    if (!result) {
      throw new Error("Delivery not found");
    }

    const { delivery, webhook, event } = result;

    // Re-queue the delivery
    const retryConfig = webhook.retryConfig as
      | {
          maxRetries: number;
          retryDelay: number;
          backoffMultiplier: number;
        }
      | undefined;

    await this.webhookQueue.enqueue({
      webhookId: webhook.id,
      webhookEventId: event.id,
      url: webhook.url,
      secret: webhook.secret,
      headers: webhook.headers as Record<string, string>,
      payload: event.payload as WebhookPayload,
      ...(retryConfig !== undefined && { retryConfig }),
      isRetry: true,
    });

    return {
      id: deliveryId,
      webhookId: webhook.id,
      success: false,
      duration: 0,
      retryCount: 1,
    };
  }

  /**
   * Clean up old webhook events and deliveries
   */
  async cleanup(daysToKeep = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    // Delete old deliveries
    await db
      .delete(webhookDeliveries)
      .where(eq(webhookDeliveries.attemptedAt, cutoffDate));

    // Delete old events that have no deliveries
    const eventsWithDeliveries = db
      .select({ webhookEventId: webhookDeliveries.webhookEventId })
      .from(webhookDeliveries)
      .groupBy(webhookDeliveries.webhookEventId);

    await db
      .delete(webhookEvents)
      .where(
        and(
          eq(webhookEvents.createdAt, cutoffDate),
          eq(
            webhookEvents.id,
            eventsWithDeliveries as unknown as typeof webhookEvents.id,
          ),
        ),
      );
  }
}
