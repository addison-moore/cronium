#!/usr/bin/env tsx

/**
 * Script to check the results of job status update tests
 */

import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { JobStatus } from "@/shared/schema";

interface StatusTestResult {
  name: string;
  jobId: string;
  status: JobStatus;
  expectedStatus: JobStatus;
  statusMatches: boolean;
  transitions: string[];
  error?: string;
  exitCode?: number;
  duration?: number;
  attempts: number;
}

async function checkStatusTests() {
  console.log("🔍 Checking Job Status Update Test Results\n");

  // Get recent jobs with status-test trigger
  const { jobs } = await jobService.listJobs({}, 50);
  const statusTestJobs = jobs.filter(
    (job) => (job.metadata as any)?.triggeredBy === "status-test",
  );

  if (statusTestJobs.length === 0) {
    console.log("No status test jobs found.");
    console.log("Run: pnpm tsx src/scripts/test-job-status-updates.ts");
    return;
  }

  console.log(`Found ${statusTestJobs.length} status test jobs\n`);

  const results: StatusTestResult[] = [];

  // Analyze each job
  for (const job of statusTestJobs) {
    const metadata = job.metadata as any;
    const result = job.result as any;

    // Build transition history
    const transitions: string[] = [];
    transitions.push(`QUEUED (${new Date(job.createdAt).toISOString()})`);

    if (job.orchestratorId) {
      transitions.push(`CLAIMED by ${job.orchestratorId}`);
    }

    if (job.startedAt) {
      transitions.push(`RUNNING (${new Date(job.startedAt).toISOString()})`);
    }

    if (job.completedAt) {
      transitions.push(
        `${job.status.toUpperCase()} (${new Date(job.completedAt).toISOString()})`,
      );
    }

    const testResult: StatusTestResult = {
      name: metadata.testCase || metadata.eventName || "Unknown",
      jobId: job.id,
      status: job.status,
      expectedStatus: metadata.expectedStatus || JobStatus.COMPLETED,
      statusMatches:
        job.status === (metadata.expectedStatus || JobStatus.COMPLETED),
      transitions,
      error: job.lastError || result?.error,
      exitCode: result?.exitCode,
      attempts: job.attempts || 0,
    };

    if (job.startedAt && job.completedAt) {
      testResult.duration =
        new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
    }

    results.push(testResult);
  }

  // Display results
  displayDetailedResults(results);

  // Verify status update features
  verifyStatusUpdateFeatures(results);

  // Display summary statistics
  displaySummaryStatistics(results);
}

function displayDetailedResults(results: StatusTestResult[]) {
  console.log("=== Job Status Update Test Results ===\n");

  for (const test of results) {
    const icon = test.statusMatches ? "✅" : "❌";

    console.log(`${icon} ${test.name}`);
    console.log(`   Job ID: ${test.jobId}`);
    console.log(`   Status: ${test.status} (Expected: ${test.expectedStatus})`);
    console.log(`   Match: ${test.statusMatches ? "YES" : "NO"}`);

    if (test.duration) {
      console.log(`   Duration: ${(test.duration / 1000).toFixed(2)}s`);
    }

    console.log(`   Status Transitions:`);
    for (const transition of test.transitions) {
      console.log(`     → ${transition}`);
    }

    if (test.exitCode !== undefined) {
      console.log(`   Exit Code: ${test.exitCode}`);
    }

    if (test.error) {
      console.log(`   Error: ${test.error}`);
    }

    if (test.attempts > 0) {
      console.log(`   Attempts: ${test.attempts}`);
    }

    console.log();
  }
}

