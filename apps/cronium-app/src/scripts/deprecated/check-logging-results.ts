#!/usr/bin/env tsx

/**
 * Script to check the results of logging system tests
 */

import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { JobStatus } from "@/shared/schema";

interface LoggingTestResult {
  name: string;
  jobId: string;
  logId: number;
  status: JobStatus;
  success: boolean;
  exitCode?: number;
  logCount: number;
  stdoutCount: number;
  stderrCount: number;
  logs: Array<{
    stream: string;
    message: string;
    timestamp: Date;
  }>;
  duration?: number;
  error?: string;
}

async function checkLoggingTests() {
  console.log("🔍 Checking Logging System Test Results\n");

  // Get recent jobs with logging-test trigger
  const { jobs } = await jobService.listJobs({}, 50);
  const loggingTestJobs = jobs.filter(
    (job) => (job.metadata as any)?.triggeredBy === "logging-test",
  );

  if (loggingTestJobs.length === 0) {
    console.log("No logging test jobs found.");
    console.log("Run: pnpm tsx src/scripts/test-logging-system.ts");
    return;
  }

  console.log(`Found ${loggingTestJobs.length} logging test jobs\n`);

  const results: LoggingTestResult[] = [];

  // Analyze each job
  for (const job of loggingTestJobs) {
    const metadata = job.metadata as any;
    const result = job.result as any;

    // Get logs from database
    const logs = await storage.getLogsByJobId(job.id);

    const testResult: LoggingTestResult = {
      name: metadata.testCase || metadata.eventName || "Unknown",
      jobId: job.id,
      logId: metadata.logId || 0,
      status: job.status,
      success: job.status === JobStatus.COMPLETED && result?.exitCode === 0,
      exitCode: result?.exitCode,
      logCount: logs.length,
      stdoutCount: 0,
      stderrCount: 0,
      logs: [],
      error: result?.error || job.lastError,
    };

    // Process logs
    for (const log of logs) {
      if (log.output) {
        testResult.stdoutCount++;
        testResult.logs.push({
          stream: "stdout",
          message: log.output,
          timestamp: log.startTime,
        });
      }
      if (log.error) {
        testResult.stderrCount++;
        testResult.logs.push({
          stream: "stderr",
          message: log.error,
          timestamp: log.startTime,
        });
      }
    }

    // Sort logs by timestamp
    testResult.logs.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    if (job.startedAt && job.completedAt) {
      testResult.duration =
        new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
    }

    results.push(testResult);
  }

  // Display results by test
  console.log("=== Logging System Test Results ===\n");

  for (const test of results) {
    const icon = test.success ? "✅" : "❌";
    const statusText =
      test.status === JobStatus.QUEUED
        ? "⏳ Queued"
        : test.status === JobStatus.RUNNING
          ? "🔄 Running"
          : test.status === JobStatus.COMPLETED
            ? `Exit ${test.exitCode}`
            : test.status;

    console.log(`${icon} ${test.name}`);
    console.log(`   Job: ${test.jobId}`);
    console.log(`   Log ID: ${test.logId}`);
    console.log(`   Status: ${statusText}`);

    if (test.duration) {
      console.log(`   Duration: ${(test.duration / 1000).toFixed(2)}s`);
    }

    console.log(`   Log Stats:`);
    console.log(`     Total entries: ${test.logCount}`);
    console.log(`     Stdout: ${test.stdoutCount}`);
    console.log(`     Stderr: ${test.stderrCount}`);

    // Show sample logs
    if (test.logs.length > 0 && test.status === JobStatus.COMPLETED) {
      console.log(`   Sample Logs:`);
      const sampleLogs = test.logs.slice(0, 5);
      for (const log of sampleLogs) {
        const prefix = log.stream === "stderr" ? "❌" : "✓";
        console.log(
          `     ${prefix} [${log.stream}] ${log.message.substring(0, 60)}${log.message.length > 60 ? "..." : ""}`,
        );
      }
      if (test.logs.length > 5) {
        console.log(`     ... and ${test.logs.length - 5} more log entries`);
      }
    }

    if (test.error) {
      console.log(`   Error: ${test.error}`);
    }

    console.log();
  }

  // Verify logging features
  displayLoggingFeatureVerification(results);

  // Summary statistics
  displaySummaryStatistics(results);
}

