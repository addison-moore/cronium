import type { EventWithRelations } from "@/server/storage";
import { storage } from "@/server/storage";
import { RunLocation } from "@/shared/schema";

export interface MultiServerJobPayload {
  servers?: Array<{
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    privateKey?: string;
    password?: string;
    passphrase?: string;
  }>;
  payloadPath?: string;
  [key: string]: unknown;
}

/**
 * Build job metadata with multiple servers for SSH execution
 */
export async function buildMultiServerJobMetadata(
  event: EventWithRelations,
  baseMetadata: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // If the event doesn't have remote execution, return base metadata
  if (event.runLocation !== RunLocation.REMOTE) {
    return baseMetadata;
  }

  // Get all servers associated with this event
  const eventServers = await storage.getEventServers(event.id);

  if (!eventServers || eventServers.length === 0) {
    // Fall back to single server if specified
    if (event.serverId) {
      return baseMetadata;
    }
    throw new Error("No servers associated with remote event");
  }

  // If only one server, use the existing single-server logic
  if (eventServers.length === 1) {
    return baseMetadata;
  }

  // Multiple servers - prepare server details
  const servers: MultiServerJobPayload["servers"] = [];

  for (const eventServer of eventServers) {
    const server = await storage.getServer(eventServer.serverId);
    if (!server) continue;

    // Build server info based on authentication method
    const serverInfo: NonNullable<MultiServerJobPayload["servers"]>[number] = {
      id: String(server.id),
      name: server.name,
      host: server.address,
      port: server.port,
      username: server.username,
    };

    // Add authentication credentials based on what's available
    if (server.sshKey) {
      serverInfo.privateKey = server.sshKey;
    } else if (server.password) {
      serverInfo.password = server.password;
    }

    servers.push(serverInfo);
  }

  // Return metadata with servers array
  return {
    ...baseMetadata,
    servers,
    multiServer: true,
    serverCount: servers.length,
  };
}

/**
 * Check if an event should use multi-server execution
 */
export async function shouldUseMultiServerExecution(
  event: EventWithRelations,
): Promise<boolean> {
  if (event.runLocation !== RunLocation.REMOTE) {
    return false;
  }

  const eventServers = await storage.getEventServers(event.id);
  return eventServers && eventServers.length > 1;
}
