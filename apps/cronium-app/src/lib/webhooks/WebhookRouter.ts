import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { WebhookManager } from "./WebhookManager";
import { WebhookSecurity } from "./WebhookSecurity";
import { eventTooLong } from "./delivery-body";
import { INBOUND_EVENT_PREFIX, unstorableEvent } from "./storable-event";
import { queueFullMessage } from "./webhook-errors";
import { db } from "@/server/db";
import { webhookEvents, webhookLogs } from "@/shared/schema";
import { clientIpFromHeaders } from "@/lib/security/client-ip";
import { failureWithStack, refusedByPostgres } from "@/lib/pg-errors";

/**
 * How long a sender is told to wait when the delivery queue is full. A receiver that
 * never answers gives room back about this often: five attempts end every 30 seconds,
 * and an event takes up to three.
 */
const QUEUE_FULL_RETRY_AFTER_SECONDS = 60;

/** Thrown when an inbound webhook body exceeds the size cap. */
class WebhookBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "WebhookBodyTooLargeError";
  }
}

export class WebhookRouter {
  private static instance: WebhookRouter;
  private webhookManager: WebhookManager;
  private webhookSecurity: WebhookSecurity;
  private constructor() {
    this.webhookManager = WebhookManager.getInstance();
    this.webhookSecurity = new WebhookSecurity();
  }

  static getInstance(): WebhookRouter {
    if (!WebhookRouter.instance) {
      WebhookRouter.instance = new WebhookRouter();
    }
    return WebhookRouter.instance;
  }

