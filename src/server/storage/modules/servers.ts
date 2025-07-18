import { db } from "../../db";
import {
  servers,
  events,
  eventServers,
  RunLocation,
} from "../../../shared/schema";
import type { Server, InsertServer, EventServer } from "../../../shared/schema";
import { eq, and, or } from "drizzle-orm";
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

  async getAllServers(userId: string): Promise<Server[]> {
    // Get user's own servers and shared servers from other users
    const allUserServers = await db
      .select()
      .from(servers)
      .where(
        or(
          eq(servers.userId, userId), // User's own servers
          eq(servers.shared, true), // Shared servers from other users
        ),
      )
      .orderBy(servers.name);

    // Decrypt sensitive data for all servers
    return allUserServers.map((server) =>
      decryptSensitiveData(server, "servers"),
    );
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

  async deleteServer(id: number): Promise<void> {
    // First update any scripts that use this server to run locally
    await db
      .update(events)
      .set({
        runLocation: RunLocation.LOCAL,
        serverId: null,
      })
      .where(eq(events.serverId, id));

    // Then delete the server
    await db.delete(servers).where(eq(servers.id, id));
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
}
