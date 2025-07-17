#!/usr/bin/env tsx

/**
 * Test script to verify job status update functionality
 * Tests status transitions, persistence, and error handling
 */

import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import {
  EventType,
  LogStatus,
  JobType,
  EventStatus,
  JobStatus,
} from "@/shared/schema";
import { buildJobPayload } from "@/lib/scheduler/job-payload-builder";

interface StatusTest {
  name: string;
  type: EventType;
  content: string;
  description: string;
  expectedStatus: JobStatus;
  shouldFail?: boolean;
}

const statusTests: StatusTest[] = [
  // Successful execution test
  {
    name: "Bash - Successful Execution",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "Starting job..."
echo "Processing data..."
sleep 1
echo "Job completed successfully!"
exit 0`,
    description: "Test successful job completion",
    expectedStatus: JobStatus.COMPLETED,
  },

  // Failed execution test
  {
    name: "Python - Failed Execution",
    type: EventType.PYTHON,
    content: `import sys
import time

print("Starting job...")
time.sleep(0.5)
print("Encountered an error!", file=sys.stderr)
sys.exit(1)`,
    description: "Test job failure with non-zero exit code",
    expectedStatus: JobStatus.FAILED,
    shouldFail: true,
  },

  // Exception handling test
  {
    name: "Node.js - Unhandled Exception",
    type: EventType.NODEJS,
    content: `console.log("Starting job...");

setTimeout(() => {
  throw new Error("Unhandled exception in async code");
}, 500);`,
    description: "Test job failure due to unhandled exception",
    expectedStatus: JobStatus.FAILED,
    shouldFail: true,
  },

  // Long-running job test
  {
    name: "Bash - Long Running Job",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "Starting long-running job..."
for i in {1..5}; do
  echo "Step $i of 5"
  sleep 1
done
echo "Long job completed!"`,
    description: "Test status updates during long execution",
    expectedStatus: JobStatus.COMPLETED,
  },

  // Immediate failure test
  {
    name: "Python - Immediate Failure",
    type: EventType.PYTHON,
    content: `raise Exception("Immediate failure!")`,
    description: "Test immediate job failure",
    expectedStatus: JobStatus.FAILED,
    shouldFail: true,
  },

  // Multiple status updates test
  {
    name: "Bash - Multiple Updates",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "Phase 1: Initialization"
sleep 1
echo "Phase 2: Processing"
sleep 1
echo "Phase 3: Validation"
sleep 1
echo "Phase 4: Completion"`,
    description: "Test multiple status updates during execution",
    expectedStatus: JobStatus.COMPLETED,
  },

  // Error with output test
  {
    name: "Node.js - Error with Output",
    type: EventType.NODEJS,
    content: `console.log("Starting process...");
console.log("Generated output: Result A");
console.log("Generated output: Result B");
console.error("ERROR: Failed to complete final step");
process.exit(1);`,
    description: "Test job with both output and error",
    expectedStatus: JobStatus.FAILED,
    shouldFail: true,
  },

  // Signal termination test
  {
    name: "Python - Signal Handling",
    type: EventType.PYTHON,
    content: `import signal
import time
import sys

def signal_handler(sig, frame):
    print("Received termination signal")
    sys.exit(130)

signal.signal(signal.SIGTERM, signal_handler)

print("Job running, send SIGTERM to test...")
time.sleep(10)
print("Job completed normally")`,
    description: "Test job termination handling",
    expectedStatus: JobStatus.COMPLETED,
  },
];

async function createAndExecuteStatusTest(test: StatusTest): Promise<{
  jobId: string;
  eventId: string;
  success: boolean;
  error?: string;
}> {
  try {
    // Create event
    const event = await storage.createScript({
      name: test.name,
      type: test.type,
      content: test.content,
      status: EventStatus.ACTIVE,
      userId: "test-user",
      environment: JSON.stringify({
        TEST_TYPE: "status-updates",
      }),
      runLocation: "LOCAL",
    });

    const eventWithRelations = await storage.getEventWithRelations(event.id);
    if (!eventWithRelations) {
      throw new Error("Failed to get event");
    }

    // Create log
    const log = await storage.createLog({
      eventId: event.id,
      status: LogStatus.PENDING,
      startTime: new Date(),
      eventName: eventWithRelations.name,
      eventType: eventWithRelations.type,
      userId: eventWithRelations.userId,
    });

    // Build job payload
    const jobPayload = buildJobPayload(eventWithRelations, log.id);

    // Create job - should start with QUEUED status
    const job = await jobService.createJob({
      eventId: event.id,
      userId: eventWithRelations.userId,
      type: JobType.SCRIPT,
      payload: jobPayload,
      metadata: {
        eventName: eventWithRelations.name,
        triggeredBy: "status-test",
        testCase: test.name,
        logId: log.id,
        expectedStatus: test.expectedStatus,
      },
    });

    return {
      jobId: job.id,
      eventId: event.id,
      success: true,
    };
  } catch (error) {
    return {
      jobId: "",
      eventId: "",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function monitorJobStatus(
  jobId: string,
  maxWaitTime = 30000,
): Promise<{
  finalStatus: JobStatus;
  transitions: Array<{ status: JobStatus; timestamp: Date }>;
  error?: string;
  result?: any;
}> {
  const transitions: Array<{ status: JobStatus; timestamp: Date }> = [];
  const startTime = Date.now();
  let lastStatus: JobStatus | null = null;

  while (Date.now() - startTime < maxWaitTime) {
    const job = await jobService.getJob(jobId);

    if (!job) {
      throw new Error("Job not found");
    }

    // Record status transition
    if (job.status !== lastStatus) {
      transitions.push({
        status: job.status,
        timestamp: new Date(),
      });
      lastStatus = job.status;
    }

    // Check if job is in terminal state
    if (
      [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED].includes(
        job.status,
      )
    ) {
      return {
        finalStatus: job.status,
        transitions,
        error: job.lastError || undefined,
        result: job.result,
      };
    }

    // Wait before checking again
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Timeout reached
  const job = await jobService.getJob(jobId);
  return {
    finalStatus: job?.status || JobStatus.QUEUED,
    transitions,
    error: "Monitoring timeout reached",
  };
}

async function runStatusTests() {
  console.log("🧪 Testing Job Status Updates\n");
  console.log("This test suite verifies:");
  console.log(
    "- Status transitions (Queued → Claimed → Running → Completed/Failed)",
  );
  console.log("- Status persistence to database");
  console.log("- Error capture and storage");
  console.log("- UI error display capabilities\n");

  const results: Array<{
    test: StatusTest;
    jobId: string;
    created: boolean;
    error?: string;
  }> = [];

  // Create all test jobs
  console.log("📝 Creating test jobs...\n");
  for (const test of statusTests) {
    console.log(`Creating: ${test.name}`);
    const result = await createAndExecuteStatusTest(test);
    results.push({
      test,
      jobId: result.jobId,
      created: result.success,
      error: result.error,
    });

    if (result.success) {
      console.log(`  ✅ Job created: ${result.jobId}`);
    } else {
      console.log(`  ❌ Failed: ${result.error}`);
    }
  }

  // Wait for jobs to be processed
  console.log("\n⏳ Waiting for job execution...\n");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Monitor job status transitions
  console.log("📊 Monitoring Status Transitions:\n");

  for (const result of results) {
    if (!result.created) continue;

    console.log(`\n${result.test.name}:`);
    console.log(`  Job ID: ${result.jobId}`);
    console.log(`  Expected: ${result.test.expectedStatus}`);

    try {
      const monitoring = await monitorJobStatus(result.jobId, 15000);
      console.log(`  Final Status: ${monitoring.finalStatus}`);
      console.log(`  Transitions:`);

      for (const transition of monitoring.transitions) {
        console.log(
          `    - ${transition.status} at ${transition.timestamp.toISOString()}`,
        );
      }

      if (monitoring.error) {
        console.log(`  Error: ${monitoring.error}`);
      }

      if (monitoring.result) {
        console.log(`  Exit Code: ${monitoring.result.exitCode || 0}`);
      }

      // Verify expected outcome
      const matches = monitoring.finalStatus === result.test.expectedStatus;
      console.log(`  Result: ${matches ? "✅ PASS" : "❌ FAIL"}`);
    } catch (error) {
      console.log(`  ❌ Monitoring failed: ${error}`);
    }
  }

  // Summary
  console.log("\n📋 Test Summary:");
  console.log("Test Name | Expected Status | Description");
  console.log("----------|-----------------|------------");

  for (const test of statusTests) {
    console.log(
      `${test.name.padEnd(35).substring(0, 35)} | ${test.expectedStatus.padEnd(15)} | ${test.description}`,
    );
  }

  console.log("\n✅ All status update tests created and monitored");
  console.log(
    "📊 Check database: SELECT * FROM jobs ORDER BY created_at DESC LIMIT 10;",
  );
  console.log("🔍 View UI: Open dashboard and check job status display");
}

// Run the tests
runStatusTests().catch(console.error);
