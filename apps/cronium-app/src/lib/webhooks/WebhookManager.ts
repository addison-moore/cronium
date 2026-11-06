import crypto from "crypto";
import type { Readable } from "stream";
import { z } from "zod";
import axios from "axios";
import { db } from "@/server/db";
import { webhooks, webhookEvents, webhookDeliveries } from "@/shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { storage } from "@/server/storage";
import { WebhookSecurity } from "./WebhookSecurity";
import { WebhookQueue } from "./WebhookQueue";
import { readResponseBody, WEBHOOK_TIMEOUT_MS } from "./response-body";
import { nanoid } from "nanoid";
import {
  assertRequestUrlIsPublic,
  ssrfHttpAgent,
  ssrfHttpsAgent,
} from "@/lib/ssrf-guard";
import { SsrfBlockedError } from "@/lib/tools/safe-fetch";
import { describeFailure } from "@/lib/pg-errors";
import { pgStorableText } from "@/lib/pg-text";
import { webhookRetryConfigSchema } from "./retry-config-schema";
import {
  headerKey,
  splitCustomHeaders,
  webhookCustomHeadersSchema,
} from "./custom-headers";
import { WebhookPreconditionError } from "./webhook-errors";

// Cap the response body we buffer from a webhook target.
const MAX_WEBHOOK_RESPONSE_BYTES = 1 * 1024 * 1024;
// How much of it a delivery keeps and reports.
const MAX_RECORDED_RESPONSE_CHARS = 1000;

// Webhook configuration schema
export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()),
  secret: z.string().optional(),
  headers: webhookCustomHeadersSchema.optional(),
  active: z.boolean().default(true),
  retryConfig: webhookRetryConfigSchema.optional(),
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
  /** What the receiver did. Failing to record the attempt doesn't change it. */
  success: boolean;
  /** Only there when the attempt's row couldn't be stored: no history shows it. */
  recorded?: false;
  statusCode?: number;
  response?: string;
  /**
   * Why there's no status. Alongside a status, why `response` is only part of the
   * answer, which doesn't change what the status means.
   */
  error?: string;
  duration: number;
}

/**
 * What `triggerEvent` stores in `webhook_events.payload`: the part of a delivery
 * body that the row's columns don't hold. Strict, because `WebhookRouter` writes
 * to the same table. Its rows record what came in, with the request's body merged
 * in, so they can have a `data` and `metadata` of their own, and no delivery is
 * ever sent from them.
 */
