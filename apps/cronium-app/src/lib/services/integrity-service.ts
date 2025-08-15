/**
 * Service for maintaining execution-log integrity
 */

import { db } from "@/server/db";
import { logs, executions, jobs } from "@/shared/schema";
import { eq, isNull, sql } from "drizzle-orm";
import type { Log } from "@/shared/schema";

export interface IntegrityIssue {
  logId?: number;
  executionId?: string;
  jobId?: string;
  issue: string;
  severity: "warning" | "error";
}

export interface IntegrityReport {
  totalLogs: number;
  linkedLogs: number;
  unlinkedLogs: number;
  totalExecutions: number;
  orphanedLogs: number;
  orphanedExecutions: number;
  statusMismatches: number;
  issues: IntegrityIssue[];
}

class IntegrityService {
  /**
   * Link a log to its execution
   */
  async linkLogToExecution(logId: number, executionId: string): Promise<void> {
    await db
      .update(logs)
      .set({
        executionId,
        updatedAt: new Date(),
      })
      .where(eq(logs.id, logId));
  }

  /**
   * Find or create execution for a log
   */
  async ensureLogHasExecution(log: Log): Promise<string> {
    // If log already has execution, return it
    if (log.executionId) {
      return log.executionId;
    }

    // If no jobId, can't create execution
    if (!log.jobId) {
      throw new Error(`Log ${log.id} has no jobId`);
    }

    // Try to find existing execution for this job
    const [existingExecution] = await db
      .select()
      .from(executions)
      .where(eq(executions.jobId, log.jobId))
      .orderBy(sql`${executions.createdAt} DESC`)
      .limit(1);

    if (existingExecution) {
      // Link the log to the existing execution
      await this.linkLogToExecution(log.id, existingExecution.id);
      return existingExecution.id;
    }

    // Create a new execution for this log
    const newExecutionId = `exec-${log.jobId}-${Date.now()}`;

    // Get job details
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, log.jobId))
      .limit(1);

    if (!job) {
      throw new Error(`Job ${log.jobId} not found for log ${log.id}`);
    }

    // Create execution with log data
    await db.insert(executions).values({
      id: newExecutionId,
      jobId: log.jobId,
      status: job.status,
      startedAt: log.startTime,
      completedAt: log.endTime ?? undefined,
      exitCode: log.exitCode ?? undefined,
      output: log.output ?? undefined,
      error: log.error ?? undefined,
      metadata: {
        createdFromLog: true,
        logId: log.id,
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Link the log to the new execution
    await this.linkLogToExecution(log.id, newExecutionId);

    return newExecutionId;
  }

  /**
   * Check integrity between logs and executions
   */
  async checkIntegrity(): Promise<IntegrityReport> {
    const issues: IntegrityIssue[] = [];

    // Get statistics
    const statsResult = await db.execute<{
      total_logs: number;
      linked_logs: number;
      unlinked_logs: number;
      total_executions: number;
    }>(sql`
      SELECT 
        (SELECT COUNT(*) FROM logs) as total_logs,
        (SELECT COUNT(*) FROM logs WHERE execution_id IS NOT NULL) as linked_logs,
        (SELECT COUNT(*) FROM logs WHERE execution_id IS NULL) as unlinked_logs,
        (SELECT COUNT(*) FROM executions) as total_executions
    `);

    const stats = statsResult.rows[0];

    // Find logs without executions
    const unlinkedLogs = await db
      .select()
      .from(logs)
      .where(isNull(logs.executionId))
      .limit(100);

    for (const log of unlinkedLogs) {
      const issue: IntegrityIssue = {
        logId: log.id,
        issue: "Log has no linked execution",
        severity: "warning",
      };
      if (log.jobId) {
        issue.jobId = log.jobId;
      }
      issues.push(issue);
    }

    // Find status mismatches
    const mismatches = await db.execute<{
      log_id: number;
      execution_id: string;
      log_status: string;
      execution_status: string;
    }>(sql`
      SELECT 
        l.id as log_id,
        l.execution_id,
        l.status as log_status,
        e.status as execution_status
      FROM logs l
      JOIN executions e ON l.execution_id = e.id
      WHERE 
        (l.status = 'SUCCESS' AND e.status != 'completed') OR
        (l.status = 'FAILURE' AND e.status NOT IN ('failed', 'timeout', 'cancelled')) OR
        (l.status = 'TIMEOUT' AND e.status != 'timeout')
      LIMIT 100
    `);

    for (const mismatch of mismatches.rows) {
      issues.push({
        logId: mismatch.log_id,
        executionId: mismatch.execution_id,
        issue: `Status mismatch: log=${mismatch.log_status}, execution=${mismatch.execution_status}`,
        severity: "error",
      });
    }

    // Find orphaned logs (no job)
    const orphanedLogs = await db.execute<{
      log_id: number;
      job_id: string;
    }>(sql`
      SELECT l.id as log_id, l.job_id
      FROM logs l
      LEFT JOIN jobs j ON l.job_id = j.id
      WHERE j.id IS NULL AND l.job_id IS NOT NULL
      LIMIT 100
    `);

    for (const orphan of orphanedLogs.rows) {
      issues.push({
        logId: orphan.log_id,
        jobId: orphan.job_id,
        issue: "Log references non-existent job",
        severity: "error",
      });
    }

    // Find orphaned executions (no job)
    const orphanedExecutions = await db.execute<{
      execution_id: string;
      job_id: string;
    }>(sql`
      SELECT e.id as execution_id, e.job_id
      FROM executions e
      LEFT JOIN jobs j ON e.job_id = j.id
      WHERE j.id IS NULL
      LIMIT 100
    `);

    for (const orphan of orphanedExecutions.rows) {
      issues.push({
        executionId: orphan.execution_id,
        jobId: orphan.job_id,
        issue: "Execution references non-existent job",
        severity: "error",
      });
    }

    return {
      totalLogs: stats?.total_logs ?? 0,
      linkedLogs: stats?.linked_logs ?? 0,
      unlinkedLogs: stats?.unlinked_logs ?? 0,
      totalExecutions: stats?.total_executions ?? 0,
      orphanedLogs: orphanedLogs.rows.length,
      orphanedExecutions: orphanedExecutions.rows.length,
      statusMismatches: mismatches.rows.length,
      issues,
    };
  }

  /**
   * Reconcile log and execution statuses
   */
  async reconcileStatuses(): Promise<number> {
    // Update logs where execution status is more recent
    const result = await db.execute(sql`
      UPDATE logs l
      SET 
        status = CASE 
          WHEN e.status = 'completed' THEN 'SUCCESS'
          WHEN e.status = 'timeout' THEN 'TIMEOUT'
          WHEN e.status IN ('failed', 'cancelled') THEN 'FAILURE'
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
          (e.status = 'timeout' AND l.status != 'TIMEOUT') OR
          (e.status IN ('failed', 'cancelled') AND l.status != 'FAILURE') OR
          (e.status = 'running' AND l.status NOT IN ('RUNNING', 'SUCCESS', 'FAILURE', 'TIMEOUT'))
        )
    `);

    return result.rowCount ?? 0;
  }

  /**
   * Clean up orphaned records
   */
  async cleanupOrphans(): Promise<{ logs: number; executions: number }> {
    // Mark orphaned logs as failed
    const logsResult = await db.execute(sql`
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

    // Delete orphaned executions (if foreign key constraints allow)
    const execResult = await db.execute(sql`
      DELETE FROM executions
      WHERE id IN (
        SELECT e.id 
        FROM executions e
        LEFT JOIN jobs j ON e.job_id = j.id
        WHERE j.id IS NULL
      )
    `);

    return {
      logs: logsResult.rowCount ?? 0,
      executions: execResult.rowCount ?? 0,
    };
  }

  /**
   * Fix all unlinked logs
   */
  async fixUnlinkedLogs(): Promise<{ linked: number; failed: number }> {
    const unlinkedLogs = await db
      .select()
      .from(logs)
      .where(isNull(logs.executionId));

    let linked = 0;
    let failed = 0;

    for (const log of unlinkedLogs) {
      try {
        await this.ensureLogHasExecution(log);
        linked++;
      } catch (error) {
        console.error(`Failed to link log ${log.id}:`, error);
        failed++;
      }
    }

    return { linked, failed };
  }
}

// Export singleton instance
export const integrityService = new IntegrityService();
