import { EventEmitter } from "events";
import { z } from "zod";
import { db } from "@/server/db";
import { rateLimitBuckets } from "@/shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export const RateLimitConfigSchema = z.object({
  windowMs: z.number().min(1000).default(60000), // 1 minute default
  maxRequests: z.number().min(1).default(100),
  keyPrefix: z.string().default("rl"),
  skipSuccessfulRequests: z.boolean().default(false),
  skipFailedRequests: z.boolean().default(false),
});

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfter?: number;
}

export interface RateLimitKey {
  type: "user" | "ip" | "api_key" | "tool" | "webhook" | "custom";
  identifier: string;
  subIdentifier?: string;
}

export class RateLimiter extends EventEmitter {
  private static instance: RateLimiter;
  private memoryStore = new Map<string, { count: number; resetAt: Date }>();
  private cleanupInterval: NodeJS.Timeout | undefined;

  private constructor() {
    super();
    this.startCleanup();
  }

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  /**
   * Check rate limit
   */
  async checkLimit(
    key: RateLimitKey,
    config: Partial<RateLimitConfig> = {},
  ): Promise<RateLimitResult> {
    const fullConfig = RateLimitConfigSchema.parse(config);
    const bucketKey = this.generateKey(key, fullConfig.keyPrefix);
    const now = new Date();
    const resetAt = new Date(now.getTime() + fullConfig.windowMs);

    // Check memory store first (for performance)
    const memoryBucket = this.memoryStore.get(bucketKey);
    if (memoryBucket && memoryBucket.resetAt > now) {
      const remaining = Math.max(
        0,
        fullConfig.maxRequests - memoryBucket.count,
      );
      const allowed = remaining > 0;

      if (allowed) {
        memoryBucket.count++;
      }

      const result: RateLimitResult = {
        allowed,
        limit: fullConfig.maxRequests,
        remaining: allowed ? remaining - 1 : remaining,
        resetAt: memoryBucket.resetAt,
      };

      if (!allowed) {
        result.retryAfter = memoryBucket.resetAt.getTime() - now.getTime();
      }

      return result;
    }

    // Check database for distributed rate limiting
    try {
      const bucket = await this.getOrCreateBucket(
        bucketKey,
        key,
        fullConfig,
        now,
      );

      const result: RateLimitResult = {
        allowed: bucket.allowed,
        limit: fullConfig.maxRequests,
        remaining: bucket.remaining,
        resetAt: bucket.resetAt,
      };

      if (!bucket.allowed) {
        result.retryAfter = bucket.resetAt.getTime() - now.getTime();
      }

      // Update memory store
      this.memoryStore.set(bucketKey, {
        count: fullConfig.maxRequests - bucket.remaining,
        resetAt: bucket.resetAt,
      });

      // Emit event
      this.emit("rate-limit-check", {
        key,
        result,
        config: fullConfig,
      });

      return result;
    } catch (error) {
      console.error("Rate limit check error:", error);
      // Fail open - allow request on error
      return {
        allowed: true,
        limit: fullConfig.maxRequests,
        remaining: fullConfig.maxRequests,
        resetAt,
      };
    }
  }

  /**
   * Reset rate limit for a key
   */
  async resetLimit(
    key: RateLimitKey,
    config: Partial<RateLimitConfig> = {},
  ): Promise<void> {
    const fullConfig = RateLimitConfigSchema.parse(config);
    const bucketKey = this.generateKey(key, fullConfig.keyPrefix);

    // Clear from memory
    this.memoryStore.delete(bucketKey);

    // Clear from database
    await db
      .delete(rateLimitBuckets)
      .where(eq(rateLimitBuckets.key, bucketKey));

    this.emit("rate-limit-reset", { key, config: fullConfig });
  }

  /**
   * Get current rate limit status
   */
  async getStatus(
    key: RateLimitKey,
    config: Partial<RateLimitConfig> = {},
  ): Promise<RateLimitResult> {
    const fullConfig = RateLimitConfigSchema.parse(config);
    const bucketKey = this.generateKey(key, fullConfig.keyPrefix);
    const now = new Date();

    // Check memory first
    const memoryBucket = this.memoryStore.get(bucketKey);
    if (memoryBucket && memoryBucket.resetAt > now) {
      return {
        allowed: memoryBucket.count < fullConfig.maxRequests,
        limit: fullConfig.maxRequests,
        remaining: Math.max(0, fullConfig.maxRequests - memoryBucket.count),
        resetAt: memoryBucket.resetAt,
      };
    }

    // Check database
    const [bucket] = await db
      .select()
      .from(rateLimitBuckets)
      .where(
        and(
          eq(rateLimitBuckets.key, bucketKey),
          gte(rateLimitBuckets.resetAt, now),
        ),
      )
      .limit(1);

    if (bucket) {
      const remaining = Math.max(0, fullConfig.maxRequests - bucket.count);
      return {
        allowed: remaining > 0,
        limit: fullConfig.maxRequests,
        remaining,
        resetAt: bucket.resetAt,
      };
    }

    // No active bucket
    return {
      allowed: true,
      limit: fullConfig.maxRequests,
      remaining: fullConfig.maxRequests,
      resetAt: new Date(now.getTime() + fullConfig.windowMs),
    };
  }

