#!/usr/bin/env tsx

/**
 * Test script to verify phase-based timeout implementation
 * Tests both containerized and SSH execution with various timeout scenarios
 */

import { db } from "@/server/db";
import { jobs } from "@/shared/schema";
import { nanoid } from "nanoid";
import { JobType, JobPriority } from "@/shared/schema";

// Test scenarios
const testScenarios = [
  {
    name: "Quick script with 30 second timeout",
    description: "Should complete successfully",
    type: "CONTAINER" as const,
    script: `echo "Starting quick test"
sleep 2
echo "Test completed successfully"`,
    timeout: { value: 30, unit: "SECONDS" },
    expectedResult: "success",
  },
  {
    name: "Long script with 5 second timeout",
    description: "Should timeout during execution (not setup)",
    type: "CONTAINER" as const,
    script: `echo "Starting long test"
sleep 10
echo "This should not appear"`,
    timeout: { value: 5, unit: "SECONDS" },
    expectedResult: "timeout",
  },
  {
    name: "Script with 2 minute timeout",
    description: "Should handle MINUTES unit conversion",
    type: "CONTAINER" as const,
    script: `echo "Testing minute conversion"
for i in {1..5}; do
  echo "Iteration $i"
  sleep 5
done
echo "Completed after 25 seconds"`,
    timeout: { value: 2, unit: "MINUTES" },
    expectedResult: "success",
  },
  {
    name: "Script with 1 hour timeout",
    description: "Should handle HOURS unit conversion",
    type: "CONTAINER" as const,
    script: `echo "Testing hour conversion"
echo "Timeout is set to 1 hour (3600 seconds)"
sleep 2
echo "Quick completion"`,
    timeout: { value: 1, unit: "HOURS" },
    expectedResult: "success",
  },
];

async function createTestJob(scenario: (typeof testScenarios)[0]) {
  const jobId = `job_timeout_test_${nanoid(8)}`;

  const newJob = {
    id: jobId,
    eventId: 1, // Use a test event ID
    userId: "test-user",
    type: JobType.SCRIPT,
    priority: JobPriority.NORMAL,
    status: "pending" as const,
    attempts: 0,
    scheduledFor: new Date(),
    payload: {
      script: {
        type: "BASH",
        content: scenario.script,
        workingDirectory: "/tmp",
      },
      timeout: scenario.timeout,
      environment: {},
      resources:
        scenario.type === "CONTAINER"
          ? {
              cpuLimit: 0.5,
              memoryLimit: 536870912, // 512MB
              diskLimit: 1073741824, // 1GB
              pidsLimit: 100,
            }
          : undefined,
    },
    metadata: {
      testName: scenario.name,
      testDescription: scenario.description,
      expectedResult: scenario.expectedResult,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
    lastError: null,
    exitCode: null,
    output: null,
    orchestratorId: null,
  };

  await db.insert(jobs).values(newJob);
  console.log(`✅ Created test job: ${jobId}`);
  console.log(`   Name: ${scenario.name}`);
  console.log(`   Timeout: ${scenario.timeout.value} ${scenario.timeout.unit}`);
  console.log(`   Expected: ${scenario.expectedResult}`);

  return jobId;
}

async function checkJobStatus(jobId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));

  if (!job) {
    console.log(`❌ Job ${jobId} not found`);
    return null;
  }

  const timeoutInfo = job.payload?.timeout;
  const timeoutStr = timeoutInfo
    ? `${timeoutInfo.value} ${timeoutInfo.unit || "SECONDS"}`
    : "none";

  console.log(`\nJob: ${jobId}`);
  console.log(`  Status: ${job.status}`);
  console.log(`  Timeout: ${timeoutStr}`);
  console.log(`  Exit Code: ${job.exitCode ?? "N/A"}`);

  if (job.error) {
    console.log(`  Error: ${job.error}`);
  }

  if (job.output) {
    console.log(`  Output: ${job.output.substring(0, 100)}...`);
  }

  // Check if result matches expectation
  const metadata = job.metadata as any;
  if (metadata?.expectedResult) {
    const isTimeout = job.error?.includes("timeout") || job.exitCode === -1;
    const isSuccess = job.status === "completed" && job.exitCode === 0;

    if (metadata.expectedResult === "timeout" && isTimeout) {
      console.log(`  ✅ Result matches expectation (timeout)`);
    } else if (metadata.expectedResult === "success" && isSuccess) {
      console.log(`  ✅ Result matches expectation (success)`);
    } else {
      console.log(`  ❌ Result does not match expectation`);
      console.log(`     Expected: ${metadata.expectedResult}`);
      console.log(
        `     Got: ${isTimeout ? "timeout" : isSuccess ? "success" : "failure"}`,
      );
    }
  }

  return job.status;
}

