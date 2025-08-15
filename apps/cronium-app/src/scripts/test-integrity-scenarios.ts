#!/usr/bin/env tsx

/**
 * Test script to validate execution-log integrity scenarios
 *
 * Tests:
 * 1. Normal execution flow
 * 2. Interrupted execution
 * 3. Manual intervention
 * 4. Recovery from crashes
 */

import { db } from "../server/db";
import { jobs, executions, logs, JobStatus, LogStatus } from "../shared/schema";
import { eq } from "drizzle-orm";
import { integrityService } from "../lib/services/integrity-service";

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

async function testNormalExecutionFlow() {
  log("\n=== Testing Normal Execution Flow ===", colors.cyan);

  const jobId = `test-normal-${Date.now()}`;
  const executionId = `exec-${jobId}-${Date.now()}`;

  // Create job
  await db.insert(jobs).values({
    id: jobId,
    eventId: 1,
    userId: "test-user",
    status: JobStatus.RUNNING,
    type: "CONTAINER",
    payload: {},
    metadata: {},
  });

  // Create execution
  await db.insert(executions).values({
    id: executionId,
    jobId,
    status: JobStatus.RUNNING,
    startedAt: new Date(),
    metadata: {},
  });

  // Create log with execution link
  const [newLog] = await db
    .insert(logs)
    .values({
      eventId: 1,
      jobId,
      executionId,
      status: LogStatus.RUNNING,
      userId: "test-user",
      startTime: new Date(),
    })
    .returning();

  // Complete execution
  await db
    .update(executions)
    .set({
      status: JobStatus.COMPLETED,
      completedAt: new Date(),
      exitCode: 0,
      output: "Test completed successfully",
    })
    .where(eq(executions.id, executionId));

  // Update log
  await db
    .update(logs)
    .set({
      status: LogStatus.SUCCESS,
      endTime: new Date(),
      output: "Test completed successfully",
    })
    .where(eq(logs.id, newLog.id));

  // Verify integrity
  const [updatedLog] = await db
    .select()
    .from(logs)
    .where(eq(logs.id, newLog.id));
  const [updatedExecution] = await db
    .select()
    .from(executions)
    .where(eq(executions.id, executionId));

  if (updatedLog.executionId === executionId) {
    log("✓ Log correctly linked to execution", colors.green);
  } else {
    log(`✗ Log not linked to execution: ${updatedLog.executionId}`, colors.red);
  }

  if (
    updatedLog.status === LogStatus.SUCCESS &&
    updatedExecution.status === JobStatus.COMPLETED
  ) {
    log("✓ Status consistency maintained", colors.green);
  } else {
    log(
      `✗ Status mismatch: log=${updatedLog.status}, execution=${updatedExecution.status}`,
      colors.red,
    );
  }

  return { jobId, executionId, logId: newLog.id };
}

async function testInterruptedExecution() {
  log("\n=== Testing Interrupted Execution ===", colors.cyan);

  const jobId = `test-interrupted-${Date.now()}`;
  const executionId = `exec-${jobId}-${Date.now()}`;

  // Create job
  await db.insert(jobs).values({
    id: jobId,
    eventId: 1,
    userId: "test-user",
    status: JobStatus.RUNNING,
    type: "CONTAINER",
    payload: {},
    metadata: {},
  });

  // Create execution
  await db.insert(executions).values({
    id: executionId,
    jobId,
    status: JobStatus.RUNNING,
    startedAt: new Date(),
    metadata: {},
  });

  // Create log without execution link (simulating crash before link)
  const [newLog] = await db
    .insert(logs)
    .values({
      eventId: 1,
      jobId,
      status: LogStatus.RUNNING,
      userId: "test-user",
      startTime: new Date(),
    })
    .returning();

  log(`Created log ${newLog.id} without execution link`, colors.yellow);

  // Fix the link using integrity service
  await integrityService.linkLogToExecution(newLog.id, executionId);

  // Verify the link was established
  const [fixedLog] = await db.select().from(logs).where(eq(logs.id, newLog.id));

  if (fixedLog.executionId === executionId) {
    log("✓ Successfully linked orphaned log to execution", colors.green);
  } else {
    log(`✗ Failed to link log to execution`, colors.red);
  }

  // Simulate crash - execution failed but log still running
  await db
    .update(executions)
    .set({
      status: JobStatus.FAILED,
      completedAt: new Date(),
      exitCode: 1,
      error: "Process interrupted",
    })
    .where(eq(executions.id, executionId));

  // Reconcile statuses
  const reconciled = await integrityService.reconcileStatuses();
  log(`Reconciled ${reconciled} log records`, colors.yellow);

  // Check if log status was updated
  const [reconciledLog] = await db
    .select()
    .from(logs)
    .where(eq(logs.id, newLog.id));

  if (reconciledLog.status === LogStatus.FAILURE) {
    log("✓ Log status reconciled to match execution", colors.green);
  } else {
    log(`✗ Log status not reconciled: ${reconciledLog.status}`, colors.red);
  }

  return { jobId, executionId, logId: newLog.id };
}

