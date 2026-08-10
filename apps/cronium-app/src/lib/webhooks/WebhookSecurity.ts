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
   * Check whether an IPv4 address falls inside a CIDR range.
   *
   * Every input is validated before any arithmetic. The previous version
   * reduced over `ip.split(".")` with no checks, which made this allowlist
   * fail *open* on malformed input: `parseInt("abc")` is NaN and `NaN << 24`
   * is 0, so any non-numeric address — including every IPv6 address, which has
   * no dots to split on — collapsed to 0.0.0.0 and matched a 0.0.0.0/x rule.
   * More than four octets was worse: at index 4 the shift is -8, and JS shift
   * counts are taken mod 32, so `<< -8` is `<< 24` and the extra octets folded
   * back onto the first, letting distinct addresses collide.
   *
   * Anything this function cannot parse with certainty is not a match.
   */
  private isIPInCIDR(ip: string, cidr: string): boolean {
    const slash = cidr.indexOf("/");
    const network = slash === -1 ? cidr : cidr.slice(0, slash);
    const bitsPart = slash === -1 ? "32" : cidr.slice(slash + 1);

    if (!/^\d{1,2}$/.test(bitsPart)) return false;
    const bits = Number(bitsPart);
    if (bits > 32) return false;

    const ipNum = this.ipToNumber(ip);
    const networkNum = this.ipToNumber(network);
    if (ipNum === null || networkNum === null) return false;

    // A /0 matches everything; shifting by 32 is undefined in JS (count is
    // mod 32, so `-1 << 32` would be -1), so special-case it.
    if (bits === 0) return true;
    const mask = (-1 << (32 - bits)) >>> 0;

    return (ipNum & mask) >>> 0 === (networkNum & mask) >>> 0;
  }

  /**
   * Convert a dotted-quad IPv4 address to an unsigned 32-bit number, or null
   * if it is not exactly four octets of 0-255.
   */
  private ipToNumber(ip: string): number | null {
    const parts = ip.trim().split(".");
    if (parts.length !== 4) return null;

    let result = 0;
    for (const part of parts) {
      // Exactly one canonical spelling per octet. This rejects "", "+1", " 1"
      // and non-numeric text (which parseInt would have salvaged a prefix
      // from), and also zero-padded forms like "0177" — those are a real
      // bypass vector, since some resolvers read a leading zero as octal and
      // would disagree with this function about which host was named.
      if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
      const octet = Number(part);
      if (octet > 255) return null;
      result = (result << 8) | octet;
    }
    return result >>> 0;
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
