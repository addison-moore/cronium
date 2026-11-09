import Redis, { type Redis as RedisClient } from "ioredis";
import { env } from "@/env.mjs";
import superjson from "superjson";
import { normalizeValkeyUrl } from "@/lib/valkey-url";
import { failureWithStack } from "@/lib/pg-errors";
import { quotedForLog } from "@/lib/security/audit-entry";
import { CacheUnavailableError } from "./cache-unavailable";

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

/**
 * A key for the log, cut before its last segment. That segment can be a credential:
 * MCP OAuth's keys are `mcpoauth:code:<code>` and `mcpoauth:rt:<jti>`. What's left
 * says which kind of key failed. It can still hold text from a request, since a client
 * can send a code with a colon in it, so it stays out of the format string and is
 * masked like any other quoted text.
 */
function keyForLog(key: string): string {
  const kept = key.slice(0, key.lastIndexOf(":") + 1);
  return `${quotedForLog(kept)}[not logged]`;
}

/**
 * A command's failure without what ioredis adds to it: `command.args`, which holds the key and
 * the value, so an MCP OAuth code or token, for anything that logs the error whole.
 */
function failureWithoutArguments(error: unknown): Error {
  const { name, message, code } =
    typeof error === "object" && error !== null
      ? (error as { name?: unknown; message?: unknown; code?: unknown })
      : {};
  const copy = new Error(typeof message === "string" ? message : String(error));
  if (typeof name === "string") copy.name = name;
  if (typeof code === "string") Object.assign(copy, { code });
  return copy;
}

export class CacheService {
  private client: RedisClient | null = null;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    // Don't block initialization on connection
    this.connect().catch((error) => {
      console.error(
        "Failed to initialize cache connection:",
        failureWithStack(error),
      );
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

      this.client = new Redis(normalizeValkeyUrl(redisUrl), {
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
        console.error(
          "Valkey/Redis connection error:",
          failureWithStack(error),
        );
        this.isConnected = false;
      });

      this.client.on("close", () => {
        console.log("Valkey/Redis connection closed");
        this.isConnected = false;
      });

      // Wait for connection
      await this.client.ping();
    } catch (error) {
      // As when the app starts before Valkey. The client is kept: ioredis goes on trying, and
      // the "connect" event makes it usable once it gets through. Dropping it left the cache
      // off until a restart, every read a miss, while isAvailable() said it was on.
      console.error(
        "Failed to connect to Valkey/Redis:",
        failureWithStack(error),
      );
    }
  }

  /** Runs one command, and throws CacheUnavailableError for any way that fails. */
  private async ask<R>(
    command: string,
    send: (client: RedisClient) => Promise<R>,
  ): Promise<R> {
    // The first connection may still be on its way, as on a process's first request, which
    // loads this. Waiting for it costs milliseconds, where refusing would be a false outage.
    // It settles either way, so a Valkey that's down at the start fails here in seconds.
    await this.connectionPromise;
    if (!this.client || !this.isConnected) {
      throw new CacheUnavailableError("Valkey isn't connected");
    }
    try {
      return await send(this.client);
    } catch (error) {
      throw new CacheUnavailableError(`Valkey couldn't answer ${command}`, {
        cause: failureWithoutArguments(error),
      });
    }
  }

  /** A stored value. One that doesn't parse can't be used, so it reads as missing. */
  private parsedOrMissing<T>(key: string, value: string | null): T | null {
    if (!value) return null;
    try {
      return superjson.parse<T>(value);
    } catch (error) {
      console.error(
        "Cache value for key %s doesn't parse:",
        keyForLog(key),
        failureWithStack(error),
      );
      return null;
    }
  }

  /**
   * Like `get`, except that a Valkey it couldn't ask throws CacheUnavailableError, where `get`
   * answers null as it does for a miss. For a value whose absence is a verdict, such as a
   * single-use credential's, so that an outage doesn't read as one.
   */
  async getStrict<T>(key: string): Promise<T | null> {
    const value = await this.ask("GET", (client) => client.get(key));
    return this.parsedOrMissing<T>(key, value);
  }

  /**
   * Atomically gets and deletes a value (GETDEL), for single-use credentials such as MCP
   * OAuth's codes and refresh tokens: of any number of callers, one gets it. Null means it
   * isn't there, and a Valkey it couldn't ask throws CacheUnavailableError, as for getStrict.
   * A reply lost on the way back can't be told from a failure, though the key may be gone.
   */
  async getdelStrict<T>(key: string): Promise<T | null> {
    const value = await this.ask("GETDEL", (client) => client.getdel(key));
    return this.parsedOrMissing<T>(key, value);
  }

  /**
   * Like `set` without tags, except that a write Valkey refused, or that couldn't be sent,
   * throws CacheUnavailableError where `set` answers false. A reply lost on the way back
   * throws too, though the value may be stored.
   */
  async setStrict<T>(
    key: string,
    value: T,
    options: { ttl: number },
  ): Promise<void> {
    const serialized = superjson.stringify(value);
    await this.ask("SET", (client) =>
      client.setex(key, options.ttl, serialized),
    );
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
      console.error(
        "Cache get error for key %s:",
        keyForLog(key),
        failureWithStack(error),
      );
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
      console.error(
        "Cache set error for key %s:",
        keyForLog(key),
        failureWithStack(error),
      );
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
      console.error(
        "Cache delete error for key %s:",
        keyForLog(key),
        failureWithStack(error),
      );
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
      console.error(
        "Cache delete by pattern error for %s:",
        keyForLog(pattern),
        failureWithStack(error),
      );
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
      console.error("Cache clear error:", failureWithStack(error));
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
      console.error("Cache stats error:", failureWithStack(error));
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
  var __cacheService: CacheService | undefined;
}

// Export singleton instance
global.__cacheService ??= new CacheService();
export const cacheService = global.__cacheService;
