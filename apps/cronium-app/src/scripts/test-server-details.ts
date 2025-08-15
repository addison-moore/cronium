#!/usr/bin/env tsx
/**
 * Test that server details are properly added to SSH jobs
 */

import { storage } from "@/server/storage";
import { buildJobPayload } from "@/lib/scheduler/job-payload-builder";
import { JobType } from "@/shared/schema";
import { transformJobForOrchestrator } from "@/lib/services/job-transformer";
import { enhancedTransformJobForOrchestrator } from "@/lib/services/enhanced-job-transformer";

async function testServerDetails() {
  console.log("=== Testing Server Details for Event 557 ===\n");

  // Get the event with relations
  const event = await storage.getEventWithRelations(557);

  if (!event) {
    console.error("❌ Event 557 not found!");
    process.exit(1);
  }

  console.log("📋 Event Details:");
  console.log(`  ID: ${event.id}`);
  console.log(`  Name: ${event.name}`);
  console.log(`  Run Location: ${event.runLocation}`);

  // Build job payload
  const mockLogId = 999999;
  const jobPayload = buildJobPayload(event, mockLogId);
  console.log(`\n📦 Job Payload Target: ${JSON.stringify(jobPayload.target)}`);

  // Create a mock job
  const mockJob = {
    id: "job_test_server",
    eventId: event.id,
    userId: "test-user",
    type: JobType.SCRIPT,
    status: "queued" as const,
    priority: "normal" as const,
    payload: jobPayload,
    scheduledFor: new Date(),
    metadata: {},
    attempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    orchestratorId: null,
    startedAt: null,
    completedAt: null,
    result: null,
    lastError: null,
  };

  // Transform for orchestrator
  console.log("\n🔄 Basic Transformation:");
  const basicTransformed = transformJobForOrchestrator(mockJob);
  console.log(`  Job Type: ${basicTransformed.type}`);
  console.log(`  Target Type: ${basicTransformed.execution.target.type}`);
  console.log(
    `  Target Server ID: ${String(basicTransformed.execution.target.serverId ?? "N/A")}`,
  );
  console.log(
    `  Has Server Details: ${basicTransformed.execution.target.serverDetails ? "Yes" : "No"}`,
  );

  // Enhanced transformation
  console.log("\n✨ Enhanced Transformation:");
  const enhancedJob = await enhancedTransformJobForOrchestrator(mockJob);
  console.log(`  Job Type: ${enhancedJob.type}`);
  console.log(`  Target Type: ${enhancedJob.execution.target.type}`);
  console.log(
    `  Target Server ID: ${String(enhancedJob.execution.target.serverId ?? "N/A")}`,
  );
  console.log(
    `  Has Server Details: ${enhancedJob.execution.target.serverDetails ? "Yes" : "No"}`,
  );

  if (enhancedJob.execution.target.serverDetails) {
    const details = enhancedJob.execution.target.serverDetails;
    console.log("\n🖥️  Server Details:");
    console.log(`  ID: ${details.id}`);
    console.log(`  Name: ${details.name}`);
    console.log(`  Host: ${details.host}`);
    console.log(`  Port: ${details.port}`);
    console.log(`  Username: ${details.username}`);
    console.log(`  Has Private Key: ${details.privateKey ? "Yes" : "No"}`);
  } else {
    console.log("\n❌ No server details found!");
  }

  // Check what the orchestrator would receive
  console.log("\n📊 Final Check:");
  if (
    enhancedJob.type === "ssh" &&
    enhancedJob.execution.target.serverDetails
  ) {
    console.log("  ✅ Job is properly configured for SSH execution");
    console.log(
      "  The orchestrator should now be able to connect to the server",
    );
  } else {
    console.log("  ❌ Job is NOT properly configured for SSH execution");
    if (enhancedJob.type !== "ssh") {
      console.log("  Issue: Job type is not 'ssh'");
    }
    if (!enhancedJob.execution.target.serverDetails) {
      console.log("  Issue: Server details are missing");
    }
  }
}

// Run the test
testServerDetails()
  .then(() => {
    console.log("\n✅ Test complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
