import { EventEmitter } from "events";
import crypto from "crypto";
import { z } from "zod";
import axios from "axios";
import { db } from "@/server/db";
import { webhooks, webhookEvents, webhookDeliveries } from "@/shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { storage } from "@/server/storage";
import { WebhookSecurity } from "./WebhookSecurity";
import { WebhookQueue } from "./WebhookQueue";
import { nanoid } from "nanoid";
import {
  assertRequestUrlIsPublic,
  ssrfHttpAgent,
  ssrfHttpsAgent,
} from "@/lib/ssrf-guard";
import { SsrfBlockedError } from "@/lib/tools/safe-fetch";

// Cap the response body we buffer from a webhook target.
const MAX_WEBHOOK_RESPONSE_BYTES = 1 * 1024 * 1024;

// Webhook configuration schema
export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()),
  secret: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
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
   * Trigger a webhook event, fanning out only to the owning tenant's
   * subscriptions. `ownerUserId` is the tenant that produced the event (the
   * owner of the inbound webhook); it MUST be provided so one user's payload
   * can never reach another user's outbound webhook (HI-01).
   */
  async triggerEvent(
    event: string,
    data: Record<string, unknown>,
    ownerUserId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!ownerUserId) {
      throw new Error("triggerEvent requires an owning tenant userId");
    }

    // Fan out only to the owning tenant's active subscriptions.
    const subscribedWebhooks = await storage.getActiveWebhooksForEvent(
      event,
      ownerUserId,
    );

    if (subscribedWebhooks.length === 0) {
      return;
    }

    const sourceWebhookId =
      typeof metadata?.webhookId === "number" ? metadata.webhookId : null;

    // Create webhook event record, stamped with its owning tenant.
    const result = await db
      .insert(webhookEvents)
      .values({
        event,
        payload: { data, metadata },
        userId: ownerUserId,
        sourceWebhookId,
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

    // SSRF guard: reject internal/metadata/loopback targets before delivering.
    // A webhook URL is user-supplied, so outbound delivery is a server-side
    // fetch that must not be able to reach the control plane (HI-11).
    try {
      assertRequestUrlIsPublic(url);
    } catch (guardError) {
      if (guardError instanceof SsrfBlockedError) {
        const duration = Date.now() - startTime;
        await db.insert(webhookDeliveries).values({
          webhookId,
          webhookEventId,
          deliveryId,
          status: "failed",
          statusCode: 0,
          response: null,
          error: guardError.message,
          headers: {},
          duration,
          attemptedAt: new Date(),
        });
        return {
          id: deliveryId,
          webhookId,
          success: false,
          statusCode: 0,
          response: guardError.message,
          duration,
          retryCount: 0,
        };
      }
      throw guardError;
    }

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

      // Send webhook through the SSRF-guarded HTTP client: the guarded agents
      // re-validate the resolved IP at connect time (defeats DNS rebinding) and
      // redirects are not followed so a 3xx cannot bounce past the guard.
      const response = await axios.request({
        method: "POST",
        url,
        headers: requestHeaders,
        data: JSON.stringify(payload),
        timeout: 30000,
        httpAgent: ssrfHttpAgent,
        httpsAgent: ssrfHttpsAgent,
        maxRedirects: 0,
        maxContentLength: MAX_WEBHOOK_RESPONSE_BYTES,
        maxBodyLength: MAX_WEBHOOK_RESPONSE_BYTES,
        // Treat any status as a resolved response; we record the code.
        validateStatus: () => true,
        responseType: "text",
        transitional: { clarifyTimeoutError: true },
      });

      const duration = Date.now() - startTime;
      const responseText =
        typeof response.data === "string"
          ? response.data
          : JSON.stringify(response.data);
      const ok = response.status >= 200 && response.status < 300;

      // Record delivery
      await db.insert(webhookDeliveries).values({
        webhookId,
        webhookEventId,
        deliveryId,
        status: ok ? "success" : "failed",
        statusCode: response.status,
        response: responseText.substring(0, 1000), // Limit response size
        headers: requestHeaders,
        duration,
        attemptedAt: new Date(),
      });

      return {
        id: deliveryId,
        webhookId,
        success: ok,
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

    const { webhook, event } = result;

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
