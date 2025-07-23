import { cacheService, CACHE_TTL } from "@/lib/cache/cache-service";

interface CacheConfig {
  ttl?: number;
  keyPrefix?: string;
  // Function to determine if result should be cached
  shouldCache?: (result: unknown) => boolean;
}

// createCacheKey function removed - no longer needed for CRUD operations

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
    const ttl = config.ttl ?? CACHE_TTL.STATIC;
    await cacheService.set(cacheKey, result, { ttl });
  }

  return result;
}

// createCachedQuery function removed - no longer needed for CRUD operations

// cacheInvalidation helpers have been removed as part of caching simplification
// Since CRUD operations no longer use caching, invalidation is not needed

// cachedQueries have been removed as part of caching simplification
// All CRUD operations now fetch data directly from storage
