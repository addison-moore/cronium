import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { WebhookManager } from "./WebhookManager";
import { WebhookSecurity } from "./WebhookSecurity";
import { db } from "@/server/db";
import { webhookEvents, webhookLogs } from "@/shared/schema";

export interface WebhookRequest {
  method: string;
  headers: Record<string, string>;
  body: unknown;
  query: Record<string, string>;
  ip?: string;
}

export interface WebhookResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export class WebhookRouter {
  private static instance: WebhookRouter;
  private webhookManager: WebhookManager;
  private webhookSecurity: WebhookSecurity;
  private routes = new Map<
    string,
    (req: WebhookRequest) => Promise<WebhookResponse>
  >();

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

      // Parse request body
      const body = await this.parseRequestBody(request);

      // Get headers
      const headers = this.extractHeaders(request.headers);

      // Verify webhook security
      const clientIp = this.getClientIP(request);
      const verificationResult = await this.webhookSecurity.verifyWebhook(
        {
          body: JSON.stringify(body),
          headers,
          ...(clientIp !== undefined && { ip: clientIp }),
        },
        {
          secret: webhook.secret,
          ...(webhook.ipWhitelist
            ? { ipWhitelist: webhook.ipWhitelist as string[] }
            : {}),
          verifyTimestamp: webhook.verifyTimestamp ?? true,
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

      // Check rate limit
      const rateLimit = webhook.rateLimit as
        | { requests?: number; window?: number }
        | null
        | undefined;
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

      // Process webhook based on event type
      const eventType = this.extractEventType(body, headers);
      const processedData = await this.processWebhookData(
        webhook.id,
        eventType,
        body,
        webhook.transformations as Record<string, unknown> | undefined,
      );

      // Store event
      const result = await db
        .insert(webhookEvents)
        .values({
          event: eventType,
          payload: processedData,
          createdAt: new Date(),
        })
        .returning();

      if (!result[0]) {
        throw new Error("Failed to create webhook event");
      }

      const event = result[0];

      // Trigger internal events
      await this.webhookManager.triggerEvent(
        `webhook.${eventType}`,
        processedData,
        {
          webhookId: webhook.id,
          webhookKey: webhook.key,
          source: "webhook",
        },
      );

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
      console.error("Webhook processing error:", error);

      return NextResponse.json(
        {
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      );
    }
  }

  /**
   * Register custom webhook handler
   */
  registerHandler(
    eventType: string,
    handler: (req: WebhookRequest) => Promise<WebhookResponse>,
  ): void {
    this.routes.set(eventType, handler);
  }

  /**
   * Parse request body based on content type
   */
  private async parseRequestBody(request: NextRequest): Promise<unknown> {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      return await request.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await request.text();
      const params = new URLSearchParams(text);
      const result: Record<string, string> = {};
      for (const [key, value] of params) {
        result[key] = value;
      }
      return result;
    } else if (contentType.includes("text/plain")) {
      return await request.text();
    } else {
      // Default to raw text
      return await request.text();
    }
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
   * Get client IP from request
   */
  private getClientIP(request: NextRequest): string | undefined {
    // Check common headers for client IP
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) {
      const firstIp = forwardedFor.split(",")[0];
      return firstIp?.trim();
    }

    const realIP = request.headers.get("x-real-ip");
    if (realIP) {
      return realIP;
    }

    // No IP found
    return undefined;
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
      return typeof eventField === "object"
        ? JSON.stringify(eventField)
        : String(eventField);
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

    // Ensure data is an object
    if (typeof data === "object" && data !== null) {
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
      if (current && typeof current === "object" && key in current) {
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
      console.error("Failed to log webhook request:", error);
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
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5001";

    return {
      endpoint: `${baseUrl}/api/webhooks/${webhookKey}`,
      methods: ["POST"],
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": "sha256=<signature>",
        "X-Webhook-Timestamp": "<ISO 8601 timestamp>",
      },
      authentication: "HMAC-SHA256 signature verification",
      examples: {
        request: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": "sha256=...",
            "X-Webhook-Timestamp": new Date().toISOString(),
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
