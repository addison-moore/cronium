import {
  cacheService,
  cacheHelpers,
  CACHE_TTL,
  CACHE_PREFIXES,
} from "@/lib/cache/cache-service";
import crypto from "crypto";

interface CacheConfig {
  ttl?: number;
  keyPrefix?: string;
  tags?: string[];
  // Function to generate cache key from input
  getKey?: (input: unknown, userId?: string) => string;
  // Function to determine if result should be cached
  shouldCache?: (result: unknown) => boolean;
  // Function to get tags for cache invalidation
  getTags?: (input: unknown) => string[];
}

/**
 * Create a cache key from procedure path and input
 */
function createCacheKey(path: string, input: unknown, userId?: string): string {
  const inputHash = crypto
    .createHash("md5")
    .update(JSON.stringify(input || {}))
    .digest("hex");

  const parts = [path, inputHash];
  if (userId) {
    parts.push(userId);
  }

  return parts.join(":");
}

/**
 * Cache wrapper for tRPC queries
 * Since tRPC middleware can't directly return cached data,
 * we provide a wrapper function that can be used inside procedures
 */
export async function withCache<T>(
  config: CacheConfig & { key: string },
  fn: () => Promise<T>,
): Promise<T> {
  // Check if cache is available
  if (!cacheService.isAvailable()) {
    return fn();
  }

  const cacheKey = config.keyPrefix
    ? `${config.keyPrefix}${config.key}`
    : config.key;

  // Try to get from cache
  const cached = await cacheService.get<T>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // Execute the function
  const result = await fn();

  // Cache the result if it passes the shouldCache check
  if (!config.shouldCache || config.shouldCache(result)) {
    const ttl = config.ttl || CACHE_TTL.EVENT;
    const tags = config.tags || [];
    await cacheService.set(cacheKey, result, { ttl, tags });
  }

  return result;
}

/**
 * Helper to create cache-enabled query wrappers
 */
export function createCachedQuery<TInput, TOutput>(
  config: Omit<CacheConfig, "key"> & {
    keyGenerator: (input: TInput, userId?: string) => string;
  },
) {
  return async function cachedQuery(
    input: TInput,
    userId: string | undefined,
    fn: () => Promise<TOutput>,
  ): Promise<TOutput> {
    const key = config.keyGenerator(input, userId);
    const tags = config.getTags ? config.getTags(input) : [];

    return withCache(
      {
        ...config,
        key,
        tags,
      },
      fn,
    );
  };
}

/**
 * Invalidation helpers for common scenarios
 */
export const cacheInvalidation = {
  /**
   * Invalidate event-related caches
   */
  async invalidateEvent(
    eventId: number | string,
    userId?: string,
  ): Promise<void> {
    await Promise.all([
      // Invalidate specific event
      cacheHelpers.invalidateEntity("EVENT", eventId),
      // Invalidate event lists for the user
      userId && cacheHelpers.invalidateEntity("EVENT_LIST", userId),
      // Invalidate dashboard data
      userId && cacheHelpers.invalidateEntity("DASHBOARD", userId),
    ]);
  },

  /**
   * Invalidate workflow-related caches
   */
  async invalidateWorkflow(
    workflowId: number | string,
    userId?: string,
  ): Promise<void> {
    await Promise.all([
      // Invalidate specific workflow
      cacheHelpers.invalidateEntity("WORKFLOW", workflowId),
      // Invalidate dashboard data
      userId && cacheHelpers.invalidateEntity("DASHBOARD", userId),
    ]);
  },

  /**
   * Invalidate server-related caches
   */
  async invalidateServer(
    serverId: number | string,
    userId?: string,
  ): Promise<void> {
    await Promise.all([
      // Invalidate specific server
      cacheHelpers.invalidateEntity("SERVER", serverId),
      // Invalidate event lists that might include this server
      userId && cacheHelpers.invalidateEntity("EVENT_LIST", userId),
    ]);
  },

  /**
   * Invalidate user-related caches
   */
  async invalidateUser(userId: string): Promise<void> {
    await cacheHelpers.invalidateUserCache(userId);
  },

  /**
   * Invalidate log-related caches
   */
  async invalidateLogs(
    eventId?: number | string,
    userId?: string,
  ): Promise<void> {
    if (eventId) {
      await cacheService.deleteByPattern(`${CACHE_PREFIXES.LOG}*${eventId}*`);
    }
    if (userId) {
      await cacheHelpers.invalidateEntity("DASHBOARD", userId);
    }
  },
};

/**
 * Pre-configured cache queries for common use cases
 */
export const cachedQueries = {
  // Cache dashboard stats
  dashboardStats: createCachedQuery<Record<string, never>, any>({
    ttl: CACHE_TTL.DASHBOARD,
    keyPrefix: CACHE_PREFIXES.DASHBOARD,
    keyGenerator: (_, userId) => `stats:${userId || "anonymous"}`,
  }),

  // Cache event lists
  eventList: createCachedQuery<any, any>({
    ttl: CACHE_TTL.EVENT_LIST,
    keyPrefix: CACHE_PREFIXES.EVENT_LIST,
    keyGenerator: (input, userId) => {
      const inputHash = crypto
        .createHash("md5")
        .update(JSON.stringify(input || {}))
        .digest("hex");
      return `${userId || "anonymous"}:${inputHash}`;
    },
  }),

  // Cache individual events
  eventById: createCachedQuery<{ id: number }, any>({
    ttl: CACHE_TTL.EVENT,
    keyPrefix: CACHE_PREFIXES.EVENT,
    keyGenerator: (input) => `${input.id}`,
    getTags: (input) => [`event:${input.id}`],
  }),

  // Cache workflow lists
  workflowList: createCachedQuery<any, any>({
    ttl: CACHE_TTL.WORKFLOW,
    keyPrefix: CACHE_PREFIXES.WORKFLOW,
    keyGenerator: (input, userId) => {
      const inputHash = crypto
        .createHash("md5")
        .update(JSON.stringify(input || {}))
        .digest("hex");
      return `list:${userId || "anonymous"}:${inputHash}`;
    },
  }),

  // Cache individual workflows
  workflowById: createCachedQuery<{ id: number }, any>({
    ttl: CACHE_TTL.WORKFLOW,
    keyPrefix: CACHE_PREFIXES.WORKFLOW,
    keyGenerator: (input) => `${input.id}`,
    getTags: (input) => [`workflow:${input.id}`],
  }),

  // Cache server lists
  serverList: createCachedQuery<any, any>({
    ttl: CACHE_TTL.SERVER,
    keyPrefix: CACHE_PREFIXES.SERVER,
    keyGenerator: (input, userId) => {
      const inputHash = crypto
        .createHash("md5")
        .update(JSON.stringify(input || {}))
        .digest("hex");
      return `list:${userId || "anonymous"}:${inputHash}`;
    },
  }),

  // Cache individual servers
  serverById: createCachedQuery<{ id: number }, any>({
    ttl: CACHE_TTL.SERVER,
    keyPrefix: CACHE_PREFIXES.SERVER,
    keyGenerator: (input) => `${input.id}`,
    getTags: (input) => [`server:${input.id}`],
  }),
};
