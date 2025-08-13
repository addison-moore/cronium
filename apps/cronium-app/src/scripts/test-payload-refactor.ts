#!/usr/bin/env tsx

/**
 * Test script to verify the refactored payload management
 * This tests that the orchestrator can create payloads from job script content
 */

import { db } from "@/server/db";
import { jobs, JobStatus, JobType, events } from "@/shared/schema";
import { eq } from "drizzle-orm";

async function testPayloadRefactor() {
  console.log("Testing payload refactor...\n");

  try {
    // Find event 557 (our test event)
    const [event] = await db.select().from(events).where(eq(events.id, 557));

    if (!event) {
      console.error("Event 557 not found");
      process.exit(1);
    }

    console.log(`Found event: ${event.name} (ID: ${event.id})`);

    // Create a test job with script content
    const testJobId = `job_test_${Date.now()}`;
    const jobPayload = {
      environment: {
        TEST_VAR: "test_value",
        NODE_ENV: "test",
      },
      timeout: { value: 300 },
      target: { serverId: 4 }, // Using server 4
      script: {
        type: "BASH",
        content: `#!/bin/bash
echo "Testing payload refactor"
echo "Job ID: ${testJobId}"
echo "Test variable: \$TEST_VAR"
echo "Creating test file..."
echo "Payload refactor successful" > /tmp/payload_refactor_test.txt
cat /tmp/payload_refactor_test.txt`,
        workingDirectory: "/tmp",
      },
    };

    console.log("\nCreating test job with script content...");

    const [newJob] = await db
      .insert(jobs)
      .values({
        id: testJobId,
        type: JobType.SCRIPT,
        status: JobStatus.QUEUED,
        priority: 10,
        eventId: event.id,
        userId: event.userId,
        payload: jobPayload,
        createdAt: new Date(),
        updatedAt: new Date(),
        orchestratorId: null,
        attempts: 0,
      })
      .returning();

    console.log(`Created job: ${newJob.id}`);
    console.log(`  Type: ${newJob.type}`);
    console.log(`  Status: ${newJob.status}`);
    console.log(`  Priority: ${newJob.priority}`);
    console.log(`  Event ID: ${newJob.eventId}`);

    // The job should now be picked up by the orchestrator
    // which will create the payload internally
    console.log("\nJob created successfully!");
    console.log("The orchestrator should now:");
    console.log("  1. Pick up the job from the queue");
    console.log("  2. Create a payload from the script content");
    console.log("  3. Execute the script on the remote server");
    console.log("\nMonitor the orchestrator logs to verify payload creation.");

    // Wait a bit then check job status
    console.log("\nWaiting 10 seconds to check job status...");
    await new Promise((resolve) => setTimeout(resolve, 10000));

    const [updatedJob] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, testJobId));

    if (updatedJob) {
      console.log(`\nJob status: ${updatedJob.status}`);
      if (updatedJob.status === JobStatus.COMPLETED) {
        console.log("✅ Job completed successfully!");
      } else if (updatedJob.status === JobStatus.FAILED) {
        console.log("❌ Job failed");
      } else {
        console.log(`Job is still ${updatedJob.status}`);
      }
    }
  } catch (error) {
    console.error("Error testing payload refactor:", error);
    process.exit(1);
  }
}

// Run the test
testPayloadRefactor()
  .then(() => {
    console.log("\n✅ Test script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
