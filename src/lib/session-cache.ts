import { cacheService, CACHE_PREFIXES, CACHE_TTL } from "./cache/cache-service";
import { storage } from "@/server/storage";
import { UserStatus } from "@/shared/schema";
import type { User } from "@/shared/schema";

export interface CachedSession {
  user: {
    id: string;
    email: string | null;
    username: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
    role: string;
    status: string;
  };
  permissions?: string[];
  lastValidated: Date;
}

/**
 * Session Cache Service
 *
 * Provides caching for user sessions to reduce database lookups
 * while maintaining security through proper invalidation.
 */
export class SessionCache {
  /**
   * Get cached session data
   * @param userId - User ID
   * @returns Cached session or null if not found/expired
   */
  static async getSession(userId: string): Promise<CachedSession | null> {
    if (!cacheService.isAvailable()) {
      return null;
    }

    const key = `${CACHE_PREFIXES.USER}session:${userId}`;
    return await cacheService.get<CachedSession>(key);
  }

  /**
   * Cache session data
   * @param userId - User ID
   * @param session - Session data to cache
   * @param ttl - TTL in seconds (default: 10 minutes)
   */
  static async setSession(
    userId: string,
    session: CachedSession,
    ttl: number = CACHE_TTL.USER,
  ): Promise<void> {
    if (!cacheService.isAvailable()) {
      return;
    }

    const key = `${CACHE_PREFIXES.USER}session:${userId}`;
    await cacheService.set(key, session, { ttl });
  }

  /**
   * Invalidate session cache
   * @param userId - User ID
   */
  static async invalidateSession(userId: string): Promise<void> {
    if (!cacheService.isAvailable()) {
      return;
    }

    const key = `${CACHE_PREFIXES.USER}session:${userId}`;
    await cacheService.delete(key);
  }

  /**
   * Get or fetch user session with caching
   * @param userId - User ID
   * @returns User session data
   */
  static async getOrFetchSession(
    userId: string,
  ): Promise<CachedSession | null> {
    // Try cache first
    const cached = await this.getSession(userId);
    if (cached) {
      // Check if session needs revalidation (older than 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (cached.lastValidated > fiveMinutesAgo) {
        return cached;
      }
    }

    // Fetch from database
    const user = await storage.getUser(userId);
    if (!user) {
      return null;
    }

    // Check if user is active
    if (
      user.status === UserStatus.DISABLED ||
      user.status === UserStatus.INVITED
    ) {
      // Don't cache inactive users
      return null;
    }

    // Build session data
    const session: CachedSession = {
      user: {
        id: user.id,
        email: user.email ?? null,
        username: user.username,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        profileImageUrl: user.profileImageUrl ?? null,
        role: user.role,
        status: user.status,
      },
      lastValidated: new Date(),
    };

    // Cache the session
    await this.setSession(userId, session);

    return session;
  }

  /**
   * Update cached session data
   * @param userId - User ID
   * @param updates - Partial session updates
   */
  static async updateSession(
    userId: string,
    updates: Partial<CachedSession["user"]>,
  ): Promise<void> {
    const session = await this.getSession(userId);
    if (!session) {
      return;
    }

    // Apply updates
    session.user = { ...session.user, ...updates };
    session.lastValidated = new Date();

    // Save updated session
    await this.setSession(userId, session);
  }

  /**
   * Invalidate all sessions (e.g., on system-wide changes)
   */
  static async invalidateAllSessions(): Promise<void> {
    if (!cacheService.isAvailable()) {
      return;
    }

    await cacheService.deleteByPattern(`${CACHE_PREFIXES.USER}session:*`);
  }
}

/**
 * NextAuth session callback enhancement with caching
 */
export async function enhancedSessionCallback({ session, token }: any) {
  if (token && session.user) {
    // Try to get cached session first
    const cachedSession = await SessionCache.getOrFetchSession(token.id);

    if (cachedSession) {
      session.user = cachedSession.user;
    } else {
      // Fallback to token data
      session.user.id = token.id;
      session.user.username = token.username!;
      session.user.firstName = token.firstName!;
      session.user.lastName = token.lastName!;
      session.user.profileImageUrl = token.profileImageUrl!;
      session.user.role = token.role;
      session.user.status = token.status;
    }
  }
  return session;
}

/**
 * Middleware to invalidate session on logout
 */
export async function handleLogout(userId: string): Promise<void> {
  await SessionCache.invalidateSession(userId);
}

/**
 * Middleware to invalidate session on permission changes
 */
export async function handlePermissionChange(userId: string): Promise<void> {
  await SessionCache.invalidateSession(userId);
}
