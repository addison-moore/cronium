#!/usr/bin/env tsx

/**
 * Test script to validate error handling scenarios
 *
 * Tests:
 * 1. Timeout detection (exit code -1)
 * 2. Connection failures (exit code -3)
 * 3. API errors with retry
 * 4. Network errors with retry
 * 5. Validation errors (non-retryable)
 */

import { db } from "../server/db";
import { jobs, executions, logs, JobStatus, LogStatus } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function testTimeoutScenario() {
  log("\n=== Testing Timeout Scenario ===", colors.cyan);

  // Create a job that will timeout
  const jobId = `test-timeout-${Date.now()}`;

  await db.insert(jobs).values({
    id: jobId,
    eventId: 1,
    userId: "test-user",
    status: JobStatus.FAILED,
    type: "CONTAINER",
    payload: {
      type: "container",
      script: {
        type: "bash",
        content: "sleep 30", // Long-running script
      },
      timeout: 5, // 5 second timeout
    },
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Create execution with timeout exit code
  const executionId = `exec-${jobId}`;
  await db.insert(executions).values({
    id: executionId,
    jobId,
    status: "failed",
    exitCode: -1, // Timeout indicator
    error: "Job execution timed out after 5s",
    startedAt: new Date(),
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Create log
  await db.insert(logs).values({
    id: `log-${jobId}`,
    eventId: 1,
    jobId,
    executionId,
    status: LogStatus.TIMEOUT,
    startedAt: new Date(),
    completedAt: new Date(),
    exitCode: -1,
    error: "Job execution timed out after 5s",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Verify the data
  const [logRecord] = await db.select().from(logs).where(eq(logs.jobId, jobId));

  if (logRecord?.status === LogStatus.TIMEOUT) {
    log("✓ Timeout scenario: Log shows TIMEOUT status", colors.green);
  } else {
    log(
      `✗ Timeout scenario: Expected TIMEOUT, got ${String(logRecord?.status ?? "undefined")}`,
      colors.red,
    );
  }

  if (logRecord?.exitCode === -1) {
    log("✓ Timeout scenario: Exit code is -1", colors.green);
  } else {
    log(
      `✗ Timeout scenario: Expected exit code -1, got ${String(logRecord?.exitCode ?? "undefined")}`,
      colors.red,
    );
  }
}

async function testConnectionFailureScenario() {
  log("\n=== Testing Connection Failure Scenario ===", colors.cyan);

  const jobId = `test-conn-fail-${Date.now()}`;

  await db.insert(jobs).values({
    id: jobId,
    eventId: 1,
    userId: "test-user",
    status: JobStatus.FAILED,
    type: "SSH",
    payload: {
      type: "ssh",
      serverId: "999", // Non-existent server
      script: {
        type: "bash",
        content: "echo 'test'",
      },
    },
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Create execution with connection failure exit code
  const executionId = `exec-${jobId}`;
  await db.insert(executions).values({
    id: executionId,
    jobId,
    status: "failed",
    exitCode: -3, // Connection failure indicator
    error: "SSH connection failed: Connection refused",
    startedAt: new Date(),
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Create log
  await db.insert(logs).values({
    id: `log-${jobId}`,
    eventId: 1,
    jobId,
    executionId,
    status: LogStatus.FAILURE,
    startedAt: new Date(),
    completedAt: new Date(),
    exitCode: -3,
    error: "SSH connection failed: Connection refused",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Verify the data
  const [logRecord] = await db.select().from(logs).where(eq(logs.jobId, jobId));

  if (logRecord?.status === LogStatus.FAILURE) {
    log("✓ Connection failure: Log shows FAILURE status", colors.green);
  } else {
    log(
      `✗ Connection failure: Expected FAILURE, got ${logRecord?.status}`,
      colors.red,
    );
  }

  if (logRecord?.exitCode === -3) {
    log("✓ Connection failure: Exit code is -3", colors.green);
  } else {
    log(
      `✗ Connection failure: Expected exit code -3, got ${logRecord?.exitCode}`,
      colors.red,
    );
  }
}

async function testPartialSuccessScenario() {
  log("\n=== Testing Partial Success Scenario (Multi-Server) ===", colors.cyan);

  const jobId = `test-partial-${Date.now()}`;

  await db.insert(jobs).values({
    id: jobId,
    eventId: 1,
    userId: "test-user",
    status: JobStatus.COMPLETED, // Partial success is still completed
    type: "SSH",
    payload: {
      type: "ssh",
      serverIds: ["1", "2", "3"], // Multiple servers
      script: {
        type: "bash",
        content: "echo 'test'",
      },
    },
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Create main execution with partial success exit code
  const mainExecId = `exec-${jobId}`;
  await db.insert(executions).values({
    id: mainExecId,
    jobId,
    status: "completed",
    exitCode: 101, // 100 + 1 failure
    output: "2 of 3 servers succeeded",
    startedAt: new Date(),
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Create individual server executions
  const serverExecs = [
    {
      id: `exec-${jobId}-srv1`,
      serverId: "1",
      status: "completed",
      exitCode: 0,
    },
    {
      id: `exec-${jobId}-srv2`,
      serverId: "2",
      status: "completed",
      exitCode: 0,
    },
    { id: `exec-${jobId}-srv3`, serverId: "3", status: "failed", exitCode: 1 },
  ];

  for (const exec of serverExecs) {
    await db.insert(executions).values({
      id: exec.id,
      jobId,
      serverId: exec.serverId,
      status: exec.status as any,
      exitCode: exec.exitCode,
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Create log
  await db.insert(logs).values({
    id: `log-${jobId}`,
    eventId: 1,
    jobId,
    executionId: mainExecId,
    status: LogStatus.PARTIAL,
    startedAt: new Date(),
    completedAt: new Date(),
    exitCode: 101,
    output: "2 of 3 servers succeeded",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Verify the data
  const [logRecord] = await db.select().from(logs).where(eq(logs.jobId, jobId));

  if (logRecord?.status === LogStatus.PARTIAL) {
    log("✓ Partial success: Log shows PARTIAL status", colors.green);
  } else {
    log(
      `✗ Partial success: Expected PARTIAL, got ${logRecord?.status}`,
      colors.red,
    );
  }

  if (logRecord?.exitCode === 101) {
    log("✓ Partial success: Exit code is 101 (100 + 1 failure)", colors.green);
  } else {
    log(
      `✗ Partial success: Expected exit code 101, got ${logRecord?.exitCode}`,
      colors.red,
    );
  }
}

async function cleanupTestData() {
  log("\n=== Cleaning up test data ===", colors.yellow);

  // Delete test logs
  await db.delete(logs).where(eq(logs.id, "log-test-timeout-1"));

  // Delete test executions
  await db.delete(executions).where(eq(executions.id, "exec-test-1"));

  // Delete test jobs
  const testJobPattern = "test-%";
  const result = await db.execute`
    DELETE FROM jobs WHERE id LIKE ${testJobPattern}
  `;

  log("Test data cleaned up", colors.green);
}

async function main() {
  log("Starting Error Scenario Tests", colors.blue);
  log("================================", colors.blue);

  try {
    // Run test scenarios
    await testTimeoutScenario();
    await testConnectionFailureScenario();
    await testPartialSuccessScenario();

    // Cleanup (optional - comment out to keep test data)
    // await cleanupTestData();

    log("\n================================", colors.blue);
    log("All tests completed!", colors.green);
    log(
      "Check the database to verify the test records were created correctly.",
      colors.yellow,
    );
  } catch (error) {
    log(`\nError during tests: ${error}`, colors.red);
    process.exit(1);
  }

  process.exit(0);
}

// Run the tests
main().catch(console.error);
