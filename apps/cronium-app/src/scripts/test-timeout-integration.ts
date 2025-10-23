#!/usr/bin/env tsx

/**
 * Integration test for timeout functionality
 * Tests that timeout units are properly converted and applied
 */

import { transformJobForOrchestrator } from "@/lib/services/job-transformer";
import type { Job } from "@/shared/schema";
import { JobType, JobPriority, JobStatus } from "@/shared/schema";

console.log("🧪 Testing Timeout Integration\n");
console.log("=".repeat(60));

// Test 1: Verify timeout unit conversion
console.log("\n📝 Test 1: Timeout Unit Conversion");
console.log("-".repeat(40));

const testJob: Job = {
  id: "test-job-1",
  eventId: 1,
  userId: "test-user",
  type: JobType.SCRIPT,
  priority: JobPriority.NORMAL,
  status: JobStatus.QUEUED,
  attempts: 0,
  scheduledFor: new Date(),
  payload: {
    script: {
      type: "BASH",
      content: "echo test",
      workingDirectory: "/tmp",
    },
    timeout: { value: 5, unit: "MINUTES" },
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  startedAt: null,
  completedAt: null,
  result: null,
  lastError: null,
  metadata: {},
  orchestratorId: null,
};

const transformed = transformJobForOrchestrator(testJob);
const timeoutNanoseconds = transformed.execution.timeout;
const timeoutSeconds = timeoutNanoseconds / 1000000000;

console.log(`Input: 5 MINUTES`);
console.log(`Expected: 300 seconds`);
console.log(`Got: ${timeoutSeconds} seconds`);

if (timeoutSeconds === 300) {
  console.log("✅ PASSED: Timeout correctly converted from MINUTES to seconds");
} else {
  console.log("❌ FAILED: Timeout conversion incorrect");
  process.exit(1);
}

// Test 2: Verify different timeout units
console.log("\n📝 Test 2: All Timeout Units");
console.log("-".repeat(40));

const unitTests = [
  { value: 30, unit: "SECONDS", expected: 30 },
  { value: 2, unit: "MINUTES", expected: 120 },
  { value: 1, unit: "HOURS", expected: 3600 },
  { value: 1, unit: "DAYS", expected: 86400 },
  { value: 45, unit: undefined, expected: 45 }, // Default to seconds
];

let allPassed = true;

for (const test of unitTests) {
  const job: Job = {
    ...testJob,
    id: `test-job-${test.unit ?? "unknown"}`,
    payload: {
      script: {
        type: "BASH",
        content: "echo test",
        workingDirectory: "/tmp",
      },
      timeout: { value: test.value, unit: test.unit },
    },
  };

  const result = transformJobForOrchestrator(job);
  const seconds = result.execution.timeout / 1000000000;

  const unitStr = test.unit ?? "SECONDS (default)";
  console.log(
    `  ${test.value} ${unitStr}: ${seconds}s (expected ${test.expected}s)`,
  );

  if (seconds === test.expected) {
    console.log(`  ✅ PASSED`);
  } else {
    console.log(`  ❌ FAILED`);
    allPassed = false;
  }
}

// Test 3: Verify timeout is in execution block
console.log("\n📝 Test 3: Timeout Placement");
console.log("-".repeat(40));

const jobWithTimeout: Job = {
  ...testJob,
  payload: {
    script: {
      type: "BASH",
      content: "sleep 10",
      workingDirectory: "/tmp",
    },
    timeout: { value: 30, unit: "SECONDS" },
  },
};

const orchestratorJob = transformJobForOrchestrator(jobWithTimeout);

if (orchestratorJob.execution?.timeout) {
  console.log("✅ PASSED: Timeout is in execution block");
  console.log(
    `  Execution timeout: ${orchestratorJob.execution.timeout / 1000000000}s`,
  );
} else {
  console.log("❌ FAILED: Timeout not found in execution block");
  allPassed = false;
}

// Test 4: Default timeout when not specified
console.log("\n📝 Test 4: Default Timeout");
console.log("-".repeat(40));

const jobWithoutTimeout: Job = {
  ...testJob,
  payload: {
    script: {
      type: "BASH",
      content: "echo test",
      workingDirectory: "/tmp",
    },
    // No timeout specified
  },
};

const defaultJob = transformJobForOrchestrator(jobWithoutTimeout);
const defaultSeconds = defaultJob.execution.timeout / 1000000000;

console.log(`No timeout specified`);
console.log(`Expected default: 3600 seconds (1 hour)`);
console.log(`Got: ${defaultSeconds} seconds`);

if (defaultSeconds === 3600) {
  console.log("✅ PASSED: Default timeout applied correctly");
} else {
  console.log("❌ FAILED: Default timeout incorrect");
  allPassed = false;
}

// Final results
console.log("\n" + "=".repeat(60));
if (allPassed) {
  console.log("\n🎉 All integration tests PASSED!");
  console.log("\nPhase-based timeout implementation is working correctly:");
  console.log("  ✅ Timeout units are properly converted");
  console.log("  ✅ User timeout is placed in execution block");
  console.log("  ✅ Default timeout is applied when not specified");
  process.exit(0);
} else {
  console.log("\n❌ Some integration tests FAILED");
  console.log("Please review the implementation");
  process.exit(1);
}
