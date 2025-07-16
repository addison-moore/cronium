#!/usr/bin/env tsx

/**
 * Script to check the results of runtime API tests
 */

import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { JobStatus } from "@/shared/schema";

interface RuntimeAPITestResult {
  name: string;
  jobId: string;
  status: JobStatus;
  success: boolean;
  exitCode?: number;
  output?: any;
  logs?: string[];
  error?: string;
  duration?: number;
  inputData?: any;
  outputData?: any;
}

async function checkRuntimeAPITests() {
  console.log("🔍 Checking Runtime API Test Results\n");

  // Get recent jobs with runtime-api-test trigger
  const { jobs } = await jobService.listJobs({}, 50);
  const runtimeAPIJobs = jobs.filter(
    (job) => (job.metadata as any)?.triggeredBy === "runtime-api-test",
  );

  if (runtimeAPIJobs.length === 0) {
    console.log("No runtime API test jobs found.");
    console.log("Run: pnpm tsx src/scripts/test-runtime-api.ts");
    return;
  }

  console.log(`Found ${runtimeAPIJobs.length} runtime API test jobs\n`);

  const results: RuntimeAPITestResult[] = [];

  // Analyze each job
  for (const job of runtimeAPIJobs) {
    const metadata = job.metadata as any;
    const result = job.result as any;
    const payload = job.payload as any;

    const testResult: RuntimeAPITestResult = {
      name: metadata.testCase || metadata.eventName || "Unknown",
      jobId: job.id,
      status: job.status,
      success: job.status === JobStatus.COMPLETED && result?.exitCode === 0,
      exitCode: result?.exitCode,
      output: result?.output,
      error: result?.error || job.lastError,
      inputData: payload?.inputData,
      outputData: result?.outputData,
    };

    if (job.startedAt && job.completedAt) {
      testResult.duration =
        new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
    }

    // Get detailed logs
    const logs = await storage.getLogsByJobId(job.id);
    if (logs.length > 0) {
      testResult.logs = logs.map((log) => `[${log.stream}] ${log.message}`);
    }

    results.push(testResult);
  }

  // Display results by test type
  console.log("=== Runtime API Test Results ===\n");

  // Group tests by category
  const inputOutputTests = results.filter((r) =>
    r.name.includes("Input/Output"),
  );
  const variableTests = results.filter((r) => r.name.includes("Variable"));
  const contextTests = results.filter((r) => r.name.includes("Context"));
  const conditionTests = results.filter((r) => r.name.includes("Condition"));
  const errorTests = results.filter((r) => r.name.includes("Error"));
  const integrationTests = results.filter((r) =>
    r.name.includes("Integration"),
  );

  // Display Input/Output Tests
  if (inputOutputTests.length > 0) {
    console.log("📥 Input/Output Tests:");
    for (const test of inputOutputTests) {
      displayTestResult(test);
    }
  }

  // Display Variable Tests
  if (variableTests.length > 0) {
    console.log("\n📦 Variable Management Tests:");
    for (const test of variableTests) {
      displayTestResult(test);
    }
  }

  // Display Context Tests
  if (contextTests.length > 0) {
    console.log("\n🔍 Event Context Tests:");
    for (const test of contextTests) {
      displayTestResult(test);
    }
  }

  // Display Condition Tests
  if (conditionTests.length > 0) {
    console.log("\n🔀 Workflow Condition Tests:");
    for (const test of conditionTests) {
      displayTestResult(test);
    }
  }

  // Display Error Handling Tests
  if (errorTests.length > 0) {
    console.log("\n⚠️ Error Handling Tests:");
    for (const test of errorTests) {
      displayTestResult(test);
    }
  }

  // Display Integration Tests
  if (integrationTests.length > 0) {
    console.log("\n🔗 Integration Tests:");
    for (const test of integrationTests) {
      displayTestResult(test);
    }
  }

  // Summary statistics
  displaySummary(results);

  // Verify Runtime API functionality
  verifyRuntimeAPIFunctionality(results);
}