  /**
   * Handle incoming webhook request
   */
  async handleRequest(
    webhookKey: string,
    request: NextRequest,
  ): Promise<NextResponse> {
    const startTime = Date.now();
    // Only set while this request holds a delivery id it has done nothing with.
    let freeDeliveryId: (() => Promise<void>) | undefined;

    try {
      // Get webhook configuration
      const webhook = await this.webhookManager.getWebhookByKey(webhookKey);
      if (!webhook) {
        return NextResponse.json(
          { error: "Webhook not found" },
          { status: 404 },
        );
      }

      // Check if webhook is active
      if (!webhook.active) {
        return NextResponse.json(
          { error: "Webhook is disabled" },
          { status: 403 },
        );
      }

      // Read the raw body once (size-capped). The signature is verified over
      // these exact bytes; parsing happens only after verification.
      let rawBody: string;
      try {
        rawBody = await this.readBoundedText(request);
      } catch (readError) {
        if (readError instanceof WebhookBodyTooLargeError) {
          return NextResponse.json(
            { error: "Request body too large" },
            { status: 413 },
          );
        }
        return NextResponse.json(
          { error: "Invalid request body" },
          { status: 400 },
        );
      }

      // Get headers
      const headers = this.extractHeaders(request.headers);

      // Verify webhook security over the raw body (signature binds
      // timestamp.deliveryId.rawBody; delivery id is consumed once). Decrypt the
      // stored HMAC secret at this verification boundary.
      const { decryptWebhookSecret } = await import("./webhook-secret");
      const clientIp = this.getClientIP(request);
      const verificationResult = await this.webhookSecurity.verifyWebhook(
        {
          webhookId: webhook.id,
          rawBody,
          headers,
          ...(clientIp !== undefined && { ip: clientIp }),
        },
        {
          secret: decryptWebhookSecret(
            webhook.secret,
            webhook.key,
            webhook.userId,
          ),
          ...(webhook.ipWhitelist
            ? { ipWhitelist: webhook.ipWhitelist as string[] }
            : {}),
        },
      );

      if (!verificationResult.isValid) {
        await this.logWebhookRequest(webhook.id, {
          success: false,
          ...(verificationResult.error !== undefined && {
            error: verificationResult.error,
          }),
          duration: Date.now() - startTime,
        });

        return NextResponse.json(
          { error: verificationResult.error },
          { status: 401 },
        );
      }

      // The id is consumed now, and however this request ends before it has had an
      // effect, the id has to come back. Sending it again wouldn't be a replay, and it
      // would look like one to a sender keeping its id across attempts.
      const deliveryId = headers["x-webhook-delivery-id"];
      if (deliveryId) {
        freeDeliveryId = () =>
          this.webhookSecurity.releaseDeliveryId(webhook.id, deliveryId);
      }

      // Check rate limit
      const rateLimit = webhook.rateLimit as
        { requests?: number; window?: number } | null | undefined;
      const rateLimitResult = await this.webhookSecurity.checkRateLimit(
        `webhook:${webhook.id}`,
        rateLimit?.requests ?? 100,
        rateLimit?.window ?? 60000,
      );

      if (!rateLimitResult.allowed) {
        return NextResponse.json(
          { error: "Rate limit exceeded" },
          {
            status: 429,
            headers: {
              "X-RateLimit-Limit": String(rateLimit?.requests ?? 100),
              "X-RateLimit-Remaining": String(rateLimitResult.remaining),
              "X-RateLimit-Reset": rateLimitResult.resetAt.toISOString(),
            },
          },
        );
      }

      // Parse the (already-verified) body for processing.
      let body: unknown;
      try {
        body = this.parseBody(rawBody, headers["content-type"] ?? "");
      } catch {
        return NextResponse.json(
          { error: "Invalid request body" },
          { status: 400 },
        );
      }

      // Process webhook based on event type
      const eventType = this.extractEventType(body, headers);
      const processedData = await this.processWebhookData(
        webhook.id,
        eventType,
        body,
        webhook.transformations as Record<string, unknown> | undefined,
      );

      // Postgres would refuse it on every attempt, so a 500 would only have its sender
      // try again. Refused before anything is claimed or written.
      const unstorable = unstorableEvent(eventType, processedData);
      if (unstorable !== undefined) {
        await this.logWebhookRequest(webhook.id, {
          success: false,
          error: unstorable,
          duration: Date.now() - startTime,
        });

        return NextResponse.json({ error: unstorable }, { status: 400 });
      }

      // Refused here, where the sender can be told. Once this answers with a success,
      // nobody is left who could do anything about an event that can't go out. Without
      // `transformations`, the limit has room for anything the cap above lets in.
      const deliveredEvent = `${INBOUND_EVENT_PREFIX}${eventType}`;
      const deliveredMetadata = { webhookId: webhook.id, source: "webhook" };
      const tooLong = eventTooLong(
        deliveredEvent,
        processedData,
        deliveredMetadata,
      );
      if (tooLong !== undefined) {
        await this.logWebhookRequest(webhook.id, {
          success: false,
          error: tooLong,
          duration: Date.now() - startTime,
        });

        return NextResponse.json({ error: tooLong }, { status: 413 });
      }

      // Refused here for the same reason, and before anything is stored, because a
      // sender told to come back may keep coming back. The room this claims counts from
      // now, so simultaneous requests can't all take the last of it.
      const prepared = await this.webhookManager.prepareEvent(
        deliveredEvent,
        processedData,
        webhook.userId,
        deliveredMetadata,
      );
      if (prepared.refused) {
        const error = queueFullMessage(prepared.refused);
        await this.logWebhookRequest(webhook.id, {
          success: false,
          error,
          duration: Date.now() - startTime,
        });

        return NextResponse.json(
          { error },
          {
            status: 503,
            headers: { "Retry-After": String(QUEUE_FULL_RETRY_AFTER_SECONDS) },
          },
        );
      }

      // Store the event, stamped with the owning tenant (the inbound webhook's owner) so
      // downstream fan-out and reads stay tenant-scoped, along with the row its
      // deliveries go out on. Both go in or neither does, so a failure can't leave this
      // one stored with nothing sent, and its id used.
      let event: typeof webhookEvents.$inferSelect;
      let committing = false;
      try {
        event = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(webhookEvents)
            .values({
              event: eventType,
              payload: processedData,
              userId: webhook.userId,
              sourceWebhookId: webhook.id,
              createdAt: new Date(),
            })
            .returning();
          if (!row) throw new Error("Failed to create webhook event");

          await prepared.store(tx);
          committing = true;
          return row;
        });
      } catch (error) {
        prepared.cancel();
        // Nothing stays unless the COMMIT works, and Postgres saying no to it means it
        // didn't. With no answer to the COMMIT, or a FATAL, it may have, and then a
        // replay would store everything again.
        if (committing && !refusedByPostgres(error)) freeDeliveryId = undefined;
        throw error;
      }

      // This request has had an effect, so its id stays used, whatever fails from here.
      freeDeliveryId = undefined;

      // Fan out only within the inbound webhook's own tenant (HI-01). Only now, so no
      // delivery goes out for an event that isn't stored.
      await prepared.send();

      // Log successful request
      await this.logWebhookRequest(webhook.id, {
        success: true,
        eventId: event.id,
        duration: Date.now() - startTime,
      });

