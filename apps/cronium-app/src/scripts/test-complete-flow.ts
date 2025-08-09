#!/usr/bin/env tsx
/**
 * Test the complete flow: Event 557 -> Job Payload -> Transformed Job
 */

import { storage } from "@/server/storage";
import { buildJobPayload } from "@/lib/scheduler/job-payload-builder";
import { JobType } from "@/shared/schema";
import { transformJobForOrchestrator } from "@/lib/services/job-transformer";
import { enhancedTransformJobForOrchestrator } from "@/lib/services/enhanced-job-transformer";

async function testCompleteFlow() {
  console.log("=== Testing Complete Flow for Event 557 ===\n");

  // Step 1: Get the event with relations
  const event = await storage.getEventWithRelations(557);

  if (!event) {
    console.error("❌ Event 557 not found!");
    process.exit(1);
  }

  console.log("📋 Step 1: Event Details");
  console.log(`  ID: ${event.id}`);
  console.log(`  Name: ${event.name}`);
  console.log(`  Type: ${event.type}`);
  console.log(`  Run Location: ${event.runLocation}`);
  console.log(`  Server ID: ${event.serverId}`);
  console.log(`  Event Servers: ${event.eventServers?.length ?? 0}`);

  // Step 2: Build job payload
  console.log("\n📦 Step 2: Build Job Payload");
  const mockLogId = 999999;
  const jobPayload = buildJobPayload(event, mockLogId);
  console.log(`  Target: ${JSON.stringify(jobPayload.target)}`);

  // Step 3: Create a mock job
  console.log("\n🎯 Step 3: Create Mock Job");
  const mockJob = {
    id: "job_test_123",
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
  console.log(`  Job Type: ${mockJob.type}`);
  console.log(
    `  Payload Target: ${JSON.stringify((mockJob.payload as any).target)}`,
  );

  // Step 4: Transform for orchestrator
  console.log("\n🔄 Step 4: Transform for Orchestrator");
  const transformedJob = transformJobForOrchestrator(mockJob);
  console.log(`  Orchestrator Job Type: ${transformedJob.type}`);
  console.log(
    `  Execution Target: ${JSON.stringify(transformedJob.execution.target)}`,
  );

  // Step 5: Enhanced transformation (with payload generation)
  console.log("\n✨ Step 5: Enhanced Transformation");
  const enhancedJob = await enhancedTransformJobForOrchestrator(mockJob);
  console.log(`  Orchestrator Job Type: ${enhancedJob.type}`);
  console.log(
    `  Has Payload Path: ${enhancedJob.metadata?.payloadPath ? "Yes" : "No"}`,
  );

  // Final verdict
  console.log("\n📊 Final Analysis:");
  if (enhancedJob.type === "ssh") {
    console.log("  ✅ Job will be routed to SSH executor");
    console.log(`  Target Server ID: ${enhancedJob.execution.target.serverId}`);
    if (enhancedJob.metadata?.payloadPath) {
      console.log(
        `  ✅ Payload file generated: ${enhancedJob.metadata.payloadPath}`,
      );
    } else {
      console.log("  ⚠️  Warning: No payload file generated");
    }
  } else if (enhancedJob.type === "container") {
    console.log("  ❌ Job will be routed to container executor");
    console.log("  This is incorrect for a REMOTE event with servers!");
  } else {
    console.log(`  ❓ Unknown job type: ${enhancedJob.type}`);
  }
}

// Run the test
testCompleteFlow()
  .then(() => {
    console.log("\n✅ Test complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