function verifyStatusUpdateFeatures(results: StatusTestResult[]) {
  console.log("\n🔍 Status Update Feature Verification:\n");

  // Check Queued → Claimed transition
  const claimedJobs = results.filter((r) =>
    r.transitions.some((t) => t.includes("CLAIMED")),
  );
  console.log(
    `✓ Queued → Claimed: ${claimedJobs.length > 0 ? "✅ Working" : "❌ Not Working"} (${claimedJobs.length}/${results.length} jobs)`,
  );

  // Check Claimed → Running transition
  const runningJobs = results.filter((r) =>
    r.transitions.some((t) => t.includes("RUNNING")),
  );
  console.log(
    `✓ Claimed → Running: ${runningJobs.length > 0 ? "✅ Working" : "❌ Not Working"} (${runningJobs.length}/${results.length} jobs)`,
  );

  // Check Running → Completed transition
  const completedJobs = results.filter((r) => r.status === JobStatus.COMPLETED);
  console.log(
    `✓ Running → Completed: ${completedJobs.length > 0 ? "✅ Working" : "❌ Not Working"} (${completedJobs.length} jobs)`,
  );

  // Check Running → Failed transition
  const failedJobs = results.filter((r) => r.status === JobStatus.FAILED);
  console.log(
    `✓ Running → Failed: ${failedJobs.length > 0 ? "✅ Working" : "❌ Not Working"} (${failedJobs.length} jobs)`,
  );

  // Check error capture
  const jobsWithErrors = results.filter((r) => r.error);
  console.log(
    `✓ Error Capture: ${jobsWithErrors.length > 0 ? "✅ Working" : "❌ Not Working"} (${jobsWithErrors.length} errors captured)`,
  );

  // Check exit code capture
  const jobsWithExitCodes = results.filter((r) => r.exitCode !== undefined);
  console.log(
    `✓ Exit Code Capture: ${jobsWithExitCodes.length > 0 ? "✅ Working" : "❌ Not Working"} (${jobsWithExitCodes.length} exit codes)`,
  );

  // Check status persistence (all jobs should have persisted status)
  const persistedStatuses = results.filter(
    (r) => r.status !== JobStatus.QUEUED,
  );
  console.log(
    `✓ Status Persistence: ${persistedStatuses.length === results.length ? "✅ Working" : "⚠️ Partial"} (${persistedStatuses.length}/${results.length} persisted)`,
  );

  // Check timestamp tracking
  const jobsWithTimestamps = results.filter((r) => r.transitions.length >= 2);
  console.log(
    `✓ Timestamp Tracking: ${jobsWithTimestamps.length > 0 ? "✅ Working" : "❌ Not Working"}`,
  );
}

function displaySummaryStatistics(results: StatusTestResult[]) {
  console.log("\n📊 Summary Statistics\n");

  const stats = {
    total: results.length,
    matched: results.filter((r) => r.statusMatches).length,
    completed: results.filter((r) => r.status === JobStatus.COMPLETED).length,
    failed: results.filter((r) => r.status === JobStatus.FAILED).length,
    running: results.filter((r) => r.status === JobStatus.RUNNING).length,
    queued: results.filter((r) => r.status === JobStatus.QUEUED).length,
    claimed: results.filter((r) => r.status === JobStatus.CLAIMED).length,
  };

  console.log(`Total Tests: ${stats.total}`);
  console.log(
    `Status Matches Expected: ${stats.matched}/${stats.total} (${((stats.matched / stats.total) * 100).toFixed(1)}%)`,
  );
  console.log(`\nFinal Status Distribution:`);
  console.log(`  Completed: ${stats.completed}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  Running: ${stats.running}`);
  console.log(`  Claimed: ${stats.claimed}`);
  console.log(`  Queued: ${stats.queued}`);

  // Average execution time
  const executedJobs = results.filter((r) => r.duration);
  if (executedJobs.length > 0) {
    const avgDuration =
      executedJobs.reduce((sum, r) => sum + (r.duration || 0), 0) /
      executedJobs.length;
    console.log(
      `\nAverage Execution Time: ${(avgDuration / 1000).toFixed(2)}s`,
    );
  }

  // Error rate
  const errorRate =
    (results.filter((r) => r.error).length / results.length) * 100;
  console.log(`Error Rate: ${errorRate.toFixed(1)}%`);

  // Overall assessment
  const allFeaturesWorking =
    stats.matched === stats.total &&
    results.some((r) => r.transitions.length >= 3) &&
    results.some((r) => r.error);

  console.log(
    `\n🎯 Overall Status Update System: ${allFeaturesWorking ? "✅ Fully Functional" : "⚠️ Partially Functional"}`,
  );
}

// Run the check
checkStatusTests().catch(console.error);
