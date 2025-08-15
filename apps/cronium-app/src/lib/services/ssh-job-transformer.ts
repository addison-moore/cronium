import type { Job } from "@/shared/schema";
import {
  transformJobForOrchestrator,
  type OrchestratorJob,
} from "./job-transformer";
import { db } from "@/server/db";
import { events, envVars } from "@/shared/schema";
import { eq } from "drizzle-orm";

/**
 * Transform SSH jobs to include script content and metadata
 * The orchestrator will handle payload creation internally
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

  // For SSH jobs, we need to include script content and metadata
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

    // Build environment map
    const environment: Record<string, string> = {};
    for (const envVar of eventEnvVars) {
      environment[envVar.key] = envVar.value;
    }

    // Extract script content from event
    const eventContent = event.content as {
      content?: string;
      type?: string;
    } | null;
    const scriptContent = eventContent?.content ?? "";
    const scriptType = eventContent?.type ?? "BASH";

    // Ensure script content is included in execution
    transformedJob.execution.script ??= {
      type: scriptType,
      content: scriptContent,
      workingDirectory: "/tmp",
    };

    // Merge environment variables
    transformedJob.execution.environment = {
      ...transformedJob.execution.environment,
      ...environment,
    };

    // Add metadata for orchestrator payload creation
    transformedJob.metadata = {
      ...transformedJob.metadata,
      eventId: String(eventId),
      eventName: event.name,
      eventVersion: 1,
      userId: job.userId || "",
    };

    // Add server details if available
    if (transformedJob.execution.target.serverId) {
      // Server details will be added by enhanced-job-transformer if needed
      transformedJob.metadata.serverId =
        transformedJob.execution.target.serverId;
    }

    console.log(
      `Prepared SSH job ${job.id} with script content for orchestrator payload creation`,
    );
  } catch (error) {
    console.error("Failed to prepare SSH job:", error);
    // Continue with existing script content
  }

  return transformedJob;
}
