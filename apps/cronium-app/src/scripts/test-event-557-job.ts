#!/usr/bin/env tsx
/**
 * Test job creation for Event 557 with updated job-payload-builder
 */

import { db } from "@/server/db";
import { storage } from "@/server/storage";
import { buildJobPayload } from "@/lib/scheduler/job-payload-builder";
import { JobType, LogStatus } from "@/shared/schema";

async function testEvent557JobCreation() {
  console.log("=== Testing Job Creation for Event 557 ===\n");

  // Get the event with relations
  const event = await storage.getEventWithRelations(557);

  if (!event) {
    console.error("❌ Event 557 not found!");
    process.exit(1);
  }

  console.log("📋 Event Details:");
  console.log(`  ID: ${event.id}`);
  console.log(`  Name: ${event.name}`);
  console.log(`  Type: ${event.type}`);
  console.log(`  Run Location: ${event.runLocation}`);
  console.log(`  Server ID: ${event.serverId}`);
  console.log(`  Event Servers: ${event.eventServers?.length ?? 0}`);

  if (event.eventServers && event.eventServers.length > 0) {
    console.log("\n🖥️  Event Servers:");
    event.eventServers.forEach((es) => {
      console.log(
        `  - Server ID: ${es.serverId}, Server: ${es.server?.name ?? "Unknown"}`,
      );
    });
  }

  console.log("\n📦 Building Job Payload...");

  // Create a mock log ID
  const mockLogId = 999999;

  // Build the job payload
  const jobPayload = buildJobPayload(event, mockLogId);

  console.log("\n✨ Generated Job Payload:");
  console.log("  Type:", event.type);
  console.log("  Target:", JSON.stringify(jobPayload.target, null, 2));

  // Check if it would route to SSH
  const wouldRouteToSSH = jobPayload.target?.serverId !== undefined;
  console.log(
    `\n  Would route to SSH executor: ${wouldRouteToSSH ? "✅ YES" : "❌ NO"}`,
  );

  if (wouldRouteToSSH) {
    console.log(`  Target Server ID: ${jobPayload.target?.serverId}`);
  } else {
    console.log(`  Container Image: ${jobPayload.target?.containerImage}`);
  }

  // Determine job type
  const jobType = event.toolActionConfig
    ? JobType.TOOL_ACTION
    : event.type === "HTTP_REQUEST"
      ? JobType.HTTP_REQUEST
      : JobType.SCRIPT;

  console.log(`\n📋 Job Type: ${jobType}`);
  console.log(`  SSH Executor expects: type="ssh" with target.serverId`);
  console.log(
    `  This job would have: type="${jobType}" with target=${JSON.stringify(jobPayload.target)}`,
  );

  if (jobType === JobType.SCRIPT && jobPayload.target?.serverId) {
    console.log("\n✅ This job SHOULD route to SSH executor!");
  } else {
    console.log("\n❌ This job would NOT route to SSH executor");
    if (jobType !== JobType.SCRIPT) {
      console.log("  Issue: Job type is not SCRIPT");
    }
    if (!jobPayload.target?.serverId) {
      console.log("  Issue: No serverId in target");
    }
  }
}

// Run the test
testEvent557JobCreation()
  .then(() => {
    console.log("\n✅ Test complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