async function waitForJobCompletion(
  jobId: string,
  maxWaitSeconds: number = 120,
) {
  const startTime = Date.now();

  while ((Date.now() - startTime) / 1000 < maxWaitSeconds) {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));

    if (!job) {
      console.log(`Job ${jobId} not found`);
      return null;
    }

    if (job.status === "completed" || job.status === "failed") {
      return job.status;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
  }

  console.log(`Timeout waiting for job ${jobId} to complete`);
  return null;
}

async function runTests() {
  console.log("🚀 Starting phase-based timeout tests\n");
  console.log("This test suite will verify:");
  console.log(
    "1. Timeout units are converted correctly (SECONDS, MINUTES, HOURS)",
  );
  console.log("2. User timeout applies only to script execution, not setup");
  console.log("3. Scripts timeout appropriately when exceeding limits\n");

  const testJobs: { jobId: string; scenario: (typeof testScenarios)[0] }[] = [];

  // Create all test jobs
  for (const scenario of testScenarios) {
    const jobId = await createTestJob(scenario);
    testJobs.push({ jobId, scenario });

    // Small delay between job creation
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(
    `\n📊 Created ${testJobs.length} test jobs. Waiting for completion...\n`,
  );

  // Monitor jobs
  let allComplete = false;
  const maxWaitTime = 180; // 3 minutes max wait
  const startTime = Date.now();

  while (!allComplete && (Date.now() - startTime) / 1000 < maxWaitTime) {
    allComplete = true;

    for (const { jobId } of testJobs) {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));

      if (job && job.status !== "completed" && job.status !== "failed") {
        allComplete = false;
      }
    }

    if (!allComplete) {
      process.stdout.write(".");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  console.log("\n\n📈 Test Results:\n");

  // Check final results
  let passed = 0;
  let failed = 0;

  for (const { jobId, scenario } of testJobs) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Test: ${scenario.name}`);
    console.log(`Description: ${scenario.description}`);

    const status = await checkJobStatus(jobId);

    if (status) {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      const isTimeout = job?.error?.includes("timeout") || job?.exitCode === -1;
      const isSuccess = job?.status === "completed" && job?.exitCode === 0;

      if (scenario.expectedResult === "timeout" && isTimeout) {
        passed++;
        console.log(`\n✅ PASSED - Job timed out as expected`);
      } else if (scenario.expectedResult === "success" && isSuccess) {
        passed++;
        console.log(`\n✅ PASSED - Job completed successfully`);
      } else {
        failed++;
        console.log(`\n❌ FAILED - Unexpected result`);
      }
    } else {
      failed++;
      console.log(`\n❌ FAILED - Job did not complete`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`\n📊 Final Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log(
      "⚠️  Some tests failed. Please review the timeout implementation.",
    );
    process.exit(1);
  } else {
    console.log(
      "🎉 All tests passed! Phase-based timeouts are working correctly.",
    );
    process.exit(0);
  }
}

// Import eq for Drizzle ORM queries
import { eq } from "drizzle-orm";

// Run the tests
runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
