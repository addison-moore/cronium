import type { Job, Event } from "@/shared/schema";
import { PayloadService } from "./payload-service";
import {
  transformJobForOrchestrator,
  type OrchestratorJob,
} from "./job-transformer";
import { db } from "@/server/db";
import { events, envVars } from "@/shared/schema";
import { eq } from "drizzle-orm";

/**
 * Transform SSH jobs to include payload file path
 * The SSH executor expects a payload file, not raw script content
 */
export async function transformSSHJobForOrchestrator(
  job: Job,
): Promise<OrchestratorJob> {
  // Start with the standard transformation
  const transformedJob = transformJobForOrchestrator(job);

  console.log(
    `[SSH Transformer] Job ${job.id} - Type: ${transformedJob.type}, Payload:`,
    job.payload,
  );

  // If it's not an SSH job, return as-is
  if (transformedJob.type !== "ssh") {
    console.log(
      `[SSH Transformer] Job ${job.id} is not SSH type, returning as-is`,
    );
    return transformedJob;
  }

  // For SSH jobs, we need to generate a payload file
  const eventId = job.eventId;
  if (!eventId) {
    console.error("SSH job missing eventId:", job.id);
    return transformedJob;
  }

  try {
    // Fetch the event
    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.id, eventId));

    if (!event) {
      console.error("Event not found for SSH job:", eventId);
      return transformedJob;
    }

    // Fetch environment variables
    const eventEnvVars = await db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, eventId));

    // Initialize payload service
    const payloadService = new PayloadService();
    await payloadService.ensurePayloadDirectory();

    // Get active payload or generate new one
    let payload = await payloadService.getActivePayload(eventId);
    if (!payload) {
      payload = await payloadService.generatePayload(event, eventEnvVars);
    }

    // Create a job-specific payload with updated manifest
    const jobPayloadPath = await payloadService.createJobSpecificPayload(
      payload.payloadPath,
      job.id,
      `exec-${job.id}-${Date.now()}`,
    );

    // Add payload path to metadata
    transformedJob.metadata = {
      ...transformedJob.metadata,
      payloadPath: jobPayloadPath, // Use the job-specific payload
      payloadVersion: payload.eventVersion,
      eventId: String(eventId),
      eventName: event.name,
    };

    // Remove script content from execution (runner will read from payload)
    delete transformedJob.execution.script;

    // Add server details if available
    if (transformedJob.execution.target.serverId) {
      // Server details will be added by enhanced-job-transformer if needed
      transformedJob.metadata.serverId =
        transformedJob.execution.target.serverId;
    }

    console.log(
      `Generated job-specific payload for SSH job ${job.id}: ${jobPayloadPath}`,
    );
  } catch (error) {
    console.error("Failed to generate payload for SSH job:", error);
    // Continue with script content as fallback
  }

  return transformedJob;
}