const storedEventContentSchema = z.strictObject({
  data: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** The delivery body for a stored event. A retry has to produce what the first
 * attempt sent, so both build it here. */
function deliveryPayload(
  event: typeof webhookEvents.$inferSelect,
  data: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): WebhookPayload {
  return {
    id: event.id.toString(),
    event: event.event,
    timestamp: event.createdAt,
    data,
    ...(metadata !== undefined && { metadata }),
  };
}

export class WebhookManager {
  private static instance: WebhookManager;
  private webhookQueue: WebhookQueue;
  private webhookSecurity: WebhookSecurity;

  private constructor() {
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
  ): Promise<{ id: number; key: string; secret: string }> {
    const key = nanoid(32);
    const secretKey = config.secret ?? crypto.randomBytes(32).toString("hex");
    // Encrypt the shared HMAC secret and any credential-bearing custom headers
    // at rest (bound to this webhook).
    const { encryptWebhookSecret, encryptWebhookHeaders } =
      await import("./webhook-secret");
    const storedSecret = encryptWebhookSecret(secretKey, key, userId);
    const storedHeaders = encryptWebhookHeaders(config.headers, key, userId);

    const result = await db
      .insert(webhooks)
      .values({
        userId,
        name: `Webhook ${new Date().toISOString()}`,
        url: config.url,
        events: config.events,
        secret: storedSecret,
        headers: storedHeaders,
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

    // Return the plaintext secret ONCE so the owner can configure their sender.
    return { id: result[0].id, key, secret: secretKey };
  }

  /**
   * Update webhook configuration
   */
  async updateWebhook(
    webhookId: number,
    userId: string,
    updates: Partial<WebhookConfig>,
  ): Promise<void> {
    const { headers, secret: _secret, ...rest } = updates;
    const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };

    // Re-encrypt custom headers under the webhook's binding when they change;
    // never persist a plaintext credential header. (Secret rotation goes through
    // the dedicated regenerate path, so a raw `secret` in updates is ignored.)
    if (headers !== undefined) {
      const [existing] = await db
        .select({ key: webhooks.key })
        .from(webhooks)
        .where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)))
        .limit(1);
      if (!existing) return;
      const { encryptWebhookHeaders } = await import("./webhook-secret");
      set.headers = encryptWebhookHeaders(headers, existing.key, userId);
    }

    await db
      .update(webhooks)
      .set(set)
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

    const webhookEvent = await this.recordEvent(
      event,
      data,
      ownerUserId,
      metadata,
    );

    // Queue deliveries for each webhook
    const payload = deliveryPayload(webhookEvent, data, metadata);

    const { decryptWebhookSecret, decryptWebhookHeaders } =
      await import("./webhook-secret");
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
        // Decrypt at the delivery-signing boundary.
        secret: decryptWebhookSecret(
          webhook.secret,
          webhook.key,
          webhook.userId,
        ),
        headers: decryptWebhookHeaders(
          webhook.headers,
          webhook.key,
          webhook.userId,
        ),
        payload,
        ...(retryConfig !== undefined && { retryConfig }),
      });
    }
  }

  /**
   * Send a test event to this one webhook, whatever it subscribes to, and report
   * what the receiver did.
   *
   * It doesn't fan out, so no other webhook gets anything. It makes one attempt
   * and waits for it, so the outcome it returns is real. It stays out of the queue,
   * which could only say the attempt was queued, and which would repeat a failure
   * on its own schedule after the caller had moved on.
   *
   * The attempt is recorded like any other delivery, on a `webhook_events` row of
   * its own in the form `triggerEvent` stores. So it shows in the webhook's history
   * and stats, under `webhook.test`, and can be retried.
   *
   * @throws WebhookPreconditionError when the webhook is disabled. Nothing is sent
   * or recorded then. A failed attempt isn't thrown: it comes back with
   * `success: false`, recorded like any other.
   */
  async sendTestEvent(
    webhook: typeof webhooks.$inferSelect,
    data: Record<string, unknown>,
    metadata: Record<string, unknown>,
  ): Promise<WebhookDeliveryResult> {
    // Disabled means nothing goes to this URL, as with `triggerEvent`.
    if (!webhook.active) {
      throw new WebhookPreconditionError("Webhook is disabled");
    }

    // Decrypted before anything is recorded: a secret that can't be read means
    // there was no attempt.
    const { decryptWebhookSecret, decryptWebhookHeaders } =
      await import("./webhook-secret");
    const secret = decryptWebhookSecret(
      webhook.secret,
      webhook.key,
      webhook.userId,
    );
    const headers = decryptWebhookHeaders(
      webhook.headers,
      webhook.key,
      webhook.userId,
    );

    const event = await this.recordEvent(
      "webhook.test",
      data,
      webhook.userId,
      metadata,
    );

    return this.processDelivery(
      webhook.id,
      event.id,
      webhook.url,
      secret,
      headers,
      deliveryPayload(event, data, metadata),
    );
  }

  /**
   * Store an event that's about to be delivered, stamped with its owning tenant.
   * Its `payload` is the part of a delivery body that the row's columns don't hold.
   */
  private async recordEvent(
    event: string,
    data: Record<string, unknown>,
    ownerUserId: string,
    metadata?: Record<string, unknown>,
  ) {
    const sourceWebhookId =
      typeof metadata?.webhookId === "number" ? metadata.webhookId : null;

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

    return result[0];
  }

  /**
   * Store an attempt and return its result, marked if the row wouldn't go in.
   *
   * The attempt is over by now, so a row that won't go in can't change what the
   * receiver did. A 2xx stays a success and the queue doesn't send it again:
   * that wouldn't get the row written, and the receiver would get an event it has
   * already taken. No other row stands in for it, because a failed one would say
   * the receiver didn't take it. The history has a gap, and the server log says
   * what fell into it.
   */
  private async recordAttempt(
    row: typeof webhookDeliveries.$inferInsert,
    result: WebhookDeliveryResult,
  ): Promise<WebhookDeliveryResult> {
    try {
      await db.insert(webhookDeliveries).values(row);
      return result;
    } catch (error) {
      console.error(
        `[Webhook] Delivery ${row.deliveryId} of event ${row.webhookEventId} to webhook ${row.webhookId} (${row.status}, status code ${row.statusCode ?? "none"}) wasn't recorded: ${describeFailure(error)}`,
      );
      return { ...result, recorded: false };
    }
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
        const reason = pgStorableText(guardError.message);
        const row = {
          webhookId,
          webhookEventId,
          deliveryId,
          status: "failed",
          statusCode: 0,
          response: null,
          error: reason,
          headers: {},
          duration,
          attemptedAt: new Date(),
        };
        const result: WebhookDeliveryResult = {
          id: deliveryId,
          webhookId,
          success: false,
          statusCode: 0,
          error: reason,
          duration,
        };
        return this.recordAttempt(row, result);
      }
      throw guardError;
    }

    let row: typeof webhookDeliveries.$inferInsert;
    let result: WebhookDeliveryResult;

    try {
      const rawBody = JSON.stringify(payload);
      // When this attempt is made. The body's `timestamp` and `X-Webhook-Timestamp`
      // are the event's and stay the same on every attempt, so neither can tell a
      // late retry from a replayed request.
      const attemptTimestamp = new Date().toISOString();

      // Generate signatures. `X-Webhook-Signature` stays over the body alone, because
      // receivers verify it that way; `X-Webhook-Signature-V2` also covers the
      // attempt. docs/WEBHOOKS.md tells receivers how to check them.
      const signature = this.webhookSecurity.generateSignature(rawBody, secret);
      const signatureV2 = this.webhookSecurity.generateDeliverySignature(
        attemptTimestamp,
        deliveryId,
        rawBody,
        secret,
      );

      // Prepare headers
      const systemHeaders = {
        "Content-Type": "application/json",
        "X-Webhook-Id": webhookId.toString(),
        "X-Webhook-Event": payload.event,
        "X-Webhook-Timestamp": payload.timestamp.toISOString(),
        "X-Delivery-Id": deliveryId,
      };
      const {
        sendable: customHeaders,
        ignored,
        invalidNames,
      } = splitCustomHeaders(headers);
      if (ignored.length > 0) {
        console.warn(
          `Webhook ${webhookId}: left out custom headers that only Cronium can set (${ignored.join(", ")}). Update the webhook's headers to remove them.`,
        );
      }
      // Recorded below like any failed attempt. Node would refuse these anyway, but
      // its message repeats the whole name, which can hold a credential pasted in by
      // mistake, and webhook_deliveries isn't encrypted.
      if (invalidNames.length > 0) {
        throw new Error(
          `Nothing was sent, because these custom header names aren't valid in HTTP: ${invalidNames.map((start) => `"${start}…"`).join(", ")}. Set the webhook's headers again without them.`,
        );
      }
      const requestHeaders = {
        ...systemHeaders,
        "X-Delivery-Timestamp": attemptTimestamp,
        "X-Webhook-Signature": signature,
        "X-Webhook-Signature-V2": signatureV2,
        ...customHeaders,
      };
      // What the delivery record keeps. `headers` was decrypted just to make this
      // request (HI-09), and they are usually credentials, so only their names
      // survive; webhook_deliveries is not encrypted and is returned by the
      // history API. The signatures and the attempt's time stay out too. That time
      // is close to `attempted_at` less `duration`: the column is set when the attempt
      // ends, up to 30 seconds after it starts.
      // A system header a custom one replaced wasn't sent, in any letter case.
      const customKeys = new Set(Object.keys(customHeaders).map(headerKey));
      const recordedHeaders = {
        ...Object.fromEntries(
          Object.entries(systemHeaders).filter(
            ([name]) => !customKeys.has(headerKey(name)),
          ),
        ),
        ...Object.fromEntries(
          Object.keys(customHeaders).map((name) => [name, "[redacted]"]),
        ),
      };

      // Send webhook through the SSRF-guarded HTTP client: the guarded agents
      // re-validate the resolved IP at connect time (defeats DNS rebinding), a
      // proxy from the environment is ignored because it would resolve the host
      // itself, out of the guard's sight, and redirects are not followed so a
      // 3xx cannot bounce past the guard.
      const response = await axios.request<Readable>({
        method: "POST",
        url,
        headers: requestHeaders,
        data: rawBody,
        timeout: WEBHOOK_TIMEOUT_MS,
        httpAgent: ssrfHttpAgent,
        httpsAgent: ssrfHttpsAgent,
        proxy: false,
        maxRedirects: 0,
        maxBodyLength: MAX_WEBHOOK_RESPONSE_BYTES,
        // Treat any status as a resolved response; we record the code.
        validateStatus: () => true,
        // A stream hands over the status before the body. With a buffered response,
        // a body past the cap or cut off rejects this call, and the status is lost.
        responseType: "stream",
        transitional: { clarifyTimeoutError: true },
      });

      // The status is the receiver's answer, and the body is kept only for the record,
      // so a body that doesn't finish changes what's recorded and nothing else. A 2xx
      // is a success however its body ends, and the queue doesn't send it again. The
      // cost falls on a receiver that sends its 2xx before doing the work and then
      // dies, which would lose the event just the same if its body had finished.
      // `error` shows these attempts in the history, and a person can retry one.
      const { text, unfinished } = await readResponseBody(
        response.data,
        MAX_WEBHOOK_RESPONSE_BYTES,
        WEBHOOK_TIMEOUT_MS,
      );

      const duration = Date.now() - startTime;
      const recordedResponse = pgStorableText(
        text.substring(0, MAX_RECORDED_RESPONSE_CHARS),
      );
      const bodyError =
        unfinished === undefined ? undefined : pgStorableText(unfinished);
      const ok = response.status >= 200 && response.status < 300;

      row = {
        webhookId,
        webhookEventId,
        deliveryId,
        status: ok ? "success" : "failed",
        statusCode: response.status,
        response: recordedResponse,
        error: bodyError,
        headers: recordedHeaders,
        duration,
        attemptedAt: new Date(),
      };

      result = {
        id: deliveryId,
        webhookId,
        success: ok,
        statusCode: response.status,
        response: recordedResponse,
        ...(bodyError !== undefined && { error: bodyError }),
        duration,
      };
    } catch (error) {
      // The request couldn't be made or got no answer. An error can quote what it was
      // given, as Node does with a header name, so its message may not be storable.
      const duration = Date.now() - startTime;
      const errorMessage = pgStorableText(
        error instanceof Error ? error.message : "Unknown error",
      );

      row = {
        webhookId,
        webhookEventId,
        deliveryId,
        status: "failed",
        error: errorMessage,
        headers: {},
        duration,
        attemptedAt: new Date(),
      };

      result = {
        id: deliveryId,
        webhookId,
        success: false,
        error: errorMessage,
        duration,
      };
    }

    // Outside the try, whose catch means the request failed.
    return this.recordAttempt(row, result);
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
   * Send a recorded delivery's event to its webhook again, and report what the
   * receiver did.
   *
   * The body is the original event, rebuilt from its row. Its `id` stays the same,
   * so a receiver can tell it's the same event. Its `timestamp` is the event's, in
   * the body and in `X-Webhook-Timestamp`, and `X-Delivery-Id` and
   * `X-Delivery-Timestamp` are new because they name one attempt; all of that is
   * what an automatic retry sends. jsonb doesn't keep key order, so the bytes and
   * therefore `X-Webhook-Signature` can differ from the first attempt's even under
   * the same secret. The URL, secret and headers are the webhook's current ones.
   *
   * This makes one attempt and waits for it, so the outcome it returns is real. It
   * stays out of the queue, which could only say the attempt was queued, and which
   * would repeat a failure on its own schedule after the caller had moved on.
   *
   * @throws WebhookPreconditionError when it won't send. Nothing is sent or
   * recorded then. A failed attempt isn't thrown: it comes back with
   * `success: false`, recorded like any other.
   */
  async retryDelivery(deliveryId: string): Promise<WebhookDeliveryResult> {
    // Use optimized query to get delivery with webhook and event in single query
    const result = await storage.getWebhookDeliveryWithRelations(deliveryId);

    if (!result) {
      throw new Error("Delivery not found");
    }

    const { webhook, event } = result;

    // Whether the webhook still subscribes to this event isn't checked, on purpose.
    // Subscriptions decide what fan-out sends. A retry is the owner asking for one
    // delivery by id, and test deliveries go out whatever the webhook subscribes
    // to, so they couldn't be retried otherwise.

    // Disabled means nothing goes to this URL, as with `triggerEvent`.
    if (!webhook.active) {
      throw new WebhookPreconditionError("Webhook is disabled");
    }

    // An event only ever goes to its own tenant's webhooks (HI-01). A delivery
    // from before fan-out was scoped can break that, and one from before events
    // were stamped can't show it doesn't, so neither goes out again.
    if (event.userId !== webhook.userId) {
      throw new WebhookPreconditionError(
        "This delivery's event isn't recorded under this webhook's owner",
      );
    }

    const content = storedEventContentSchema.safeParse(event.payload);
    if (!content.success) {
      throw new WebhookPreconditionError(
        "This delivery's stored event can't be sent again",
      );
    }

    // Decrypt the HMAC secret and custom headers at this delivery-signing
    // boundary — the stored forms are ciphertext at rest (HI-09).
    const { decryptWebhookSecret, decryptWebhookHeaders } =
      await import("./webhook-secret");
    return this.processDelivery(
      webhook.id,
      event.id,
      webhook.url,
      decryptWebhookSecret(webhook.secret, webhook.key, webhook.userId),
      decryptWebhookHeaders(webhook.headers, webhook.key, webhook.userId),
      deliveryPayload(event, content.data.data, content.data.metadata),
    );
  }
}