function displayTestResult(test: RuntimeAPITestResult) {
  const icon = test.success ? "✅" : "❌";
  const statusText =
    test.status === JobStatus.QUEUED
      ? "⏳ Queued"
      : test.status === JobStatus.RUNNING
        ? "🔄 Running"
        : test.status === JobStatus.COMPLETED
          ? `Exit ${test.exitCode}`
          : test.status;

  console.log(`\n${icon} ${test.name}`);
  console.log(`   Job: ${test.jobId}`);
  console.log(`   Status: ${statusText}`);

  if (test.duration) {
    console.log(`   Duration: ${(test.duration / 1000).toFixed(2)}s`);
  }

  // Show input data if present
  if (test.inputData) {
    console.log(
      `   Input Data: ${JSON.stringify(test.inputData, null, 2).split("\n").join("\n   ")}`,
    );
  }

  // Show output data if present
  if (test.outputData) {
    console.log(
      `   Output Data: ${JSON.stringify(test.outputData, null, 2).split("\n").join("\n   ")}`,
    );
  }

  // Show selected logs for completed tests
  if (test.logs && test.status === JobStatus.COMPLETED) {
    console.log("   Key Logs:");
    const importantLogs = test.logs.filter(
      (log) =>
        log.includes("Getting input") ||
        log.includes("Setting output") ||
        log.includes("Variable") ||
        log.includes("Event") ||
        log.includes("Condition") ||
        log.includes("Error") ||
        log.includes("successfully"),
    );

    for (const log of importantLogs.slice(0, 10)) {
      console.log(`     ${log}`);
    }

    if (importantLogs.length > 10) {
      console.log(`     ... and ${importantLogs.length - 10} more logs`);
    }
  }

  if (test.error) {
    console.log(`   Error: ${test.error}`);
  }
}

function displaySummary(results: RuntimeAPITestResult[]) {
  console.log("\n\n📊 Summary Statistics\n");

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

  // Runtime breakdown
  const bashTests = results.filter((r) => r.name.includes("Bash"));
  const pythonTests = results.filter((r) => r.name.includes("Python"));
  const nodeTests = results.filter((r) => r.name.includes("Node.js"));

  console.log("\nBy Runtime:");
  console.log(
    `  Bash: ${bashTests.filter((t) => t.success).length}/${bashTests.length} passed`,
  );
  console.log(
    `  Python: ${pythonTests.filter((t) => t.success).length}/${pythonTests.length} passed`,
  );
  console.log(
    `  Node.js: ${nodeTests.filter((t) => t.success).length}/${nodeTests.length} passed`,
  );
}

function verifyRuntimeAPIFunctionality(results: RuntimeAPITestResult[]) {
  console.log("\n🔍 Runtime API Functionality Verification:\n");

  const completedTests = results.filter(
    (r) => r.status === JobStatus.COMPLETED,
  );

  // Check Input/Output
  const ioTests = completedTests.filter((r) => r.name.includes("Input/Output"));
  const ioWorking = ioTests.some(
    (t) => t.outputData && t.outputData.processed === true,
  );
  console.log(
    `✓ Input/Output API: ${ioWorking ? "✅ Working" : "❌ Not Working"}`,
  );

  // Check Variables
  const varTests = completedTests.filter((r) => r.name.includes("Variable"));
  const varsWorking = varTests.some(
    (t) => t.logs?.some((log) => log.includes("Counter after")) || false,
  );
  console.log(
    `✓ Variable Management: ${varsWorking ? "✅ Working" : "❌ Not Working"}`,
  );

  // Check Event Context
  const contextTests = completedTests.filter((r) => r.name.includes("Context"));
  const contextWorking = contextTests.some(
    (t) =>
      t.outputData?.event_id ||
      t.logs?.some((log) => log.includes("Event ID:")) ||
      false,
  );
  console.log(
    `✓ Event Context API: ${contextWorking ? "✅ Working" : "❌ Not Working"}`,
  );

  // Check Workflow Conditions
  const conditionTests = completedTests.filter((r) =>
    r.name.includes("Condition"),
  );
  const conditionsWorking = conditionTests.some(
    (t) => t.logs?.some((log) => log.includes("Condition set")) || false,
  );
  console.log(
    `✓ Workflow Conditions: ${conditionsWorking ? "✅ Working" : "❌ Not Working"}`,
  );

  // Check Runtime Helpers
  const bashHelpers = results.some((r) => r.name.includes("Bash") && r.success);
  const pythonHelpers = results.some(
    (r) => r.name.includes("Python") && r.success,
  );
  const nodeHelpers = results.some(
    (r) => r.name.includes("Node.js") && r.success,
  );

  console.log("\nRuntime Helpers:");
  console.log(`✓ cronium.sh: ${bashHelpers ? "✅ Working" : "❌ Not Working"}`);
  console.log(
    `✓ cronium.py: ${pythonHelpers ? "✅ Working" : "❌ Not Working"}`,
  );
  console.log(`✓ cronium.js: ${nodeHelpers ? "✅ Working" : "❌ Not Working"}`);

  // Overall assessment
  const allFeaturesWorking =
    ioWorking &&
    varsWorking &&
    contextWorking &&
    conditionsWorking &&
    bashHelpers &&
    pythonHelpers &&
    nodeHelpers;

  console.log(
    `\n🎯 Overall Runtime API Status: ${allFeaturesWorking ? "✅ Fully Functional" : "⚠️ Partially Functional"}`,
  );
}

// Run the check
checkRuntimeAPITests().catch(console.error);
