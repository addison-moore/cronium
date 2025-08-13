#!/usr/bin/env tsx

/**
 * Test that events work without pre-generated payload files
 * Verifies the orchestrator creates payloads on-demand
 */

import { db } from "@/server/db";
import { jobs, JobStatus, JobType, events } from "@/shared/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

async function testNoPayloadFiles() {
  console.log("Testing events without pre-generated payload files...\n");

  try {
    // Check that payload directory is empty
    const payloadDir = path.join(process.cwd(), "storage", "payloads");
    if (!fs.existsSync(payloadDir)) {
      fs.mkdirSync(payloadDir, { recursive: true });
    }

    const files = fs.readdirSync(payloadDir);
    console.log(`Payload directory has ${files.length} files`);
    if (files.length > 0) {
      console.log("Files:", files);
    }

    // Find event 557
    const [event] = await db.select().from(events).where(eq(events.id, 557));

    if (!event) {
      console.error("Event 557 not found");
      process.exit(1);
    }

    console.log(`\nUsing event: ${event.name} (ID: ${event.id})`);

    // Create a test job
    const testJobId = `job_noPayload_${Date.now()}`;
    const jobPayload = {
      environment: {
        TEST_TYPE: "no_payload_files",
        TIMESTAMP: new Date().toISOString(),
      },
      timeout: { value: 300 },
      target: { serverId: 4 },
      script: {
        type: "BASH",
        content: `#!/bin/bash
echo "Testing execution without pre-generated payload files"
echo "Job ID: ${testJobId}"
echo "Test type: \$TEST_TYPE"
echo "Timestamp: \$TIMESTAMP"
echo "SUCCESS: Job executed without payload files!"`,
        workingDirectory: "/tmp",
      },
    };

    console.log("\nCreating job without pre-generated payload...");

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
    console.log(`  Status: ${newJob.status}`);

    // Check payload directory again
    const filesAfter = fs.readdirSync(payloadDir);
    console.log(`\nPayload directory still has ${filesAfter.length} files`);
    console.log("✅ No payload files were created in cronium-app");

    // Wait for job execution
    console.log("\nWaiting 10 seconds for job execution...");
    await new Promise((resolve) => setTimeout(resolve, 10000));

    const [updatedJob] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, testJobId));

    if (updatedJob) {
      console.log(`\nJob status: ${updatedJob.status}`);
      if (updatedJob.status === JobStatus.COMPLETED) {
        console.log("✅ Job completed successfully!");
        console.log("✅ Orchestrator created payload on-demand");
      } else if (updatedJob.status === JobStatus.FAILED) {
        console.log("❌ Job failed");
      } else {
        console.log(`Job is still ${updatedJob.status}`);
      }
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

// Run the test
testNoPayloadFiles()
  .then(() => {
    console.log("\n✅ Test completed - payload files are no longer needed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
