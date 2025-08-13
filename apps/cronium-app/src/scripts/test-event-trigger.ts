#!/usr/bin/env tsx

import { db } from "../server/db";
import {
  events,
  jobs,
  JobStatus,
  JobType,
  JobPriority,
} from "../shared/schema";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";

// Use only alphanumeric characters for job IDs
const generateJobId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  12,
);

async function triggerTestEvent() {
  console.log("\n=== Testing Event Trigger ===\n");

  try {
    // Find event 557 specifically
    const [testEvent] = await db
      .select()
      .from(events)
      .where(eq(events.id, 557))
      .limit(1);

    if (!testEvent) {
      console.log("No events found in database");
      return;
    }

    console.log(`Found event: ${testEvent.name} (ID: ${testEvent.id})`);

    // Create a job for this event
    const jobId = `job_${generateJobId()}`;
    const [newJob] = await db
      .insert(jobs)
      .values({
        id: jobId,
        eventId: testEvent.id,
        userId: testEvent.userId,
        type: JobType.SCRIPT,
        status: JobStatus.QUEUED,
        priority: JobPriority.NORMAL,
        payload: {
          script: {
            content: testEvent.content,
            type: testEvent.type,
            workingDirectory: "",
          },
          target: testEvent.serverId
            ? {
                serverId: testEvent.serverId,
              }
            : {},
          runLocation: testEvent.runLocation,
        },
        scheduledFor: new Date(),
        metadata: {
          eventName: testEvent.name,
          triggeredBy: "test-script",
        },
        attempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    console.log(`\n✓ Created job: ${newJob?.id ?? "unknown"}`);
    console.log(`  Status: ${newJob?.status ?? "unknown"}`);
    console.log(`  Type: ${newJob?.type ?? "unknown"}`);

    // Wait a bit and check job status
    console.log("\nWaiting 5 seconds for orchestrator to pick up job...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Check job status
    const [updatedJob] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    console.log(
      `\nJob status after wait: ${String(updatedJob?.status ?? "unknown")}`,
    );
    if (updatedJob?.orchestratorId) {
      console.log(`  Claimed by: ${updatedJob.orchestratorId}`);
    }
    if (updatedJob?.startedAt) {
      console.log(`  Started at: ${updatedJob.startedAt.toISOString()}`);
    }
  } catch (error) {
    console.error("Error:", error);
  }

  process.exit(0);
}

triggerTestEvent().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
