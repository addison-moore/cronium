#!/usr/bin/env tsx

/**
 * Migration to add execution-log integrity
 *
 * This migration:
 * 1. Adds executionId field to logs table
 * 2. Links existing logs to their executions
 * 3. Adds integrity checks
 * 4. Handles orphaned records
 */

import { db } from "../../server/db";
import { logs, executions, jobs } from "../../shared/schema";
import { eq, isNull, desc, sql } from "drizzle-orm";

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

async function addExecutionIdColumn() {
  log("\n=== Adding executionId Column to Logs ===", colors.cyan);

  try {
    // Add the column if it doesn't exist
    await db.execute(sql`
      ALTER TABLE logs 
      ADD COLUMN IF NOT EXISTS execution_id VARCHAR(100) 
      REFERENCES executions(id) ON DELETE CASCADE
    `);

    log("✓ Added executionId column to logs table", colors.green);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      log("Column already exists, skipping", colors.yellow);
    } else {
      throw error;
    }
  }
}

async function linkExistingLogsToExecutions() {
  log("\n=== Linking Existing Logs to Executions ===", colors.cyan);

  // Get all logs that don't have an executionId
  const unlinkedLogs = await db
    .select()
    .from(logs)
    .where(isNull(sql`logs.execution_id`));

  log(`Found ${unlinkedLogs.length} unlinked logs`, colors.yellow);

  let linked = 0;
  let orphaned = 0;

  for (const logEntry of unlinkedLogs) {
    if (!logEntry.jobId) {
      orphaned++;
      continue;
    }

    // Find the most recent execution for this job
    const [execution] = await db
      .select()
      .from(executions)
      .where(eq(executions.jobId, logEntry.jobId))
      .orderBy(desc(executions.createdAt))
      .limit(1);

    if (execution) {
      // Update the log with the execution ID
      await db.execute(sql`
        UPDATE logs 
        SET execution_id = ${execution.id}
        WHERE id = ${logEntry.id}
      `);
      linked++;
      log(
        `  Linked log ${logEntry.id} to execution ${execution.id}`,
        colors.green,
      );
    } else {
      // No execution found for this job - create one
      const newExecutionId = `exec-${logEntry.jobId}-recovery-${Date.now()}`;

      // Get job details to determine status
      const [job] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, logEntry.jobId))
        .limit(1);

      if (job) {
        // Create a recovery execution
        await db.insert(executions).values({
          id: newExecutionId,
          jobId: logEntry.jobId,
          status: job.status,
          startedAt: logEntry.startTime,
          completedAt: logEntry.endTime,
          exitCode: logEntry.exitCode,
          output: logEntry.output,
          error: logEntry.error,
          metadata: { recovered: true, fromLogId: logEntry.id },
          createdAt: logEntry.createdAt,
          updatedAt: logEntry.updatedAt,
        });

        // Link the log to the new execution
        await db.execute(sql`
          UPDATE logs 
          SET execution_id = ${newExecutionId}
          WHERE id = ${logEntry.id}
        `);

        linked++;
        log(
          `  Created recovery execution ${newExecutionId} for log ${logEntry.id}`,
          colors.yellow,
        );
      } else {
        orphaned++;
        log(
          `  Log ${logEntry.id} has no job (jobId: ${logEntry.jobId})`,
          colors.red,
        );
      }
    }
  }

  log(`\nLinked ${linked} logs to executions`, colors.green);
  if (orphaned > 0) {
    log(`Found ${orphaned} orphaned logs (no job or execution)`, colors.yellow);
  }
}

async function addIntegrityChecks() {
  log("\n=== Adding Integrity Checks ===", colors.cyan);

  // Create a function to check log-execution consistency
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION check_log_execution_integrity()
    RETURNS TABLE(
      log_id INTEGER,
      job_id VARCHAR(50),
      execution_id VARCHAR(100),
      log_status VARCHAR(50),
      execution_status VARCHAR(50),
      issue VARCHAR(255)
    ) AS $$
    BEGIN
      RETURN QUERY
      -- Check for logs without executions
      SELECT 
        l.id as log_id,
        l.job_id,
        l.execution_id,
        l.status as log_status,
        NULL::VARCHAR(50) as execution_status,
        'Log has no execution'::VARCHAR(255) as issue
      FROM logs l
      WHERE l.execution_id IS NULL
      
      UNION ALL
      
      -- Check for status mismatches
      SELECT 
        l.id as log_id,
        l.job_id,
        l.execution_id,
        l.status as log_status,
        e.status as execution_status,
        'Status mismatch between log and execution'::VARCHAR(255) as issue
      FROM logs l
      JOIN executions e ON l.execution_id = e.id
      WHERE 
        (l.status = 'SUCCESS' AND e.status != 'completed') OR
        (l.status = 'FAILURE' AND e.status NOT IN ('failed', 'timeout', 'cancelled')) OR
        (l.status = 'RUNNING' AND e.status NOT IN ('running', 'claimed'))
      
      UNION ALL
      
      -- Check for executions without logs
      SELECT 
        NULL::INTEGER as log_id,
        e.job_id,
        e.id as execution_id,
        NULL::VARCHAR(50) as log_status,
        e.status as execution_status,
        'Execution has no log'::VARCHAR(255) as issue
      FROM executions e
      WHERE NOT EXISTS (
        SELECT 1 FROM logs l WHERE l.execution_id = e.id
      );
    END;
    $$ LANGUAGE plpgsql;
  `);

  log("✓ Created integrity check function", colors.green);

  // Create an index for better performance
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_logs_execution_id 
    ON logs(execution_id)
  `);

  log("✓ Created index on execution_id", colors.green);
}