  /**
   * Apply rate limiting middleware
   */
  createMiddleware(config: RateLimitConfig) {
    return async (
      req: {
        headers: Record<string, string | string[] | undefined>;
        ip?: string;
        connection?: { remoteAddress?: string };
      },
      res: {
        setHeader: (key: string, value: string) => void;
        status: (code: number) => { json: (data: unknown) => unknown };
      },
      next: () => void,
    ) => {
      const key: RateLimitKey = {
        type: "ip",
        identifier: this.getClientIP(req) ?? "unknown",
      };

      const result = await this.checkLimit(key, config);

      // Set headers
      res.setHeader("X-RateLimit-Limit", result.limit.toString());
      res.setHeader("X-RateLimit-Remaining", result.remaining.toString());
      res.setHeader("X-RateLimit-Reset", result.resetAt.toISOString());

      if (!result.allowed) {
        res.setHeader(
          "Retry-After",
          Math.ceil((result.retryAfter ?? 0) / 1000).toString(),
        );
        res.status(429).json({
          error: "Too Many Requests",
          message: "Rate limit exceeded",
          retryAfter: result.retryAfter,
        });
        return;
      }

      next();
    };
  }

  /**
   * Generate bucket key
   */
  private generateKey(key: RateLimitKey, prefix: string): string {
    const parts = [prefix, key.type, key.identifier];
    if (key.subIdentifier) {
      parts.push(key.subIdentifier);
    }
    return parts.join(":");
  }

  /**
   * Get or create rate limit bucket
   */
  private async getOrCreateBucket(
    bucketKey: string,
    key: RateLimitKey,
    config: RateLimitConfig,
    now: Date,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> {
    // Clean up expired buckets
    await db
      .delete(rateLimitBuckets)
      .where(
        and(
          eq(rateLimitBuckets.key, bucketKey),
          sql`${rateLimitBuckets.resetAt} < ${now}`,
        ),
      );

    // Try to get existing bucket
    const [existing] = await db
      .select()
      .from(rateLimitBuckets)
      .where(
        and(
          eq(rateLimitBuckets.key, bucketKey),
          gte(rateLimitBuckets.resetAt, now),
        ),
      )
      .limit(1);

    if (existing) {
      // Update count
      const newCount = existing.count + 1;
      const allowed = newCount <= config.maxRequests;

      if (allowed) {
        await db
          .update(rateLimitBuckets)
          .set({ count: newCount })
          .where(eq(rateLimitBuckets.id, existing.id));
      }

      return {
        allowed,
        remaining: Math.max(0, config.maxRequests - newCount),
        resetAt: existing.resetAt,
      };
    }

    // Create new bucket
    const resetAt = new Date(now.getTime() + config.windowMs);
    const [newBucket] = await db
      .insert(rateLimitBuckets)
      .values({
        key: bucketKey,
        type: key.type,
        identifier: key.identifier,
        subIdentifier: key.subIdentifier,
        count: 1,
        limit: config.maxRequests,
        windowMs: config.windowMs,
        resetAt,
        createdAt: now,
      })
      .returning();

    if (!newBucket) {
      throw new Error("Failed to create rate limit bucket");
    }

    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: newBucket.resetAt,
    };
  }

  /**
   * Get client IP from request
   */
  private getClientIP(req: {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
    connection?: { remoteAddress?: string };
  }): string | undefined {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (forwardedFor && typeof forwardedFor === "string") {
      return forwardedFor.split(",")[0]?.trim();
    }

    const realIP = req.headers["x-real-ip"];
    if (realIP && typeof realIP === "string") {
      return realIP;
    }

    return req.ip ?? req.connection?.remoteAddress;
  }

  /**
   * Start cleanup interval
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.memoryStore) {
        if (bucket.resetAt.getTime() < now) {
          this.memoryStore.delete(key);
        }
      }
    }, 60000); // Clean up every minute
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * Get statistics
   */
  async getStatistics(): Promise<{
    totalBuckets: number;
    activeBuckets: number;
    topUsers: Array<{ identifier: string; count: number }>;
    topEndpoints: Array<{ identifier: string; count: number }>;
  }> {
    const now = new Date();

    // Get total buckets
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(rateLimitBuckets);
    const totalBuckets = totalResult?.count ?? 0;

    // Get active buckets
    const [activeResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(rateLimitBuckets)
      .where(gte(rateLimitBuckets.resetAt, now));
    const activeBuckets = activeResult?.count ?? 0;

    // Get top users
    const topUsers = await db
      .select({
        identifier: rateLimitBuckets.identifier,
        count: sql<number>`sum(${rateLimitBuckets.count})`,
      })
      .from(rateLimitBuckets)
      .where(
        and(
          eq(rateLimitBuckets.type, "user"),
          gte(rateLimitBuckets.resetAt, now),
        ),
      )
      .groupBy(rateLimitBuckets.identifier)
      .orderBy(sql`sum(${rateLimitBuckets.count}) desc`)
      .limit(10);

    // Get top endpoints
    const topEndpoints = await db
      .select({
        identifier: rateLimitBuckets.subIdentifier,
        count: sql<number>`sum(${rateLimitBuckets.count})`,
      })
      .from(rateLimitBuckets)
      .where(
        and(
          eq(rateLimitBuckets.type, "api_key"),
          gte(rateLimitBuckets.resetAt, now),
        ),
      )
      .groupBy(rateLimitBuckets.subIdentifier)
      .orderBy(sql`sum(${rateLimitBuckets.count}) desc`)
      .limit(10);

    return {
      totalBuckets,
      activeBuckets,
      topUsers: topUsers.map((u) => ({
        identifier: u.identifier,
        count: Number(u.count),
      })),
      topEndpoints: topEndpoints
        .filter((e) => e.identifier)
        .map((e) => ({
          identifier: e.identifier!,
          count: Number(e.count),
        })),
    };
  }
}
