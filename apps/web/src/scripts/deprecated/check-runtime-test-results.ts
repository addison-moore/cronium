#!/usr/bin/env tsx

/**
 * Script to check the results of runtime environment tests
 */

import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { JobStatus } from "@/shared/schema";

interface TestResult {
  name: string;
  jobId: string;
  status: JobStatus;
  success: boolean;
  exitCode?: number;
  output?: string;
  error?: string;
  duration?: number;
}

async function checkRuntimeTests() {
  console.log("🔍 Checking Runtime Test Results\n");

  // Get recent jobs with runtime-test trigger
  const { jobs } = await jobService.listJobs({}, 50);
  const runtimeTestJobs = jobs.filter(
    (job) => (job.metadata as any)?.triggeredBy === "runtime-test",
  );

  if (runtimeTestJobs.length === 0) {
    console.log("No runtime test jobs found.");
    console.log("Run: pnpm tsx src/scripts/test-runtime-environments.ts");
    return;
  }

  console.log(`Found ${runtimeTestJobs.length} runtime test jobs\n`);

  const results: TestResult[] = [];

  // Analyze each job
  for (const job of runtimeTestJobs) {
    const metadata = job.metadata as any;
    const result = job.result as any;

    const testResult: TestResult = {
      name: metadata.testCase || metadata.eventName || "Unknown",
      jobId: job.id,
      status: job.status,
      success: job.status === JobStatus.COMPLETED && result?.exitCode === 0,
      exitCode: result?.exitCode,
      output: result?.output,
      error: result?.error || job.lastError,
    };

    if (job.startedAt && job.completedAt) {
      testResult.duration =
        new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
    }

    results.push(testResult);

    // Get detailed logs
    const logs = await storage.getLogsByJobId(job.id);
    if (logs.length > 0) {
      testResult.output = logs
        .filter((log) => log.stream === "stdout")
        .map((log) => log.message)
        .join("\n");

      const errors = logs
        .filter((log) => log.stream === "stderr")
        .map((log) => log.message)
        .join("\n");

      if (errors) {
        testResult.error = errors;
      }
    }
  }

  // Group by runtime
  const byRuntime: Record<string, TestResult[]> = {};
  for (const result of results) {
    const runtime = result.name.split(" - ")[0];
    if (!byRuntime[runtime]) {
      byRuntime[runtime] = [];
    }
    byRuntime[runtime].push(result);
  }

  // Display results by runtime
  for (const [runtime, tests] of Object.entries(byRuntime)) {
    console.log(`\n=== ${runtime} Runtime Tests ===\n`);

    for (const test of tests) {
      const testName = test.name.split(" - ")[1] || test.name;
      const icon = test.success ? "✅" : "❌";
      const statusText =
        test.status === JobStatus.QUEUED
          ? "⏳ Queued"
          : test.status === JobStatus.RUNNING
            ? "🔄 Running"
            : test.status === JobStatus.COMPLETED
              ? `Exit ${test.exitCode}`
              : test.status;

      console.log(`${icon} ${testName}`);
      console.log(`   Job: ${test.jobId}`);
      console.log(`   Status: ${statusText}`);

      if (test.duration) {
        console.log(`   Duration: ${(test.duration / 1000).toFixed(2)}s`);
      }

      if (test.output && test.status === JobStatus.COMPLETED) {
        console.log("   Output:");
        test.output.split("\n").forEach((line) => {
          console.log(`     ${line}`);
        });
      }

      if (test.error) {
        console.log("   Error:");
        test.error.split("\n").forEach((line) => {
          console.log(`     ${line}`);
        });
      }

      console.log();
    }
  }

  // Summary statistics
  console.log("\n📊 Summary Statistics\n");

  const stats = {
    total: results.length,
    completed: results.filter((r) => r.status === JobStatus.COMPLETED).length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => r.status === JobStatus.FAILED).length,
    running: results.filter((r) => r.status === JobStatus.RUNNING).length,
    queued: results.filter((r) => r.status === JobStatus.QUEUED).length,
  };

  console.log(`Total Tests: ${stats.total}`);
  console.log(`Completed: ${stats.completed} (${stats.successful} successful)`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Running: ${stats.running}`);
  console.log(`Queued: ${stats.queued}`);

  // Runtime-specific stats
  console.log("\nBy Runtime:");
  for (const [runtime, tests] of Object.entries(byRuntime)) {
    const successful = tests.filter((t) => t.success).length;
    const total = tests.length;
    console.log(`  ${runtime}: ${successful}/${total} passed`);
  }

  // Check for common issues
  console.log("\n🔍 Analysis:");

  const failedTests = results.filter(
    (r) => !r.success && r.status === JobStatus.COMPLETED,
  );
  if (failedTests.length > 0) {
    console.log("\nFailed Tests:");
    for (const test of failedTests) {
      console.log(`  - ${test.name}: Exit code ${test.exitCode}`);
    }
  }

  const longRunning = results.filter((r) => r.duration && r.duration > 5000);
  if (longRunning.length > 0) {
    console.log("\nLong-running Tests (>5s):");
    for (const test of longRunning) {
      console.log(`  - ${test.name}: ${(test.duration! / 1000).toFixed(2)}s`);
    }
  }

  // Verify expected failures
  const expectedFailures = ["Error Handling", "thrown error", "exception"];
  const actualFailures = failedTests.map((t) => t.name);

  console.log("\n✅ Verification:");
  console.log(
    "Expected failures (error handling tests):",
    actualFailures.filter((name) =>
      expectedFailures.some((keyword) => name.includes(keyword)),
    ).length,
  );
  console.log(
    "Unexpected failures:",
    actualFailures.filter(
      (name) => !expectedFailures.some((keyword) => name.includes(keyword)),
    ).length,
  );
}

// Run the check
checkRuntimeTests().catch(console.error);