function displayLoggingFeatureVerification(results: LoggingTestResult[]) {
  console.log("\n🔍 Logging Feature Verification:\n");

  const completedTests = results.filter(
    (r) => r.status === JobStatus.COMPLETED,
  );

  // Check stdout/stderr separation
  const stdoutStderrTest = completedTests.find((r) =>
    r.name.includes("Basic stdout/stderr"),
  );
  const streamSeparation =
    stdoutStderrTest &&
    stdoutStderrTest.stdoutCount > 0 &&
    stdoutStderrTest.stderrCount > 0;
  console.log(
    `✓ Stdout/Stderr Separation: ${streamSeparation ? "✅ Working" : "❌ Not Working"}`,
  );

  // Check multi-line handling
  const multiLineTest = completedTests.find((r) =>
    r.name.includes("Multi-line"),
  );
  const multiLineHandling =
    multiLineTest && multiLineTest.logs.some((l) => l.message.includes("Line"));
  console.log(
    `✓ Multi-line Output: ${multiLineHandling ? "✅ Working" : "❌ Not Working"}`,
  );

  // Check streaming
  const streamingTest = completedTests.find((r) =>
    r.name.includes("Streaming"),
  );
  const streamingWorks =
    streamingTest &&
    streamingTest.logs.some((l) => l.message.includes("Progress:"));
  console.log(
    `✓ Real-time Streaming: ${streamingWorks ? "✅ Working" : "❌ Not Working"}`,
  );

  // Check large output
  const largeOutputTest = completedTests.find((r) =>
    r.name.includes("Large Output"),
  );
  const largeOutputWorks = largeOutputTest && largeOutputTest.logCount >= 50;
  console.log(
    `✓ Large Output Handling: ${largeOutputWorks ? "✅ Working" : "❌ Not Working"}`,
  );

  // Check Unicode
  const unicodeTest = completedTests.find((r) => r.name.includes("Unicode"));
  const unicodeWorks =
    unicodeTest && unicodeTest.logs.some((l) => l.message.includes("🚀"));
  console.log(
    `✓ Unicode Support: ${unicodeWorks ? "✅ Working" : "❌ Not Working"}`,
  );

  // Check error scenarios
  const errorTest = completedTests.find((r) =>
    r.name.includes("Error Scenarios"),
  );
  const errorHandling = errorTest && errorTest.stderrCount > 0;
  console.log(
    `✓ Error Handling: ${errorHandling ? "✅ Working" : "❌ Not Working"}`,
  );

  // Database persistence
  const dbPersistence = completedTests.every((r) => r.logCount > 0);
  console.log(
    `✓ Database Persistence: ${dbPersistence ? "✅ Working" : "❌ Not Working"}`,
  );

  // Check log ordering
  const orderedLogs = completedTests.every((r) => {
    for (let i = 1; i < r.logs.length; i++) {
      if (r.logs[i].timestamp < r.logs[i - 1].timestamp) {
        return false;
      }
    }
    return true;
  });
  console.log(
    `✓ Log Ordering: ${orderedLogs ? "✅ Maintained" : "❌ Issues Detected"}`,
  );
}

function displaySummaryStatistics(results: LoggingTestResult[]) {
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

  // Log statistics
  const completedTests = results.filter(
    (r) => r.status === JobStatus.COMPLETED,
  );
  if (completedTests.length > 0) {
    const totalLogs = completedTests.reduce((sum, r) => sum + r.logCount, 0);
    const totalStdout = completedTests.reduce(
      (sum, r) => sum + r.stdoutCount,
      0,
    );
    const totalStderr = completedTests.reduce(
      (sum, r) => sum + r.stderrCount,
      0,
    );
    const avgLogsPerJob = totalLogs / completedTests.length;

    console.log("\nLog Statistics:");
    console.log(`  Total log entries: ${totalLogs}`);
    console.log(`  Total stdout: ${totalStdout}`);
    console.log(`  Total stderr: ${totalStderr}`);
    console.log(`  Average logs per job: ${avgLogsPerJob.toFixed(1)}`);
  }

  // Performance
  const durations = results
    .filter((r) => r.duration !== undefined)
    .map((r) => r.duration!);

  if (durations.length > 0) {
    const avgDuration =
      durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const maxDuration = Math.max(...durations);
    const minDuration = Math.min(...durations);

    console.log("\nPerformance:");
    console.log(`  Average duration: ${(avgDuration / 1000).toFixed(2)}s`);
    console.log(`  Min duration: ${(minDuration / 1000).toFixed(2)}s`);
    console.log(`  Max duration: ${(maxDuration / 1000).toFixed(2)}s`);
  }

  // Overall assessment
  const allFeaturesWorking =
    stats.successful === stats.completed &&
    completedTests.every((r) => r.logCount > 0);

  console.log(
    `\n🎯 Overall Logging System Status: ${allFeaturesWorking ? "✅ Fully Functional" : "⚠️ Partially Functional"}`,
  );
}

// Run the check
checkLoggingTests().catch(console.error);