      // Return success response
      return NextResponse.json(
        {
          success: true,
          eventId: event.id,
          message: "Webhook processed successfully",
        },
        {
          status: 200,
          headers: {
            "X-Webhook-Id": webhook.id.toString(),
            "X-Event-Id": event.id.toString(),
          },
        },
      );
    } catch (error) {
      console.error("Webhook processing error:", failureWithStack(error));

      // Logged above. The caller may be anyone holding the key, so nothing about
      // the failure (driver errors, table names) goes back to them.
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    } finally {
      // Before the answer goes out, so a sender told to retry can't get there first.
      await freeDeliveryId?.();
    }
  }

  /** Parse an already-read raw body by content type. */
  private parseBody(raw: string, contentType: string): unknown {
    if (contentType.includes("application/json")) {
      return JSON.parse(raw);
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw);
      const result: Record<string, string> = {};
      for (const [key, value] of params) {
        result[key] = value;
      }
      return result;
    }
    // text/plain and any other type: raw text.
    return raw;
  }

  /** Read the request body as text, rejecting anything over the size cap. */
  private async readBoundedText(request: NextRequest): Promise<string> {
    const MAX_WEBHOOK_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

    const declared = request.headers.get("content-length");
    if (declared && Number(declared) > MAX_WEBHOOK_BODY_BYTES) {
      throw new WebhookBodyTooLargeError();
    }

    const text = await request.text();
    // Guard against a lying/absent Content-Length by checking the actual bytes.
    if (Buffer.byteLength(text, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
      throw new WebhookBodyTooLargeError();
    }
    return text;
  }

  /**
   * Extract headers from request
   */
  private extractHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value;
    });
    return result;
  }

  /**
   * Get the trusted client IP. Uses the TRUSTED_PROXY_HOPS policy so an
   * attacker can't spoof their source IP (which feeds the IP allowlist and
   * rate limiting) by prepending X-Forwarded-For entries.
   */
  private getClientIP(request: NextRequest): string | undefined {
    return clientIpFromHeaders(request.headers) ?? undefined;
  }

  /**
   * Extract event type from webhook data
   */
  private extractEventType(
    body: unknown,
    headers: Record<string, string>,
  ): string {
    // Check header first
    const headerEvent = headers["x-webhook-event"] ?? headers["x-event-type"];
    if (headerEvent) {
      return headerEvent;
    }

    // Check body for common event type fields
    if (typeof body === "object" && body !== null) {
      const obj = body as Record<string, unknown>;
      const eventField =
        obj.event ?? obj.event_type ?? obj.type ?? obj.action ?? "unknown";
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(eventField);
    }

    return "unknown";
  }

  /**
   * Process webhook data with transformations
   */
  private async processWebhookData(
    webhookId: number,
    eventType: string,
    data: unknown,
    transformations?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let processed: Record<string, unknown> = {
      eventType,
      receivedAt: new Date().toISOString(),
      webhookId,
    };

    // Merge objects into the envelope; anything else, including an array (which
    // would spread into numeric keys), goes under `data`.
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      processed = { ...processed, ...data };
    } else {
      processed.data = data;
    }

    // Apply transformations if configured
    if (transformations) {
      processed = await this.applyTransformations(processed, transformations);
    }

    // Sanitize data
    processed = this.webhookSecurity.sanitizePayload(processed);

    return processed;
  }

  /**
   * Apply data transformations
   */
  private async applyTransformations(
    data: Record<string, unknown>,
    transformations: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Simple JSONPath-like transformations
    const result: Record<string, unknown> = {};

    for (const [targetKey, sourcePath] of Object.entries(transformations)) {
      if (typeof sourcePath === "string") {
        const value = this.getValueByPath(data, sourcePath);
        if (value !== undefined) {
          result[targetKey] = value;
        }
      }
    }

    return { ...data, ...result };
  }

  /**
   * Get value from object by path
   */
  private getValueByPath(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split(".");
    let current: unknown = obj;

    for (const key of keys) {
      if (
        current &&
        typeof current === "object" &&
        Object.prototype.hasOwnProperty.call(current, key)
      ) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Log webhook request
   */
  private async logWebhookRequest(
    webhookId: number,
    details: {
      success: boolean;
      error?: string;
      eventId?: number;
      duration: number;
    },
  ): Promise<void> {
    try {
      await db.insert(webhookLogs).values({
        webhookId,
        success: details.success,
        error: details.error,
        eventId: details.eventId,
        duration: details.duration,
        createdAt: new Date(),
      });
    } catch (error) {
      console.error("Failed to log webhook request:", failureWithStack(error));
    }
  }

  /**
   * Generate webhook documentation
   */
  generateDocumentation(webhookKey: string): {
    endpoint: string;
    methods: string[];
    headers: Record<string, string>;
    authentication: string;
    examples: Record<string, unknown>;
  } {
    const baseUrl = process.env.PUBLIC_APP_URL ?? "http://localhost:5001";

    return {
      endpoint: `${baseUrl}/api/webhooks/${webhookKey}`,
      methods: ["POST"],
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": "sha256=<signature>",
        "X-Webhook-Timestamp": "<ISO 8601 timestamp>",
        "X-Webhook-Delivery-Id": "<unique per delivery>",
      },
      authentication:
        "HMAC-SHA256 over `<timestamp>.<deliveryId>.<rawBody>`; timestamp must be within 5 minutes and each delivery id is accepted once (replay-protected).",
      examples: {
        request: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": "sha256=...",
            "X-Webhook-Timestamp": new Date().toISOString(),
            "X-Webhook-Delivery-Id": "unique-id-per-request",
          },
          body: {
            event: "example.event",
            data: {
              id: "123",
              message: "Example webhook payload",
            },
          },
        },
        response: {
          success: true,
          eventId: "evt_123",
          message: "Webhook processed successfully",
        },
      },
    };
  }
}
