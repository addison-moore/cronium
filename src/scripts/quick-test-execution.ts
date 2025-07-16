import { db } from "@/server/db";
import { events, jobs } from "@/shared/schema";
import { randomUUID } from "crypto";

async function quickTest() {
  console.log("Creating and executing test event...");

  // Insert event directly
  const [event] = await db
    .insert(events)
    .values({
      id: 999999,
      userId: "123e4567-e89b-12d3-a456-426614174000", // Dummy user ID
      name: "Debug Sidecar Test",
      type: "BASH",
      content: 'echo "Testing sidecar"',
      status: "ACTIVE",
      runLocation: "LOCAL",
    })
    .returning();

  console.log(`Created event ${event.id}`);

  // Create job directly
  const jobId = `job_${randomUUID().substring(0, 12)}`;
  await db.insert(jobs).values({
    id: jobId,
    eventId: event.id,
    status: "queued",
    priority: 1,
    retryCount: 0,
    maxRetries: 0,
  });

  console.log(`Created job ${jobId}`);
  console.log("Job should be picked up by orchestrator...");

  // Don't clean up immediately so we can debug
  setTimeout(async () => {
    await db.delete(jobs).where({ id: jobId });
    await db.delete(events).where({ id: event.id });
    console.log("Cleaned up test data");
    process.exit(0);
  }, 30000);
}

quickTest().catch(console.error);