async function testManualIntervention() {
  log("\n=== Testing Manual Intervention ===", colors.cyan);

  const jobId = `test-manual-${Date.now()}`;

  // Create job without execution (manual creation)
  await db.insert(jobs).values({
    id: jobId,
    eventId: 1,
    userId: "test-user",
    status: JobStatus.COMPLETED,
    type: "SSH",
    payload: {},
    metadata: { manual: true },
  });

  // Create log without execution
  const [newLog] = await db
    .insert(logs)
    .values({
      eventId: 1,
      jobId,
      status: LogStatus.SUCCESS,
      userId: "test-user",
      startTime: new Date(),
      endTime: new Date(),
      output: "Manually executed",
    })
    .returning();

  log(`Created manual log ${newLog.id} without execution`, colors.yellow);

  // Use integrity service to ensure execution exists
  const executionId = await integrityService.ensureLogHasExecution(newLog);

  log(`Created recovery execution: ${executionId}`, colors.green);

  // Verify execution was created
  const [createdExecution] = await db
    .select()
    .from(executions)
    .where(eq(executions.id, executionId));

  if (createdExecution) {
    log("✓ Recovery execution created successfully", colors.green);

    const metadata = createdExecution.metadata as any;
    if (metadata?.createdFromLog) {
      log("✓ Execution marked as recovery", colors.green);
    }
  } else {
    log("✗ Failed to create recovery execution", colors.red);
  }

  return { jobId, executionId, logId: newLog.id };
}

async function testRecoveryFromCrash() {
  log("\n=== Testing Recovery from Crash ===", colors.cyan);

  // Simulate multiple logs/executions in inconsistent state
  const testData = [];

  for (let i = 0; i < 3; i++) {
    const jobId = `test-crash-${Date.now()}-${i}`;
    const executionId = `exec-${jobId}-${Date.now()}`;

    // Create job
    await db.insert(jobs).values({
      id: jobId,
      eventId: 1,
      userId: "test-user",
      status: i === 0 ? JobStatus.RUNNING : JobStatus.FAILED,
      type: "CONTAINER",
      payload: {},
      metadata: {},
    });

    // Create execution with different status
    await db.insert(executions).values({
      id: executionId,
      jobId,
      status: i === 0 ? JobStatus.COMPLETED : JobStatus.RUNNING,
      startedAt: new Date(),
      metadata: {},
    });

    // Create log with mismatched status
    const [newLog] = await db
      .insert(logs)
      .values({
        eventId: 1,
        jobId,
        executionId: i === 2 ? undefined : executionId, // One without link
        status: i === 0 ? LogStatus.RUNNING : LogStatus.SUCCESS,
        userId: "test-user",
        startTime: new Date(),
      })
      .returning();

    testData.push({ jobId, executionId, logId: newLog.id });
  }

  log(
    `Created ${testData.length} test records with inconsistencies`,
    colors.yellow,
  );

  // Run integrity check
  const report = await integrityService.checkIntegrity();

  log("\n📊 Integrity Report:", colors.blue);
  log(`  Total Logs: ${report.totalLogs}`, colors.cyan);
  log(`  Linked Logs: ${report.linkedLogs}`, colors.green);
  log(
    `  Unlinked Logs: ${report.unlinkedLogs}`,
    report.unlinkedLogs > 0 ? colors.yellow : colors.green,
  );
  log(
    `  Status Mismatches: ${report.statusMismatches}`,
    report.statusMismatches > 0 ? colors.yellow : colors.green,
  );
  log(
    `  Issues Found: ${report.issues.length}`,
    report.issues.length > 0 ? colors.yellow : colors.green,
  );

  // Show first few issues
  if (report.issues.length > 0) {
    log("\n  Sample Issues:", colors.yellow);
    report.issues.slice(0, 5).forEach((issue) => {
      log(`    - ${issue.issue} (${issue.severity})`, colors.yellow);
    });
  }

  // Fix unlinked logs
  const fixResult = await integrityService.fixUnlinkedLogs();
  log(`\n✓ Fixed ${fixResult.linked} unlinked logs`, colors.green);
  if (fixResult.failed > 0) {
    log(`✗ Failed to fix ${fixResult.failed} logs`, colors.red);
  }

  // Reconcile statuses
  const reconciled = await integrityService.reconcileStatuses();
  log(`✓ Reconciled ${reconciled} status mismatches`, colors.green);

  return testData;
}

async function cleanupTestData(
  testData: Array<{ jobId: string; executionId: string; logId: number }>,
) {
  log("\n=== Cleaning Up Test Data ===", colors.yellow);

  for (const { jobId, executionId, logId } of testData) {
    // Delete in order due to foreign keys
    await db.delete(logs).where(eq(logs.id, logId));
    await db.delete(executions).where(eq(executions.id, executionId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
  }

  log(`Cleaned up ${testData.length} test records`, colors.green);
}

async function main() {
  log("Starting Execution-Log Integrity Tests", colors.blue);
  log("=======================================", colors.blue);

  const allTestData = [];

  try {
    // Run test scenarios
    const test1 = await testNormalExecutionFlow();
    allTestData.push(test1);

    const test2 = await testInterruptedExecution();
    allTestData.push(test2);

    const test3 = await testManualIntervention();
    allTestData.push(test3);

    const test4 = await testRecoveryFromCrash();
    allTestData.push(...test4);

    // Final integrity check
    log("\n=== Final Integrity Check ===", colors.cyan);
    const finalReport = await integrityService.checkIntegrity();

    const hasIssues =
      finalReport.unlinkedLogs > 0 ||
      finalReport.statusMismatches > 0 ||
      finalReport.orphanedLogs > 0 ||
      finalReport.orphanedExecutions > 0;

    if (!hasIssues) {
      log("✓ All integrity checks passed!", colors.green);
    } else {
      log(
        "⚠ Some integrity issues remain (may be from other tests)",
        colors.yellow,
      );
    }

    // Cleanup (optional - comment out to keep test data)
    await cleanupTestData(allTestData);

    log("\n=======================================", colors.blue);
    log("All integrity tests completed!", colors.green);
  } catch (error) {
    log(`\nError during tests: ${error}`, colors.red);

    // Try to cleanup on error
    try {
      await cleanupTestData(allTestData);
    } catch {
      // Ignore cleanup errors
    }

    process.exit(1);
  }

  process.exit(0);
}

// Run the tests
main().catch(console.error);
