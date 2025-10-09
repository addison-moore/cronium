#!/usr/bin/env tsx

/**
 * Test Script: Verify Timing Data Flow
 *
 * This script creates a test job to verify that timing data flows correctly
 * from orchestrator → API → database → UI.
 *
 * Run with: cd apps/cronium-app && pnpm tsx src/scripts/test-timing-flow.ts
 */

import { db } from "@/server/db";
import { jobs, executions, logs } from "@/shared/schema";
import { nanoid } from "nanoid";
import { eq, desc } from "drizzle-orm";

async function testTimingFlow() {
  console.log("🧪 Testing Timing Data Flow...\n");

  try {
    // Step 1: Create a test job
    const jobId = "job_timing_test_" + nanoid(6);
    console.log("1️⃣ Creating test job:", jobId);

    const newJob = {
      id: jobId,
      eventId: 459,
      userId: "IvJTPTUE4yrKs_sNVZjWl",
      status: "queued" as const,
      type: "SCRIPT" as const,
      priority: 1,
      attempts: 0,
      scheduledFor: new Date(),
      payload: {
        script: {
          type: "BASH",
          content: 'echo "Testing timing data flow"; sleep 2; echo "Complete!"',
          workingDirectory: "/app",
        },
        timeout: { value: 30 },
        environment: {},
        resources: {
          cpuLimit: 0.5,
          memoryLimit: 536870912,
          diskLimit: 1073741824,
          pidsLimit: 100,
        },
      },
      metadata: {
        eventName: "Timing Test",
        triggeredBy: "manual",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(jobs).values(newJob);
    console.log("✅ Job created successfully\n");

    // Step 2: Wait for job to be picked up and executed
    console.log("2️⃣ Waiting for orchestrator to process job (15 seconds)...");
    await new Promise((resolve) => setTimeout(resolve, 15000));

    // Step 3: Check job status
    console.log("\n3️⃣ Checking job status...");
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));

    if (!job) {
      console.log("❌ Job not found");
      process.exit(1);
    }

    console.log(`   Status: ${job.status}`);
    console.log(`   Completed: ${job.completedAt ? "Yes" : "No"}`);

    // Step 4: Check execution records
    console.log("\n4️⃣ Checking execution records...");
    const [execution] = await db
      .select()
      .from(executions)
      .where(eq(executions.jobId, jobId))
      .orderBy(desc(executions.createdAt));

    if (!execution) {
      console.log("⚠️  No execution record found yet");
      console.log("   Job may still be running or failed to execute");
    } else {
      console.log(`   Execution ID: ${execution.id}`);
      console.log(`   Status: ${execution.status}`);
      console.log(`   Exit Code: ${execution.exitCode ?? "N/A"}`);

      // Check timing fields
      console.log("\n   📊 Timing Data:");
      console.log(
        `   - Setup Duration: ${execution.setupDuration ? execution.setupDuration + "ms" : "N/A"}`,
      );
      console.log(
        `   - Execution Duration: ${execution.executionDuration ? execution.executionDuration + "ms" : "N/A"}`,
      );
      console.log(
        `   - Cleanup Duration: ${execution.cleanupDuration ? execution.cleanupDuration + "ms" : "N/A"}`,
      );
      console.log(
        `   - Total Duration: ${execution.totalDuration ? execution.totalDuration + "ms" : "N/A"}`,
      );

      if (execution.executionMetadata) {
        console.log("\n   📝 Execution Metadata:");
        console.log(
          "   " + JSON.stringify(execution.executionMetadata, null, 2),
        );
      }

      // Validate timing data
      const hasTimingData =
        execution.setupDuration !== null ||
        execution.executionDuration !== null ||
        execution.cleanupDuration !== null;

      if (hasTimingData) {
        console.log("\n✅ Timing data captured successfully!");
      } else {
        console.log("\n⚠️  No timing data found in execution record");
        console.log(
          "   This may indicate orchestrator isn't sending timing data",
        );
      }
    }

    // Step 5: Check logs table
    console.log("\n5️⃣ Checking logs table...");
    const [log] = await db
      .select()
      .from(logs)
      .where(eq(logs.jobId, jobId))
      .orderBy(desc(logs.createdAt));

    if (!log) {
      console.log("⚠️  No log entry found yet");
    } else {
      console.log(`   Log ID: ${log.id}`);
      console.log(`   Status: ${log.status}`);
      console.log(
        `   Execution Duration: ${log.executionDuration ? log.executionDuration + "ms" : "N/A"}`,
      );
      console.log(
        `   Setup Duration: ${log.setupDuration ? log.setupDuration + "ms" : "N/A"}`,
      );
      console.log(
        `   Total Duration: ${log.duration ? log.duration + "ms" : "N/A"}`,
      );

      const hasLogTimingData =
        log.executionDuration !== null || log.setupDuration !== null;

      if (hasLogTimingData) {
        console.log("\n✅ Log entry has timing data!");
        console.log(
          "   The Activity/Logs table UI should show timing breakdown",
        );
      } else {
        console.log("\n⚠️  Log entry doesn't have execution timing data");
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("Test Complete!");
    console.log("=".repeat(60));

    if (execution?.executionDuration && log?.executionDuration) {
      console.log("\n✅ SUCCESS: Timing data is flowing correctly!");
      console.log("   - Orchestrator is capturing phase timing");
      console.log("   - API is storing timing in database");
      console.log("   - Logs table has timing data for UI display");
    } else {
      console.log("\n⚠️  PARTIAL SUCCESS: Some timing data may be missing");
      console.log("   Check orchestrator logs for any errors");
    }

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

// Run the test
testTimingFlow();
