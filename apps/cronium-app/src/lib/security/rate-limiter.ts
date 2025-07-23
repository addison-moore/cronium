/**
 * Rate limiting implementation for tool actions
 */

import { db } from "@/server/db";
import { toolRateLimits, userToolQuotas } from "@/shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";

export interface RateLimitConfig {
  windowSize: number; // in milliseconds
  maxRequests: number;
  burstAllowance?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfter?: number; // seconds
}

export interface QuotaConfig {
  daily?: number;
  hourly?: number;
  burst?: number;
  tier?: "free" | "pro" | "enterprise";
}

/**
 * Default rate limits by tool type
 */
const defaultRateLimits: Record<string, RateLimitConfig> = {
  slack: {
    windowSize: 60 * 1000, // 1 minute
    maxRequests: 60,
    burstAllowance: 10,
  },
  discord: {
    windowSize: 60 * 1000,
    maxRequests: 60,
    burstAllowance: 10,
  },
  email: {
    windowSize: 60 * 1000,
    maxRequests: 30,
    burstAllowance: 5,
  },
  "google-sheets": {
    windowSize: 60 * 1000,
    maxRequests: 100,
    burstAllowance: 20,
  },
  notion: {
    windowSize: 60 * 1000,
    maxRequests: 50,
    burstAllowance: 10,
  },
  teams: {
    windowSize: 60 * 1000,
    maxRequests: 50,
    burstAllowance: 10,
  },
  trello: {
    windowSize: 60 * 1000,
    maxRequests: 100,
    burstAllowance: 20,
  },
  default: {
    windowSize: 60 * 1000,
    maxRequests: 30,
    burstAllowance: 5,
  },
};

/**
 * Default quotas by tier
 */
const defaultQuotas: Record<string, QuotaConfig> = {
  free: {
    daily: 1000,
    hourly: 100,
    burst: 20,
  },
  pro: {
    daily: 10000,
    hourly: 1000,
    burst: 100,
  },
  enterprise: {
    daily: 100000,
    hourly: 10000,
    burst: 1000,
  },
};

/**
 * Rate limiter for tool actions
 */
export class RateLimiter {
  private static instance: RateLimiter;

