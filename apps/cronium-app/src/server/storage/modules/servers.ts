import { db } from "../../db";
import {
  servers,
  events,
  eventServers,
  executions,
  serverDeletionNotifications,
  RunLocation,
  EventStatus,
} from "../../../shared/schema";
import type {
  Server,
  InsertServer,
  EventServer,
  ServerDeletionNotification,
} from "../../../shared/schema";
import { eq, and, or, sql, lte, gte, desc } from "drizzle-orm";
import {
  encryptSensitiveData,
  decryptSensitiveData,
} from "../../../lib/encryption-service";

export class ServerStorage {
  // Server CRUD methods
  async getServer(id: number): Promise<Server | undefined> {
    const [server] = await db.select().from(servers).where(eq(servers.id, id));
    if (server) {
      try {
        return decryptSensitiveData<Server>(server, "servers");
      } catch (error) {
        console.error(`Error decrypting server ${id} data:`, error);
        // Return server without decryption rather than failing
        return server;
      }
    }
    return server;
  }

  async getAllServers(
    userId: string,
    includeArchived = false,
  ): Promise<Server[]> {
    // Build the where clause
    const userCondition = or(
      eq(servers.userId, userId), // User's own servers
      eq(servers.shared, true), // Shared servers from other users
    );

    // Combine with archive filter if needed
    const whereClause = includeArchived
      ? userCondition
      : and(userCondition, eq(servers.isArchived, false));

    const allUserServers = await db
      .select()
      .from(servers)
      .where(whereClause)
      .orderBy(servers.name);

    // Decrypt sensitive data for all servers (if not purged)
    return allUserServers.map((server) => {
      // Only decrypt if not purged
      if (server.sshKeyPurged) {
        server.sshKey = null;
      }
      if (server.passwordPurged) {
        server.password = null;
      }
      return decryptSensitiveData(server, "servers");
    });
  }

  async canUserAccessServer(
    serverId: number,
    userId: string,
  ): Promise<boolean> {
    const server = await db
      .select()
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);

    if (server.length === 0) return false;

