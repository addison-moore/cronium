import { cacheService, CACHE_PREFIXES } from "./cache/cache-service";
import { TRPCError } from "@trpc/server";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

export interface RateLimitInfo {
  remaining: number;
  reset: Date;
  total: number;
}

/**
 * Rate Limiting Service using Redis/Valkey
 *
 * This service provides rate limiting functionality using Redis as the backend.
 * It replaces the in-memory rate limiting with a distributed solution.
 */
export class RateLimitService {
  /**
   * Check and update rate limit for a given identifier
   * @param identifier - Unique identifier (user ID, IP, etc.)
   * @param path - API path being accessed
   * @param config - Rate limit configuration
   * @returns Rate limit info
   * @throws TRPCError if rate limit exceeded
   */
  static async checkLimit(
    identifier: string,
    path: string,
    config: RateLimitConfig,
  ): Promise<RateLimitInfo> {
    const {
      maxRequests,
      windowMs,
      keyPrefix = CACHE_PREFIXES.RATE_LIMIT,
    } = config;
    const key = `${keyPrefix}${identifier}:${path}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // If cache is not available, allow the request (fail open)
    if (!cacheService.isAvailable()) {
      console.warn("Rate limiting disabled: Redis not available");
      return {
        remaining: maxRequests,
        reset: new Date(now + windowMs),
        total: maxRequests,
      };
    }

    try {
      // Get current count from cache
      const current = await cacheService.get<{
        count: number;
        windowStart: number;
      }>(key);

      if (!current || current.windowStart < windowStart) {
        // New window or expired window
        const newWindow = {
          count: 1,
          windowStart: now,
        };
        await cacheService.set(key, newWindow, {
          ttl: Math.ceil(windowMs / 1000),
        });

        return {
          remaining: maxRequests - 1,
          reset: new Date(now + windowMs),
          total: maxRequests,
        };
      }

      // Check if limit exceeded
      if (current.count >= maxRequests) {
        const resetTime = new Date(current.windowStart + windowMs);
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Rate limit exceeded. Please try again after ${resetTime.toISOString()}`,
        });
      }

      // Increment count
      current.count++;
      await cacheService.set(key, current, {
        ttl: Math.ceil((current.windowStart + windowMs - now) / 1000),
      });

      return {
        remaining: maxRequests - current.count,
        reset: new Date(current.windowStart + windowMs),
        total: maxRequests,
      };
    } catch (error) {
      // Re-throw TRPCError
      if (error instanceof TRPCError) {
        throw error;
      }

      // Log other errors but allow request (fail open)
      console.error("Rate limiting error:", error);
      return {
        remaining: maxRequests,
        reset: new Date(now + windowMs),
        total: maxRequests,
      };
    }
  }

  /**
   * Reset rate limit for a specific identifier
   * @param identifier - Unique identifier
   * @param path - API path (optional, if not provided, resets all paths)
   */
  static async reset(identifier: string, path?: string): Promise<void> {
    if (!cacheService.isAvailable()) {
      return;
    }

    const pattern = path
      ? `${CACHE_PREFIXES.RATE_LIMIT}${identifier}:${path}`
      : `${CACHE_PREFIXES.RATE_LIMIT}${identifier}:*`;

    await cacheService.deleteByPattern(pattern);
  }

  /**
   * Get current rate limit status without incrementing
   * @param identifier - Unique identifier
   * @param path - API path
   * @param config - Rate limit configuration
   * @returns Current rate limit info
   */
  static async getStatus(
    identifier: string,
    path: string,
    config: RateLimitConfig,
  ): Promise<RateLimitInfo> {
    const {
      maxRequests,
      windowMs,
      keyPrefix = CACHE_PREFIXES.RATE_LIMIT,
    } = config;
    const key = `${keyPrefix}${identifier}:${path}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!cacheService.isAvailable()) {
      return {
        remaining: maxRequests,
        reset: new Date(now + windowMs),
        total: maxRequests,
      };
    }

    const current = await cacheService.get<{
      count: number;
      windowStart: number;
    }>(key);

    if (!current || current.windowStart < windowStart) {
      return {
        remaining: maxRequests,
        reset: new Date(now + windowMs),
        total: maxRequests,
      };
    }

    return {
      remaining: Math.max(0, maxRequests - current.count),
      reset: new Date(current.windowStart + windowMs),
      total: maxRequests,
    };
  }
}

/**
 * Create rate limiting middleware for tRPC
 * @param maxRequests - Maximum requests allowed
 * @param windowMs - Time window in milliseconds
 * @returns Rate limiting middleware
 */
export function createRateLimitMiddleware(maxRequests = 100, windowMs = 60000) {
  return async ({ ctx, path, next }: any) => {
    const identifier =
      ctx.session?.user?.id ??
      ctx.headers?.get("x-forwarded-for") ??
      "anonymous";

    await RateLimitService.checkLimit(identifier, path, {
      maxRequests,
      windowMs,
    });

    return next();
  };
}
