import type { Job } from "@/shared/schema";
import {
  transformJobForOrchestrator,
  type OrchestratorJob,
} from "./job-transformer";
import { transformSSHJobForOrchestrator } from "./ssh-job-transformer";
import { storage } from "@/server/storage";

/**
 * Enhanced job transformer that handles multi-server SSH jobs
 */
export async function enhancedTransformJobForOrchestrator(
  job: Job,
): Promise<OrchestratorJob> {
  // Get base transformation
  let transformedJob = transformJobForOrchestrator(job);

  // If it's an SSH job, use the SSH transformer to generate payload
  if (transformedJob.type === "ssh") {
    transformedJob = await transformSSHJobForOrchestrator(job);
  }

  // If not an SSH job, return as-is
  if (transformedJob.type !== "ssh") {
    return transformedJob;
  }

  // Get payload for server info
  const payload = job.payload as Record<string, unknown>;
  const target = payload?.target as { serverId?: number } | undefined;
  if (!target?.serverId) {
    return transformedJob;
  }

  try {
    // Get event details to check for server setup
    const eventId = job.eventId;
    if (!eventId) {
      return transformedJob;
    }

    // Get the server ID from the target
    const serverId = transformedJob.execution.target.serverId;
    if (!serverId) {
      console.error(`No serverId in target for SSH job ${job.id}`);
      return transformedJob;
    }

    // Fetch the server details
    const server = await storage.getServer(Number(serverId));
    if (!server) {
      console.error(`Server ${serverId} not found for job ${job.id}`);
      return transformedJob;
    }

    // Add server details to the execution target
    transformedJob.execution.target.serverDetails = {
      id: String(server.id),
      name: server.name,
      host: server.address,
      port: server.port,
      username: server.username,
      privateKey: server.sshKey, // Already decrypted from storage
      passphrase: undefined, // Add if needed
    };

    console.log(
      `Added server details for job ${job.id}: ${server.name} (${server.address}:${server.port})`,
    );

    // Also check for multi-server scenarios
    const eventServers = await storage.getEventServers(eventId);

    // Multi-server scenario - fetch all server details
    if (eventServers && eventServers.length > 1) {
      const servers = [];
      for (const eventServer of eventServers) {
        const srv = await storage.getServer(eventServer.serverId);
        if (!srv) continue;

        const serverInfo = {
          id: String(srv.id),
          name: srv.name,
          host: srv.address,
          port: srv.port,
          username: srv.username,
          privateKey: srv.sshKey,
        };

        servers.push(serverInfo);
      }

      // Add all servers to metadata for multi-server support
      transformedJob.metadata = {
        ...transformedJob.metadata,
        servers,
        multiServer: true,
        serverCount: servers.length,
      };
    }
  } catch (error) {
    console.error("Error enhancing job transformation:", error);
    // Return original transformation on error
  }

  return transformedJob;
}

/**
 * Transform multiple jobs with enhanced server support
 */
export async function enhancedTransformJobsForOrchestrator(
  jobs: Job[],
): Promise<OrchestratorJob[]> {
  return Promise.all(jobs.map(enhancedTransformJobForOrchestrator));
}
