// User management module
import { db } from "../../db";
import {
  users,
  events,
  logs,
  envVars,
  eventServers,
  conditionalActions,
  servers,
  apiTokens,
  UserStatus,
  UserRole,
} from "../../../shared/schema";
import type { User, InsertUser } from "../types";
import { eq, or, inArray } from "drizzle-orm";
import {
  encryptSensitiveData,
  encryptionService,
} from "../../../lib/encryption-service";

export class UserStorage {
  // Cache for the first admin user to avoid repeated queries in development
  private firstAdminUserCache: { user: User | null; timestamp: number } | null =
    null;
  private readonly ADMIN_USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return user;
  }

  async getUserByInviteToken(token: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.inviteToken, token));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    const allUsers = await db.select().from(users).orderBy(users.firstName);
    return allUsers;
  }

  async getFirstAdminUser(): Promise<User | null> {
    // Check cache first
    if (this.firstAdminUserCache) {
      const cacheAge = Date.now() - this.firstAdminUserCache.timestamp;
      if (cacheAge < this.ADMIN_USER_CACHE_TTL) {
        return this.firstAdminUserCache.user;
      }
    }

    // Query for the first admin user
    const [adminUser] = await db
      .select()
      .from(users)
      .where(eq(users.role, UserRole.ADMIN))
      .orderBy(users.createdAt)
      .limit(1);

    // Update cache
    this.firstAdminUserCache = {
      user: adminUser ?? null,
      timestamp: Date.now(),
    };

    return adminUser ?? null;
  }

  async createUser(
    userData: InsertUser & { skipPasswordHashing?: boolean },
  ): Promise<User> {
    // If we're skipping password hashing, it means the password is already hashed
    // and we shouldn't encrypt it further
    let encryptedData;
    if (userData.skipPasswordHashing) {
      // Skip encryption for password field when it's already hashed
      const { password, ...otherData } = userData;
      encryptedData = {
        ...encryptSensitiveData(otherData, "users"),
        password, // Keep the already-hashed password as-is
      };
    } else {
      // Normal flow: encrypt sensitive data first
      encryptedData = encryptSensitiveData(userData, "users");

      // Hash password if provided and not already hashed
      if (encryptedData.password) {
        // Check if password is already a bcrypt hash
        const isBcryptHash =
          encryptedData.password.startsWith("$2b$") ||
          encryptedData.password.startsWith("$2a$");
        if (!isBcryptHash) {
          encryptedData.password = await encryptionService.hashPassword(
            encryptedData.password,
          );
        }
      }
    }

    const [user] = await db.insert(users).values(encryptedData).returning();
    if (!user) {
      throw new Error("Failed to create user");
    }
    return user;
  }

  async updateUser(id: string, updateData: Partial<InsertUser>): Promise<User> {
    const [user] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();

    if (!user) {
      throw new Error("Failed to update user - user not found");
    }
    return user;
  }

  async upsertUser(userData: InsertUser): Promise<User> {
    // Try to find the user first
    const existingUser = await this.getUser(userData.id);

    if (existingUser) {
      // Update existing user
      return await this.updateUser(userData.id, userData);
    } else {
      // Create new user
      return await this.createUser(userData);
    }
  }

  async disableUser(id: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ status: UserStatus.DISABLED })
      .where(eq(users.id, id))
      .returning();

    if (!user) {
      throw new Error("Failed to disable user - user not found");
    }
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    // Use batch operations to delete user data efficiently
    // Note: Due to foreign key constraints, we need to delete in the correct order

    // Get all user's event IDs for batch deletion
    const userEvents = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.userId, id));

    const eventIds = userEvents.map((e) => e.id);

    if (eventIds.length > 0) {
      // Delete all related data in batch operations
      // Delete logs
      await db.delete(logs).where(inArray(logs.eventId, eventIds));

      // Delete environment variables
      await db.delete(envVars).where(inArray(envVars.eventId, eventIds));

      // Delete event servers
      await db
        .delete(eventServers)
        .where(inArray(eventServers.eventId, eventIds));

      // Delete conditional actions
      await db
        .delete(conditionalActions)
        .where(
          or(
            inArray(conditionalActions.successEventId, eventIds),
            inArray(conditionalActions.failEventId, eventIds),
            inArray(conditionalActions.alwaysEventId, eventIds),
            inArray(conditionalActions.conditionEventId, eventIds),
            inArray(conditionalActions.targetEventId, eventIds),
          ),
        );

      // Delete the events themselves
      await db.delete(events).where(inArray(events.id, eventIds));
    }

    // Delete the user's servers
    await db.delete(servers).where(eq(servers.userId, id));

    // Delete the user's API tokens
    await db.delete(apiTokens).where(eq(apiTokens.userId, id));

    // Delete the user
    await db.delete(users).where(eq(users.id, id));
  }
}
