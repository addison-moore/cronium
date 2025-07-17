import { db } from "@/server/db";
import {
  events,
  jobs,
  EventType,
  EventStatus,
  RunLocation,
  JobStatus,
  JobType,
  JobPriority,
} from "@/shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

async function quickTest() {
  console.log("Creating and executing test event...");

  // Insert event directly
  const eventData = {
    userId: "123e4567-e89b-12d3-a456-426614174000", // Dummy user ID
    name: "Debug Sidecar Test",
    type: EventType.BASH,
    content: 'echo "Testing sidecar"',
    status: EventStatus.ACTIVE,
    runLocation: RunLocation.LOCAL,
  };

  const [event] = await db.insert(events).values(eventData).returning();

  if (!event) {
    throw new Error("Failed to create event");
  }

  console.log(`Created event ${event.id}`);

  // Create job directly
  const jobId = `job_${randomUUID().substring(0, 12)}`;
  const jobData = {
    id: jobId,
    userId: event.userId,
    type: JobType.SCRIPT,
    eventId: event.id,
    status: JobStatus.QUEUED,
    priority: JobPriority.NORMAL,
    payload: {
      script: {
        type: "bash",
        content: event.content,
      },
      eventId: event.id,
      envVars: [],
    },
    // attempts and metadata have defaults
  };

  await db.insert(jobs).values(jobData);

  console.log(`Created job ${jobId}`);
  console.log("Job should be picked up by orchestrator...");

  // Don't clean up immediately so we can debug
  setTimeout(async () => {
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(events).where(eq(events.id, event.id));
    console.log("Cleaned up test data");
    process.exit(0);
  }, 30000);
}

quickTest().catch(console.error);