    // User can access if they own the server or if it's shared
    return server[0]?.userId === userId || server[0]?.shared === true;
  }

  async createServer(insertServer: InsertServer): Promise<Server> {
    // Encrypt sensitive server data before storing
    const encryptedData = encryptSensitiveData(insertServer, "servers");

    const [server] = await db.insert(servers).values(encryptedData).returning();

    if (!server) {
      throw new Error("Failed to create server");
    }
    // Return decrypted data for immediate use
    return decryptSensitiveData<Server>(server, "servers");
  }

  async updateServer(
    id: number,
    updateData: Partial<InsertServer>,
  ): Promise<Server> {
    // Encrypt sensitive data before updating
    const encryptedData = encryptSensitiveData(updateData, "servers");

    const [server] = await db
      .update(servers)
      .set(encryptedData)
      .where(eq(servers.id, id))
      .returning();

    if (!server) {
      throw new Error(`Server with id ${id} not found`);
    }

    // Return decrypted data for immediate use
    return decryptSensitiveData<Server>(server, "servers");
  }

  async updateServerStatus(
    id: number,
    online: boolean,
    lastChecked: Date,
  ): Promise<Server> {
    const [server] = await db
      .update(servers)
      .set({
        online: online,
        lastChecked: lastChecked,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, id))
      .returning();

    if (!server) {
      throw new Error("Failed to update server status - server not found");
    }
    return server;
  }

  async getServerDeletionImpact(id: number): Promise<{
    eventCount: number;
    eventServerCount: number;
    executionCount: number;
    activeEvents: Array<{ id: number; name: string; status: string }>;
  }> {
    // Get counts of affected resources using simple array length
    // This is more reliable than SQL count() which can have type issues

    // Count events using this server
    const affectedEvents = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.serverId, id));

    // Count multi-server configurations using this server
    const affectedEventServers = await db
      .select({ id: eventServers.eventId })
      .from(eventServers)
      .where(eq(eventServers.serverId, id));

    // Count executions on this server
    const affectedExecutions = await db
      .select({ id: executions.id })
      .from(executions)
      .where(eq(executions.serverId, id));

    // Get active events that would be affected (with more details)
    const activeEvents = await db
      .select({
        id: events.id,
        name: events.name,
        status: events.status,
      })
      .from(events)
      .where(
        and(eq(events.serverId, id), eq(events.status, EventStatus.ACTIVE)),
      )
      .limit(10);

    return {
      eventCount: affectedEvents.length,
      eventServerCount: affectedEventServers.length,
      executionCount: affectedExecutions.length,
      activeEvents,
    };
  }

  async archiveServer(
    id: number,
    userId: string,
    reason?: string,
  ): Promise<Server> {
    // Get the server first to ensure it exists
    const server = await this.getServer(id);
    if (!server) {
      throw new Error(`Server ${id} not found`);
    }

    // Archive the server with sensitive data purging
    const [archivedServer] = await db
      .update(servers)
      .set({
        isArchived: true,
        archivedAt: new Date(),
        archivedBy: userId,
        archiveReason: reason,
        // Purge sensitive data immediately
        sshKey: null,
        password: null,
        sshKeyPurged: true,
        passwordPurged: true,
        // Schedule for permanent deletion in 30 days
        deletionScheduledAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(servers.id, id))
      .returning();

    if (!archivedServer) {
      throw new Error(`Failed to archive server ${id}`);
    }

    return archivedServer;
  }

  async restoreServer(id: number): Promise<Server> {
    // Get the server first to ensure it exists and is archived
    const server = await this.getServer(id);
    if (!server) {
      throw new Error(`Server ${id} not found`);
    }
    if (!server.isArchived) {
      throw new Error(`Server ${id} is not archived`);
    }

    // Check if sensitive data was purged (cannot restore if purged)
    if (server.sshKeyPurged || server.passwordPurged) {
      throw new Error(
        `Cannot restore server ${id}: sensitive credentials have been purged. Please reconfigure the server after restoration.`,
      );
    }

    // Restore the server
    const [restoredServer] = await db
      .update(servers)
      .set({
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
        deletionScheduledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, id))
      .returning();

    if (!restoredServer) {
      throw new Error(`Failed to restore server ${id}`);
    }

    return restoredServer;
  }

  async getArchivedServers(userId: string): Promise<Server[]> {
    const archivedServers = await db
      .select()
      .from(servers)
      .where(and(eq(servers.userId, userId), eq(servers.isArchived, true)))
      .orderBy(servers.archivedAt);

    // Decrypt sensitive data for archived servers (if not purged)
    return archivedServers.map((server) => {
      // Only decrypt if not purged
      if (server.sshKeyPurged) {
        server.sshKey = null;
      }
      if (server.passwordPurged) {
        server.password = null;
      }
      return decryptSensitiveData(server, "servers");
    });
  }

  async permanentlyDeleteServer(id: number): Promise<void> {
    // Get the server first to ensure it exists and is archived
    const server = await this.getServer(id);
    if (!server) {
      throw new Error(`Server ${id} not found`);
    }
    if (!server.isArchived) {
      throw new Error(
        `Server ${id} must be archived before permanent deletion`,
      );
    }

    // Now perform the actual deletion (using the existing deleteServer logic)
    await this.deleteServer(id);
  }

  async deleteServer(id: number): Promise<void> {
    // First, get counts of affected resources for logging
    const [eventCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(eq(events.serverId, id));

    const [eventServerCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(eventServers)
      .where(eq(eventServers.serverId, id));

    const [executionCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(executions)
      .where(eq(executions.serverId, id));

    // Use a transaction to ensure all operations complete or none do
    await db.transaction(async (tx) => {
      try {
        // 1. Delete event-server relationships FIRST (this was the issue)
        if (eventServerCount?.count && eventServerCount.count > 0) {
          await tx.delete(eventServers).where(eq(eventServers.serverId, id));
        }

        // 2. Update any events that use this server to run locally
        if (eventCount?.count && eventCount.count > 0) {
          await tx
            .update(events)
            .set({
              runLocation: RunLocation.LOCAL,
              serverId: null,
            })
            .where(eq(events.serverId, id));
        }

        // 3. Update executions to remove server reference (keep the execution records)
        if (executionCount?.count && executionCount.count > 0) {
          await tx
            .update(executions)
            .set({
              serverId: null,
              serverName: null,
            })
            .where(eq(executions.serverId, id));
        }

        // 4. Finally delete the server (runnerDeployments will cascade delete)
        await tx.delete(servers).where(eq(servers.id, id));
      } catch (error) {
        console.error(
          `Error in transaction while deleting server ${id}:`,
          error,
        );
        throw error;
      }
    });
  }

  // Event-Server relationship methods
  async getEventServers(eventId: number): Promise<EventServer[]> {
    const eventServerList = await db
      .select()
      .from(eventServers)
      .where(eq(eventServers.eventId, eventId));

    return eventServerList;
  }

  async addEventServer(
    eventId: number,
    serverId: number,
  ): Promise<EventServer> {
    const [eventServer] = await db
      .insert(eventServers)
      .values({ eventId, serverId })
      .returning();

    if (!eventServer) {
      throw new Error("Failed to add event server association");
    }
    return eventServer;
  }

  async removeEventServer(eventId: number, serverId: number): Promise<void> {
    await db
      .delete(eventServers)
      .where(
        and(
          eq(eventServers.eventId, eventId),
          eq(eventServers.serverId, serverId),
        ),
      );
  }

  async setEventServers(eventId: number, serverIds: number[]): Promise<void> {
    // Remove all existing event-server relationships for this event
    await db.delete(eventServers).where(eq(eventServers.eventId, eventId));

    // Add new relationships if serverIds is not empty
    if (serverIds.length > 0) {
      const eventServerData = serverIds.map((serverId) => ({
        eventId,
        serverId,
      }));

      await db.insert(eventServers).values(eventServerData);
    }
  }

  // Cleanup service methods
  async getServersScheduledForDeletion(limit = 10): Promise<Server[]> {
    const now = new Date();

    const serversToDelete = await db
      .select()
      .from(servers)
      .where(
        and(
          eq(servers.isArchived, true),
          lte(servers.deletionScheduledAt, now),
        ),
      )
      .limit(limit);

    return serversToDelete.map((server) => {
      // Don't decrypt purged data
      if (server.sshKeyPurged) {
        server.sshKey = null;
      }
      if (server.passwordPurged) {
        server.password = null;
      }
      return server;
    });
  }

  async getServersApproachingDeletion(daysAhead: number): Promise<Server[]> {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysAhead);

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const serversApproaching = await db
      .select()
      .from(servers)
      .where(
        and(
          eq(servers.isArchived, true),
          gte(servers.deletionScheduledAt, startOfDay),
          lte(servers.deletionScheduledAt, endOfDay),
        ),
      );

    return serversApproaching.map((server) => {
      // Don't decrypt purged data
      if (server.sshKeyPurged) {
        server.sshKey = null;
      }
      if (server.passwordPurged) {
        server.password = null;
      }
      return server;
    });
  }

  async hasNotificationBeenSent(
    serverId: number,
    notificationType: string,
  ): Promise<boolean> {
    const [notification] = await db
      .select()
      .from(serverDeletionNotifications)
      .where(
        and(
          eq(serverDeletionNotifications.serverId, serverId),
          eq(serverDeletionNotifications.notificationType, notificationType),
        ),
      )
      .limit(1);

    return !!notification;
  }

  async createDeletionNotification(
    serverId: number,
    userId: string,
    notificationType: string,
  ): Promise<void> {
    await db.insert(serverDeletionNotifications).values({
      serverId,
      userId,
      notificationType,
    });
  }

  async getUserDeletionNotifications(
    userId: string,
    acknowledgedOnly = false,
  ): Promise<ServerDeletionNotification[]> {
    const conditions = [eq(serverDeletionNotifications.userId, userId)];

    if (acknowledgedOnly) {
      conditions.push(eq(serverDeletionNotifications.acknowledged, false));
    }

    return await db
      .select()
      .from(serverDeletionNotifications)
      .where(and(...conditions))
      .orderBy(desc(serverDeletionNotifications.sentAt));
  }

  async acknowledgeDeletionNotification(
    notificationId: number,
    userId: string,
  ): Promise<void> {
    await db
      .update(serverDeletionNotifications)
      .set({
        acknowledged: true,
        acknowledgedAt: new Date(),
      })
      .where(
        and(
          eq(serverDeletionNotifications.id, notificationId),
          eq(serverDeletionNotifications.userId, userId),
        ),
      );
  }
}
