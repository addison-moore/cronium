import crypto from "crypto";
import { RateLimitService } from "../rate-limit-service";

export interface SignatureVerificationResult {
  isValid: boolean;
  error?: string;
}

export class WebhookSecurity {
  private static readonly SIGNATURE_PREFIX = "sha256=";
  private static readonly TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Generate HMAC signature for webhook payload
   */
  generateSignature(payload: string, secret: string): string {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(payload);
    return `${WebhookSecurity.SIGNATURE_PREFIX}${hmac.digest("hex")}`;
  }

  /**
   * Verify webhook signature
   */
  verifySignature(
    payload: string,
    signature: string,
    secret: string,
  ): SignatureVerificationResult {
    try {
      // Check signature format
      if (!signature.startsWith(WebhookSecurity.SIGNATURE_PREFIX)) {
        return {
          isValid: false,
          error: "Invalid signature format",
        };
      }

      // Generate expected signature
      const expectedSignature = this.generateSignature(payload, secret);

      // Constant-time comparison
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );

      return { isValid };
    } catch (error) {
      return {
        isValid: false,
        error:
          error instanceof Error
            ? error.message
            : "Signature verification failed",
      };
    }
  }

  /**
   * Verify webhook timestamp to prevent replay attacks
   */
  verifyTimestamp(timestamp: string | Date): SignatureVerificationResult {
    try {
      const webhookTime = new Date(timestamp).getTime();
      // A malformed timestamp parses to NaN; Math.abs(NaN) > tolerance is false,
      // which previously let an unparseable timestamp bypass the replay window.
      // Reject any non-finite time explicitly (HI-12).
      if (!Number.isFinite(webhookTime)) {
        return { isValid: false, error: "Invalid timestamp" };
      }
      const currentTime = Date.now();
      const difference = Math.abs(currentTime - webhookTime);

      if (difference > WebhookSecurity.TIMESTAMP_TOLERANCE_MS) {
        return {
          isValid: false,
          error: "Timestamp outside tolerance window",
        };
      }

      return { isValid: true };
    } catch {
      return {
        isValid: false,
        error: "Invalid timestamp",
      };
    }
  }

  /**
   * Verify IP whitelist (if configured)
   */
  verifyIPWhitelist(
    clientIP: string,
    whitelist: string[],
  ): SignatureVerificationResult {
    if (whitelist.length === 0) {
      return { isValid: true };
    }

    const isWhitelisted = whitelist.some((allowedIP) => {
      // Support CIDR notation
      if (allowedIP.includes("/")) {
        return this.isIPInCIDR(clientIP, allowedIP);
      }
      return clientIP === allowedIP;
    });

    return isWhitelisted
      ? { isValid: true }
      : { isValid: false, error: "IP not whitelisted" };
  }

  /**
   * Comprehensive webhook verification (HI-12).
   *
   * The signature covers `timestamp.deliveryId.rawBody`, the timestamp is
   * required and must be finite and within the tolerance window, and the
   * delivery ID is atomically consumed so a captured request cannot be
   * replayed. `rawBody` is the exact received bytes (not a re-serialization),
   * so senders and this verifier agree byte-for-byte.
   */
  async verifyWebhook(
    request: {
      webhookId: number;
      rawBody: string;
      headers: Record<string, string>;
      ip?: string;
    },
    config: {
      secret: string;
      ipWhitelist?: string[];
    },
  ): Promise<SignatureVerificationResult> {
    const signature = request.headers["x-webhook-signature"];
    const timestamp = request.headers["x-webhook-timestamp"];
    const deliveryId = request.headers["x-webhook-delivery-id"];

    if (!signature) {
      return { isValid: false, error: "Missing signature header" };
    }
    if (!timestamp) {
      return { isValid: false, error: "Missing timestamp header" };
    }
    if (!deliveryId) {
      return { isValid: false, error: "Missing delivery id header" };
    }

    // Timestamp must be finite and within the replay window.
    const timestampResult = this.verifyTimestamp(timestamp);
    if (!timestampResult.isValid) {
      return timestampResult;
    }

    // Signature binds timestamp + delivery id + the exact body bytes.
    const signedPayload = `${timestamp}.${deliveryId}.${request.rawBody}`;
    const signatureResult = this.verifySignature(
      signedPayload,
      signature,
      config.secret,
    );
    if (!signatureResult.isValid) {
      return signatureResult;
    }

    // IP allowlist: when configured, the source IP must be established and
    // permitted — fail closed if it cannot be determined.
    if (config.ipWhitelist && config.ipWhitelist.length > 0) {
      if (!request.ip) {
        return {
          isValid: false,
          error: "Source IP could not be established",
        };
      }
      const ipResult = this.verifyIPWhitelist(request.ip, config.ipWhitelist);
      if (!ipResult.isValid) {
        return ipResult;
      }
    }

    // Atomically consume the delivery id — reject replays (and fail closed if
    // the replay store is unavailable).
    const { consumeWebhookDeliveryOnce } =
      await import("./webhook-replay-store");
    const fresh = await consumeWebhookDeliveryOnce(
      request.webhookId,
      deliveryId,
      Math.ceil(WebhookSecurity.TIMESTAMP_TOLERANCE_MS / 1000) + 60,
    );
    if (!fresh) {
      return { isValid: false, error: "Duplicate or replayed delivery" };
    }

    return { isValid: true };
  }

  /**
   * Generate webhook endpoint URL
   */
  generateEndpointUrl(baseUrl: string, webhookKey: string): string {
    return `${baseUrl}/api/webhooks/${webhookKey}`;
  }

  /**
   * Sanitize webhook payload to prevent injection attacks
   */
  sanitizePayload<T extends Record<string, unknown>>(payload: T): T {
    const sanitized = {} as T;

    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "string") {
        // Remove potential script tags and escape HTML
        sanitized[key as keyof T] = this.escapeHtml(value) as T[keyof T];
      } else if (typeof value === "object" && value !== null) {
        // Recursively sanitize nested objects
        sanitized[key as keyof T] = this.sanitizePayload(
          value as Record<string, unknown>,
        ) as T[keyof T];
      } else {
        sanitized[key as keyof T] = value as T[keyof T];
      }
    }

    return sanitized;
  }

  /**
   * Rate limit check for webhook endpoints. Backed by the shared
   * Redis/Valkey sliding window; fails open when the cache is unavailable.
   */
  async checkRateLimit(
    identifier: string,
    limit: number,
    window: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    return RateLimitService.tryCheckLimit(identifier, "webhook", {
      maxRequests: limit,
      windowMs: window,
    });
  }

  /**
   * Generate secure webhook secret
   */
  generateSecret(length = 32): string {
    return crypto.randomBytes(length).toString("hex");
  }

  /**
   * Check if IP is in CIDR range
   */
  private isIPInCIDR(ip: string, cidr: string): boolean {
    // Simple implementation - in production, use a proper IP library
    const [network, bits = "32"] = cidr.split("/");
    if (!network) {
      return false;
    }
    const mask = ~(2 ** (32 - parseInt(bits)) - 1);

    const ipNum = this.ipToNumber(ip);
    const networkNum = this.ipToNumber(network);

    return (ipNum & mask) === (networkNum & mask);
  }

  /**
   * Convert IP address to number
   */
  private ipToNumber(ip: string): number {
    const parts = ip.split(".");
    return parts.reduce((acc, part, index) => {
      return acc + (parseInt(part) << ((3 - index) * 8));
    }, 0);
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(str: string): string {
    const htmlEscapes: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return str.replace(/[&<>"']/g, (match) => htmlEscapes[match] ?? match);
  }

  /**
   * Validate webhook URL
   */
  validateWebhookUrl(url: string): { isValid: boolean; error?: string } {
    try {
      const urlObj = new URL(url);

      // Check protocol
      if (!["http:", "https:"].includes(urlObj.protocol)) {
        return {
          isValid: false,
          error: "Invalid protocol. Only HTTP and HTTPS are allowed.",
        };
      }

      // Check for localhost/private IPs in production
      if (process.env.NODE_ENV === "production") {
        const hostname = urlObj.hostname.toLowerCase();
        const privatePatterns = [
          "localhost",
          "127.0.0.1",
          "0.0.0.0",
          "::1",
          /^10\./,
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
          /^192\.168\./,
        ];

        const isPrivate = privatePatterns.some((pattern) => {
          if (typeof pattern === "string") {
            return hostname === pattern;
          }
          return pattern.test(hostname);
        });

        if (isPrivate) {
          return {
            isValid: false,
            error: "Private or local URLs are not allowed in production.",
          };
        }
      }

      return { isValid: true };
    } catch {
      return {
        isValid: false,
        error: "Invalid URL format",
      };
    }
  }
}
