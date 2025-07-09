import crypto from "crypto";

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
   * Comprehensive webhook verification
   */
  async verifyWebhook(
    request: {
      body: string;
      headers: Record<string, string>;
      ip?: string;
    },
    config: {
      secret: string;
      ipWhitelist?: string[];
      verifyTimestamp?: boolean;
    },
  ): Promise<SignatureVerificationResult> {
    // Verify signature
    const signature = request.headers["x-webhook-signature"];
    if (!signature) {
      return {
        isValid: false,
        error: "Missing signature header",
      };
    }

    const signatureResult = this.verifySignature(
      request.body,
      signature,
      config.secret,
    );
    if (!signatureResult.isValid) {
      return signatureResult;
    }

    // Verify timestamp
    if (config.verifyTimestamp) {
      const timestamp = request.headers["x-webhook-timestamp"];
      if (!timestamp) {
        return {
          isValid: false,
          error: "Missing timestamp header",
        };
      }

      const timestampResult = this.verifyTimestamp(timestamp);
      if (!timestampResult.isValid) {
        return timestampResult;
      }
    }

    // Verify IP whitelist
    if (config.ipWhitelist && request.ip) {
      const ipResult = this.verifyIPWhitelist(request.ip, config.ipWhitelist);
      if (!ipResult.isValid) {
        return ipResult;
      }
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
   * Rate limit check for webhook endpoints
   */
  async checkRateLimit(
    identifier: string,
    limit: number,
    window: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    // This is a simple in-memory implementation
    // In production, use Redis or similar
    const now = Date.now();

    // TODO: Implement proper rate limiting with Redis
    // For now, always allow
    return {
      allowed: true,
      remaining: limit,
      resetAt: new Date(now + window),
    };
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
