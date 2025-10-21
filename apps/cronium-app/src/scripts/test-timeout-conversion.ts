#!/usr/bin/env tsx

/**
 * Test script to verify timeout unit conversion is working correctly
 */

import { transformJobForOrchestrator } from "@/lib/services/job-transformer";
import type { Job } from "@/shared/schema";
import { JobType, JobPriority } from "@/shared/schema";

// Test cases with different timeout units
const testCases = [
  {
    name: "30 SECONDS",
    payload: {
      timeout: { value: 30, unit: "SECONDS" },
      script: { type: "BASH", content: "echo test", workingDirectory: "/tmp" },
    },
    expectedSeconds: 30,
  },
  {
    name: "30 MINUTES",
    payload: {
      timeout: { value: 30, unit: "MINUTES" },
      script: { type: "BASH", content: "echo test", workingDirectory: "/tmp" },
    },
    expectedSeconds: 1800,
  },
  {
    name: "2 HOURS",
    payload: {
      timeout: { value: 2, unit: "HOURS" },
      script: { type: "BASH", content: "echo test", workingDirectory: "/tmp" },
    },
    expectedSeconds: 7200,
  },
  {
    name: "1 DAY",
    payload: {
      timeout: { value: 1, unit: "DAYS" },
      script: { type: "BASH", content: "echo test", workingDirectory: "/tmp" },
    },
    expectedSeconds: 86400,
  },
  {
    name: "No unit specified (defaults to seconds)",
    payload: {
      timeout: { value: 45 },
      script: { type: "BASH", content: "echo test", workingDirectory: "/tmp" },
    },
    expectedSeconds: 45,
  },
  {
    name: "No timeout specified (defaults to 1 hour)",
    payload: {
      script: { type: "BASH", content: "echo test", workingDirectory: "/tmp" },
    },
    expectedSeconds: 3600,
  },
];

function runTests() {
  console.log("Testing timeout unit conversion...\n");

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const job: Job = {
      id: "test-job",
      eventId: 1,
      userId: "test-user",
      type: JobType.SCRIPT,
      priority: JobPriority.NORMAL,
      status: "pending",
      attempts: 0,
      scheduledFor: new Date(),
      payload: testCase.payload,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      lastError: null,
      metadata: null,
      exitCode: null,
      output: null,
      orchestratorId: null,
    };

    const transformed = transformJobForOrchestrator(job);
    const actualSeconds = transformed.execution.timeout / 1000000000; // Convert nanoseconds back to seconds

    if (actualSeconds === testCase.expectedSeconds) {
      console.log(
        `✅ ${testCase.name}: ${actualSeconds}s (expected ${testCase.expectedSeconds}s)`,
      );
      passed++;
    } else {
      console.log(
        `❌ ${testCase.name}: ${actualSeconds}s (expected ${testCase.expectedSeconds}s)`,
      );
      failed++;
    }
  }

  console.log(`\n Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