async function runIntegrityCheck() {
  log("\n=== Running Integrity Check ===", colors.cyan);

  const issues = await db.execute(sql`
    SELECT * FROM check_log_execution_integrity()
  `);

  if (issues.rows.length === 0) {
    log("✓ No integrity issues found!", colors.green);
  } else {
    log(`Found ${issues.rows.length} integrity issues:`, colors.yellow);
    for (const issue of issues.rows) {
      log(
        `  - ${issue.issue}: Log ${issue.log_id}, Execution ${issue.execution_id}`,
        colors.yellow,
      );
    }
  }

  return issues.rows;
}

async function createReconciliationJob() {
  log("\n=== Creating Reconciliation Job ===", colors.cyan);

  // Create a stored procedure for periodic reconciliation
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION reconcile_log_execution_status()
    RETURNS INTEGER AS $$
    DECLARE
      reconciled_count INTEGER := 0;
    BEGIN
      -- Update logs where execution status is more recent
      UPDATE logs l
      SET 
        status = CASE 
          WHEN e.status = 'completed' THEN 'SUCCESS'
          WHEN e.status IN ('failed', 'timeout') THEN 'FAILURE'
          WHEN e.status = 'cancelled' THEN 'FAILURE'
          WHEN e.status = 'running' THEN 'RUNNING'
          ELSE l.status
        END,
        updated_at = CURRENT_TIMESTAMP
      FROM executions e
      WHERE 
        l.execution_id = e.id
        AND e.updated_at > l.updated_at
        AND (
          (e.status = 'completed' AND l.status != 'SUCCESS') OR
          (e.status IN ('failed', 'timeout', 'cancelled') AND l.status != 'FAILURE') OR
          (e.status = 'running' AND l.status NOT IN ('RUNNING', 'SUCCESS', 'FAILURE'))
        );
      
      GET DIAGNOSTICS reconciled_count = ROW_COUNT;
      
      RETURN reconciled_count;
    END;
    $$ LANGUAGE plpgsql;
  `);

  log("✓ Created reconciliation function", colors.green);

  // Run reconciliation
  const result = await db.execute(sql`
    SELECT reconcile_log_execution_status() as count
  `);

  const count = result.rows[0]?.count || 0;
  log(`✓ Reconciled ${count} log records`, colors.green);
}

async function handleOrphanedRecords() {
  log("\n=== Handling Orphaned Records ===", colors.cyan);

  // Find logs without valid jobs
  const orphanedLogs = await db.execute(sql`
    SELECT l.* 
    FROM logs l
    LEFT JOIN jobs j ON l.job_id = j.id
    WHERE j.id IS NULL AND l.job_id IS NOT NULL
  `);

  if (orphanedLogs.rows.length > 0) {
    log(
      `Found ${orphanedLogs.rows.length} orphaned logs (job deleted)`,
      colors.yellow,
    );

    // Mark orphaned logs
    await db.execute(sql`
      UPDATE logs
      SET 
        status = 'FAILURE',
        error = COALESCE(error, '') || E'\n[ORPHANED: Job no longer exists]',
        updated_at = CURRENT_TIMESTAMP
      WHERE id IN (
        SELECT l.id 
        FROM logs l
        LEFT JOIN jobs j ON l.job_id = j.id
        WHERE j.id IS NULL AND l.job_id IS NOT NULL
      )
    `);

    log(`✓ Marked orphaned logs as failed`, colors.green);
  } else {
    log("✓ No orphaned logs found", colors.green);
  }

  // Find executions without valid jobs
  const orphanedExecutions = await db.execute(sql`
    SELECT e.* 
    FROM executions e
    LEFT JOIN jobs j ON e.job_id = j.id
    WHERE j.id IS NULL
  `);

  if (orphanedExecutions.rows.length > 0) {
    log(
      `Found ${orphanedExecutions.rows.length} orphaned executions (job deleted)`,
      colors.yellow,
    );

    // These will be cascade deleted if we have proper foreign keys
    // For now, just report them
  } else {
    log("✓ No orphaned executions found", colors.green);
  }
}

async function createIntegrityTrigger() {
  log("\n=== Creating Integrity Trigger ===", colors.cyan);

  // Create a trigger to ensure logs always have an execution
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION ensure_log_has_execution()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Only check if job_id is set and execution_id is not
      IF NEW.job_id IS NOT NULL AND NEW.execution_id IS NULL THEN
        -- Try to find an existing execution
        SELECT id INTO NEW.execution_id
        FROM executions
        WHERE job_id = NEW.job_id
        ORDER BY created_at DESC
        LIMIT 1;
        
        -- If no execution exists, we'll allow it but log a warning
        -- The application should create the execution
        IF NEW.execution_id IS NULL THEN
          RAISE NOTICE 'Log created without execution for job %', NEW.job_id;
        END IF;
      END IF;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create the trigger
  await db.execute(sql`
    DROP TRIGGER IF EXISTS ensure_log_execution_trigger ON logs;
    
    CREATE TRIGGER ensure_log_execution_trigger
    BEFORE INSERT OR UPDATE ON logs
    FOR EACH ROW
    EXECUTE FUNCTION ensure_log_has_execution();
  `);

  log("✓ Created integrity trigger", colors.green);
}

async function generateReport() {
  log("\n=== Generating Integrity Report ===", colors.cyan);

  // Get statistics
  const stats = await db.execute(sql`
    SELECT 
      (SELECT COUNT(*) FROM logs) as total_logs,
      (SELECT COUNT(*) FROM logs WHERE execution_id IS NOT NULL) as linked_logs,
      (SELECT COUNT(*) FROM logs WHERE execution_id IS NULL) as unlinked_logs,
      (SELECT COUNT(*) FROM executions) as total_executions,
      (SELECT COUNT(DISTINCT job_id) FROM executions) as unique_jobs,
      (SELECT COUNT(*) FROM logs l 
       JOIN executions e ON l.execution_id = e.id 
       WHERE l.status = 'SUCCESS' AND e.status = 'completed') as matching_success,
      (SELECT COUNT(*) FROM logs l 
       JOIN executions e ON l.execution_id = e.id 
       WHERE l.status = 'FAILURE' AND e.status IN ('failed', 'timeout', 'cancelled')) as matching_failure
  `);

  const s = stats.rows[0];

  log("\n📊 Integrity Report:", colors.blue);
  log(`  Total Logs: ${s.total_logs}`, colors.cyan);
  log(
    `  Linked Logs: ${s.linked_logs} (${((s.linked_logs / s.total_logs) * 100).toFixed(1)}%)`,
    colors.green,
  );
  log(
    `  Unlinked Logs: ${s.unlinked_logs}`,
    s.unlinked_logs > 0 ? colors.yellow : colors.green,
  );
  log(`  Total Executions: ${s.total_executions}`, colors.cyan);
  log(`  Unique Jobs: ${s.unique_jobs}`, colors.cyan);
  log(`  Matching Success: ${s.matching_success}`, colors.green);
  log(`  Matching Failure: ${s.matching_failure}`, colors.green);

  return stats.rows[0];
}

async function main() {
  log("Starting Execution-Log Integrity Migration", colors.blue);
  log("==========================================", colors.blue);

  try {
    // Step 1: Add executionId column
    await addExecutionIdColumn();

    // Step 2: Link existing logs to executions
    await linkExistingLogsToExecutions();

    // Step 3: Add integrity checks
    await addIntegrityChecks();

    // Step 4: Run initial integrity check
    await runIntegrityCheck();

    // Step 5: Create reconciliation job
    await createReconciliationJob();

    // Step 6: Handle orphaned records
    await handleOrphanedRecords();

    // Step 7: Create integrity trigger
    await createIntegrityTrigger();

    // Step 8: Generate report
    await generateReport();

    log("\n==========================================", colors.blue);
    log("Migration completed successfully!", colors.green);
    log("\nNext steps:", colors.yellow);
    log(
      "1. Update application code to set executionId when creating logs",
      colors.yellow,
    );
    log(
      "2. Run reconciliation periodically (call reconcile_log_execution_status())",
      colors.yellow,
    );
    log(
      "3. Monitor integrity with check_log_execution_integrity()",
      colors.yellow,
    );
  } catch (error) {
    log(`\nError during migration: ${error}`, colors.red);
    process.exit(1);
  }

  process.exit(0);
}

// Run the migration
main().catch(console.error);
