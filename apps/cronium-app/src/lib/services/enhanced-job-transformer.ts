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
  const target = payload?.target as
    { serverId?: number; runOnLocal?: boolean } | undefined;
  if (!target?.serverId) {
    return transformedJob;
  }
  const runOnLocal = target.runOnLocal === true;

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
    const serverDetails: NonNullable<
      typeof transformedJob.execution.target.serverDetails
    > = {
      id: String(server.id),
      name: server.name,
      host: server.address,
      port: server.port,
      username: server.username,
    };

    // Add authentication credentials based on what's available
    if (server.sshKey) {
      serverDetails.privateKey = server.sshKey;
    } else if (server.password) {
      serverDetails.password = server.password;
    }

    transformedJob.execution.target.serverDetails = serverDetails;

    console.log(
      `Added server details for job ${job.id}: ${server.name} (${server.address}:${server.port})`,
    );

    // Also check for multi-server scenarios. A local branch (LOCAL_AND_REMOTE)
    // also goes through the multi-server executor, even with a single server,
    // so the local container execution can run alongside the SSH one.
    const eventServers = await storage.getEventServers(eventId);

    // Multi-server scenario - fetch all server details
    if (
      eventServers &&
      (eventServers.length > 1 || (runOnLocal && eventServers.length >= 1))
    ) {
      const servers = [];
      for (const eventServer of eventServers) {
        const srv = await storage.getServer(eventServer.serverId);
        if (!srv) continue;

        const serverInfo: {
          id: string;
          name: string;
          host: string;
          port: number;
          username: string;
          privateKey?: string | null;
          password?: string | null;
        } = {
          id: String(srv.id),
          name: srv.name,
          host: srv.address,
          port: srv.port,
          username: srv.username,
        };

        // Add authentication credentials based on what's available
        if (srv.sshKey) {
          serverInfo.privateKey = srv.sshKey;
        } else if (srv.password) {
          serverInfo.password = srv.password;
        }

        servers.push(serverInfo);
      }

      // Add all servers to metadata for multi-server support
      transformedJob.metadata = {
        ...transformedJob.metadata,
        servers,
        multiServer: true,
        serverCount: servers.length,
        ...(runOnLocal && { runLocal: true }),
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
