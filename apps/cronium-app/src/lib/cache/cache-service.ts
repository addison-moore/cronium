import Redis, { type Redis as RedisClient } from "ioredis";
import { env } from "@/env.mjs";
import superjson from "superjson";

// Cache key prefixes for remaining cache use cases
export const CACHE_PREFIXES = {
  USER: "user:", // For session/auth caching
  RATE_LIMIT: "rate_limit:", // For rate limiting
  STATIC: "static:", // For static resources
} as const;

// TTL values in seconds for remaining cache use cases
export const CACHE_TTL = {
  USER: 600, // 10 minutes for session data
  RATE_LIMIT: 60, // 1 minute for rate limiting windows
  STATIC: 3600, // 1 hour for static resources
} as const;

export interface CacheOptions {
  ttl?: number;
  tags?: string[];
}

export class CacheService {
  private client: RedisClient | null = null;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    // Don't block initialization on connection
    this.connect().catch((error) => {
      console.error("Failed to initialize cache connection:", error);
    });
  }

  private async connect(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this._connect();
    return this.connectionPromise;
  }

  private async _connect(): Promise<void> {
    try {
      // Use VALKEY_URL if available, otherwise fallback to REDIS_URL
      const redisUrl = env.VALKEY_URL ?? env.REDIS_URL;

      if (!redisUrl) {
        console.warn("No VALKEY_URL or REDIS_URL configured, caching disabled");
        return;
      }

      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy: (times) => {
          const delay = Math.min(times * 100, 3000);
          return delay;
        },
        reconnectOnError: (err) => {
          const targetError = "READONLY";
          if (err.message.includes(targetError)) {
            // Only reconnect when the error contains "READONLY"
            return true;
          }
          return false;
        },
      });

      this.client.on("connect", () => {
        console.log("Connected to Valkey/Redis cache");
        this.isConnected = true;
      });

      this.client.on("error", (error) => {
        console.error("Valkey/Redis connection error:", error);
        this.isConnected = false;
      });

      this.client.on("close", () => {
        console.log("Valkey/Redis connection closed");
        this.isConnected = false;
      });

      // Wait for connection
      await this.client.ping();
    } catch (error) {
      console.error("Failed to connect to Valkey/Redis:", error);
      this.client = null;
      this.isConnected = false;
    }
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      if (!this.client || !this.isConnected) {
        return null;
      }

      const value = await this.client.get(key);
      if (!value) {
        return null;
      }

      // Use superjson for proper serialization/deserialization
      return superjson.parse(value);
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      // Return null on any error to prevent app crashes
      return null;
    }
  }

  /**
   * Set a value in cache
   */
  async set<T>(
    key: string,
    value: T,
    options: CacheOptions = {},
  ): Promise<boolean> {
    try {
      if (!this.client || !this.isConnected) {
        return false;
      }

      const serialized = superjson.stringify(value);
      const ttl = options.ttl ?? CACHE_TTL.STATIC;

      if (ttl > 0) {
        await this.client.setex(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }

      // Handle cache tags for group invalidation
      if (options.tags && options.tags.length > 0) {
        for (const tag of options.tags) {
          await this.client.sadd(`tag:${tag}`, key);
          // Set expiry on tag set to prevent memory leak
          await this.client.expire(`tag:${tag}`, ttl + 60);
        }
      }

      return true;
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
      // Return false on any error to prevent app crashes
      return false;
    }
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async deleteByPattern(pattern: string): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      return false;
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
      return true;
    } catch (error) {
      console.error(`Cache delete by pattern error for ${pattern}:`, error);
      return false;
    }
  }

  /**
   * Delete all keys with a specific tag
   */
  async deleteByTag(tag: string): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      return false;
    }

    try {
      const keys = await this.client.smembers(`tag:${tag}`);
      if (keys.length > 0) {
        await this.client.del(...keys);
        await this.client.del(`tag:${tag}`);
      }
      return true;
    } catch (error) {
      console.error(`Cache delete by tag error for ${tag}:`, error);
      return false;
    }
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      return false;
    }

    try {
      await this.client.flushdb();
      return true;
    } catch (error) {
      console.error("Cache clear error:", error);
      return false;
    }
  }

  /**
   * Check if cache is available
   */
  isAvailable(): boolean {
    return this.isConnected;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    hits: number;
    misses: number;
    hitRate: number;
  } | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }

    try {
      const info = await this.client.info("stats");
      const stats = info.split("\r\n").reduce(
        (acc, line) => {
          const [key, value] = line.split(":");
          if (key && value) {
            acc[key] = value;
          }
          return acc;
        },
        {} as Record<string, string>,
      );

      const hits = parseInt(stats.keyspace_hits ?? "0", 10);
      const misses = parseInt(stats.keyspace_misses ?? "0", 10);
      const total = hits + misses;
      const hitRate = total > 0 ? hits / total : 0;

      return { hits, misses, hitRate };
    } catch (error) {
      console.error("Cache stats error:", error);
      return null;
    }
  }

  /**
   * Disconnect from cache
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
  }
}

// Store singleton on global to persist across hot reloads in development
declare global {
  // eslint-disable-next-line no-var
  var __cacheService: CacheService | undefined;
}

// Export singleton instance
if (!global.__cacheService) {
  global.__cacheService = new CacheService();
}
export const cacheService = global.__cacheService;

// Helper functions for common cache operations
export const cacheHelpers = {
  /**
   * Get or set cache with a factory function
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {},
  ): Promise<T> {
    // Try to get from cache first
    const cached = await cacheService.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // If not in cache, get from factory and cache it
    const value = await factory();
    await cacheService.set(key, value, options);
    return value;
  },

  /**
   * Invalidate cache for an entity
   */
  async invalidateEntity(
    entityType: keyof typeof CACHE_PREFIXES,
    entityId: string | number,
  ): Promise<void> {
    const prefix = CACHE_PREFIXES[entityType];
    await cacheService.deleteByPattern(`${prefix}${entityId}*`);
  },

  /**
   * Invalidate cache for a user's session/auth data
   */
  async invalidateUserCache(userId: string): Promise<void> {
    await cacheService.deleteByPattern(`${CACHE_PREFIXES.USER}${userId}*`);
  },
};