  private constructor() {
    // Rate limiter initialization
  }

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  /**
   * Check rate limit for a user and tool
   */
  async checkRateLimit(
    userId: string,
    toolType: string,
  ): Promise<RateLimitResult> {
    const config = defaultRateLimits[toolType] ?? defaultRateLimits.default;
    if (!config) {
      // Fallback if no default config exists
      return {
        allowed: true,
        limit: 100,
        remaining: 100,
        resetAt: new Date(Date.now() + 3600000), // 1 hour
      };
    }
    const windowStart = new Date(Date.now() - config.windowSize);

    try {
      // Get or create current window
      const [currentWindow] = await db
        .select()
        .from(toolRateLimits)
        .where(
          and(
            eq(toolRateLimits.userId, userId),
            eq(toolRateLimits.toolType, toolType),
            gte(toolRateLimits.windowStart, windowStart),
          ),
        )
        .limit(1);

      if (!currentWindow) {
        // Create new window
        await db.insert(toolRateLimits).values({
          userId,
          toolType,
          windowStart: new Date(),
          requestCount: 1,
          lastRequest: new Date(),
        });

        return {
          allowed: true,
          limit: config.maxRequests,
          remaining: config.maxRequests - 1,
          resetAt: new Date(Date.now() + config.windowSize),
        };
      }

      // Check if limit exceeded
      if (currentWindow.requestCount >= config.maxRequests) {
        const resetAt = new Date(
          currentWindow.windowStart.getTime() + config.windowSize,
        );
        const retryAfter = Math.ceil((resetAt.getTime() - Date.now()) / 1000);

        return {
          allowed: false,
          limit: config.maxRequests,
          remaining: 0,
          resetAt,
          retryAfter: Math.max(1, retryAfter),
        };
      }

      // Increment counter
      await db
        .update(toolRateLimits)
        .set({
          requestCount: sql`${toolRateLimits.requestCount} + 1`,
          lastRequest: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(toolRateLimits.id, currentWindow.id));

      return {
        allowed: true,
        limit: config.maxRequests,
        remaining: config.maxRequests - currentWindow.requestCount - 1,
        resetAt: new Date(
          currentWindow.windowStart.getTime() + config.windowSize,
        ),
      };
    } catch (error) {
      console.error("Rate limit check failed:", error);
      // Fail open - allow the request if rate limiting fails
      return {
        allowed: true,
        limit: config.maxRequests,
        remaining: config.maxRequests,
        resetAt: new Date(Date.now() + config.windowSize),
      };
    }
  }

  /**
   * Check user quota
   */
  async checkQuota(
    userId: string,
    toolType?: string,
  ): Promise<{
    allowed: boolean;
    daily: { used: number; limit: number };
    hourly: { used: number; limit: number };
    tier: string;
  }> {
    try {
      // Get user quota configuration
      const [userQuota] = await db
        .select()
        .from(userToolQuotas)
        .where(
          toolType
            ? and(
                eq(userToolQuotas.userId, userId),
                eq(userToolQuotas.toolType, toolType),
              )
            : eq(userToolQuotas.userId, userId),
        )
        .limit(1);

      const tier = userQuota?.tier ?? "free";
      const quotaConfig = {
        ...defaultQuotas[tier],
        ...(userQuota?.customLimits as QuotaConfig | undefined),
      };

      // Calculate time windows
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Count requests in each window
      const hourlyCountResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(toolRateLimits)
        .where(
          and(
            eq(toolRateLimits.userId, userId),
            gte(toolRateLimits.lastRequest, hourAgo),
            toolType ? eq(toolRateLimits.toolType, toolType) : undefined,
          ),
        );

      const dailyCountResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(toolRateLimits)
        .where(
          and(
            eq(toolRateLimits.userId, userId),
            gte(toolRateLimits.lastRequest, dayAgo),
            toolType ? eq(toolRateLimits.toolType, toolType) : undefined,
          ),
        );

      const hourlyUsed = hourlyCountResult[0]?.count ?? 0;
      const dailyUsed = dailyCountResult[0]?.count ?? 0;

      return {
        allowed:
          hourlyUsed < (quotaConfig.hourly ?? Infinity) &&
          dailyUsed < (quotaConfig.daily ?? Infinity),
        daily: {
          used: dailyUsed,
          limit: quotaConfig.daily ?? 0,
        },
        hourly: {
          used: hourlyUsed,
          limit: quotaConfig.hourly ?? 0,
        },
        tier,
      };
    } catch (error) {
      console.error("Quota check failed:", error);
      // Fail open
      return {
        allowed: true,
        daily: { used: 0, limit: defaultQuotas.free?.daily ?? 0 },
        hourly: { used: 0, limit: defaultQuotas.free?.hourly ?? 0 },
        tier: "free",
      };
    }
  }

  /**
   * Set custom quota for a user
   */
  async setUserQuota(
    userId: string,
    toolType: string | null,
    quota: QuotaConfig,
  ): Promise<void> {
    await db
      .insert(userToolQuotas)
      .values({
        userId,
        toolType,
        tier: quota.tier ?? "free",
        dailyLimit: quota.daily,
        hourlyLimit: quota.hourly,
        burstLimit: quota.burst,
        customLimits: quota,
      })
      .onConflictDoUpdate({
        target: toolType
          ? [userToolQuotas.userId, userToolQuotas.toolType]
          : [userToolQuotas.userId],
        set: {
          tier: quota.tier ?? "free",
          dailyLimit: quota.daily,
          hourlyLimit: quota.hourly,
          burstLimit: quota.burst,
          customLimits: quota,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Clean up old rate limit records
   */
  async cleanup(retentionHours = 24): Promise<number> {
    const cutoffDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    const result = await db
      .delete(toolRateLimits)
      .where(sql`${toolRateLimits.windowStart} < ${cutoffDate}`);

    // Drizzle returns an array with result info
    return (result as { rowCount?: number }).rowCount ?? 0;
  }

  /**
   * Get usage statistics for a user
   */
  async getUsageStats(
    userId: string,
    days = 7,
  ): Promise<{
    byTool: Record<string, number>;
    byDay: Record<string, number>;
    total: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const records = await db
      .select()
      .from(toolRateLimits)
      .where(
        and(
          eq(toolRateLimits.userId, userId),
          gte(toolRateLimits.windowStart, startDate),
        ),
      );

    const byTool: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    let total = 0;

    records.forEach((record) => {
      // By tool
      if (record.toolType) {
        byTool[record.toolType] =
          (byTool[record.toolType] ?? 0) + record.requestCount;
      }

      // By day
      const day = record.windowStart.toISOString().split("T")[0];
      if (day) {
        byDay[day] = (byDay[day] ?? 0) + record.requestCount;
      }

      total += record.requestCount;
    });

    return { byTool, byDay, total };
  }
}

// Export singleton instance
export const rateLimiter = RateLimiter.getInstance();
