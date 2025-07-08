import { LRUCache } from "lru-cache";
import type { ToolType } from "@/shared/schema";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import { eq } from "drizzle-orm";

interface CachedCredential {
  id: number;
  userId: string;
  name: string;
  type: ToolType;
  credentials: any;
  isActive: boolean;
  tags?: string[];
  encrypted: boolean;
  encryptionMetadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  // Cache metadata
  cachedAt: Date;
  accessCount: number;
}

interface CredentialCacheOptions {
  maxSize?: number;
  ttl?: number; // Time to live in milliseconds
  staleWhileRevalidate?: number; // Time to serve stale while fetching fresh
}

/**
 * Credential cache manager to reduce database lookups
 * Implements stale-while-revalidate pattern for better performance
 */
export class CredentialCacheManager {
  private static instance: CredentialCacheManager;
  private cache: LRUCache<string, CachedCredential>;
  private revalidationPromises: Map<string, Promise<CachedCredential | null>>;

  private defaultOptions: Required<CredentialCacheOptions> = {
    maxSize: 500,
    ttl: 1000 * 60 * 5, // 5 minutes
    staleWhileRevalidate: 1000 * 60 * 2, // 2 minutes
  };

  private constructor(options?: CredentialCacheOptions) {
    const opts = { ...this.defaultOptions, ...options };

    this.cache = new LRUCache<string, CachedCredential>({
      max: opts.maxSize,
      ttl: opts.ttl,
      updateAgeOnGet: true,
      // Allow stale entries to be returned while revalidating
      allowStale: true,
      // Track fetch status
      fetchMethod: async (key: string) => {
        const [toolId, userId] = key.split("-");
        if (!toolId || !userId) {
          return undefined;
        }
        return this.fetchCredential(parseInt(toolId), userId) ?? undefined;
      },
    });

    this.revalidationPromises = new Map();
  }

  static getInstance(options?: CredentialCacheOptions): CredentialCacheManager {
    if (!CredentialCacheManager.instance) {
      CredentialCacheManager.instance = new CredentialCacheManager(options);
    }
    return CredentialCacheManager.instance;
  }

  /**
   * Get cached credential with stale-while-revalidate
   */
  async get(toolId: number, userId: string): Promise<CachedCredential | null> {
    const key = `${toolId}-${userId}`;

    // Try to get from cache
    const cached = this.cache.get(key);

    if (cached) {
      // Update access count
      cached.accessCount++;

      // Check if stale
      const age = Date.now() - cached.cachedAt.getTime();
      const isStale = age > this.defaultOptions.ttl;

      if (isStale) {
        // Return stale data while revalidating in background
        this.revalidateInBackground(toolId, userId);
      }

      return cached;
    }

    // Not in cache, fetch from database
    return this.fetchAndCache(toolId, userId);
  }

  /**
   * Invalidate cached credential
   */
  invalidate(toolId: number, userId: string): void {
    const key = `${toolId}-${userId}`;
    this.cache.delete(key);
  }

  /**
   * Invalidate all credentials for a user
   */
  invalidateUser(userId: string): void {
    for (const [key, credential] of this.cache.entries()) {
      if (credential.userId === userId) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Warm up cache for a user's active tools
   */
  async warmUp(userId: string): Promise<void> {
    try {
      const tools = await db
        .select()
        .from(toolCredentials)
        .where(eq(toolCredentials.userId, userId));

      // Cache all active tools
      for (const tool of tools) {
        if (tool.isActive) {
          const key = `${tool.id}-${userId}`;
          const cached: CachedCredential = {
            ...tool,
            credentials:
              typeof tool.credentials === "string"
                ? JSON.parse(tool.credentials)
                : tool.credentials,
            cachedAt: new Date(),
            accessCount: 0,
          };
          this.cache.set(key, cached);
        }
      }
    } catch (error) {
      console.error("Error warming up credential cache:", error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    credentials: Array<{
      toolId: number;
      userId: string;
      accessCount: number;
      age: number;
    }>;
  } {
    const entries = Array.from(this.cache.entries());
    const totalAccess = entries.reduce(
      (sum, [_, cred]) => sum + cred.accessCount,
      0,
    );

    return {
      size: this.cache.size,
      maxSize: this.cache.max,
      hitRate: totalAccess > 0 ? this.cache.size / totalAccess : 0,
      credentials: entries.map(([key, cred]) => ({
        toolId: cred.id,
        userId: cred.userId,
        accessCount: cred.accessCount,
        age: Date.now() - cred.cachedAt.getTime(),
      })),
    };
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
    this.revalidationPromises.clear();
  }

  /**
   * Fetch credential from database
   */
  private async fetchCredential(
    toolId: number,
    userId: string,
  ): Promise<CachedCredential | null> {
    try {
      const [tool] = await db
        .select()
        .from(toolCredentials)
        .where(eq(toolCredentials.id, toolId))
        .limit(1);

      if (!tool || tool.userId !== userId) {
        return null;
      }

      return {
        ...tool,
        credentials:
          typeof tool.credentials === "string"
            ? JSON.parse(tool.credentials)
            : tool.credentials,
        cachedAt: new Date(),
        accessCount: 1,
      };
    } catch (error) {
      console.error("Error fetching credential:", error);
      return null;
    }
  }

  /**
   * Fetch and cache credential
   */
  private async fetchAndCache(
    toolId: number,
    userId: string,
  ): Promise<CachedCredential | null> {
    const key = `${toolId}-${userId}`;

    // Check if already fetching
    const existingPromise = this.revalidationPromises.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    // Create new fetch promise
    const promise = this.fetchCredential(toolId, userId);
    this.revalidationPromises.set(key, promise);

    try {
      const credential = await promise;
      if (credential) {
        this.cache.set(key, credential);
      }
      return credential;
    } finally {
      this.revalidationPromises.delete(key);
    }
  }

  /**
   * Revalidate credential in background
   */
  private async revalidateInBackground(
    toolId: number,
    userId: string,
  ): Promise<void> {
    const key = `${toolId}-${userId}`;

    // Skip if already revalidating
    if (this.revalidationPromises.has(key)) {
      return;
    }

    // Fetch fresh data in background
    this.fetchAndCache(toolId, userId).catch((error) => {
      console.error("Background revalidation failed:", error);
    });
  }
}

// Export singleton instance
export const credentialCache = CredentialCacheManager.getInstance();
