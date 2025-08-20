/**
 * Job Polling Service
 *
 * Provides synchronous-like behavior for workflow execution by polling
 * job status until completion and returning full execution results.
 */

import { db } from "@/server/db";
import { jobs, executions, logs } from "@/shared/schema";
import { eq, desc } from "drizzle-orm";
import { JobStatus } from "@/shared/schema";

export interface JobPollOptions {
  jobId: string;
  maxWaitTime?: number; // milliseconds, default 5 minutes
  pollInterval?: number; // milliseconds, default 1 second
}

export interface JobResult {
  success: boolean;
  status: JobStatus;
  output?: string | undefined;
  error?: string | undefined;
  scriptOutput?: unknown;
  condition?: boolean | undefined;
  exitCode?: number | undefined;
  duration?: number | undefined;
  executionId?: string | undefined;
}

/**
 * Wait for a job to complete and return its results
 */
export async function waitForJobCompletion(
  options: JobPollOptions,
): Promise<JobResult> {
  const {
    jobId,
    maxWaitTime = 5 * 60 * 1000, // 5 minutes
    pollInterval = 1000, // 1 second
  } = options;

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkJob = async () => {
      try {
        // Check if we've exceeded max wait time
        if (Date.now() - startTime > maxWaitTime) {
          return resolve({
            success: false,
            status: JobStatus.FAILED,
            error: `Job ${jobId} timed out after ${maxWaitTime}ms`,
          });
        }

        // Query job status
        const [job] = await db
          .select()
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);

        if (!job) {
          return reject(new Error(`Job ${jobId} not found`));
        }

        // If job is still pending or running, continue polling
        if (
          job.status === JobStatus.QUEUED ||
          job.status === JobStatus.CLAIMED ||
          job.status === JobStatus.RUNNING
        ) {
          setTimeout(() => void checkJob(), pollInterval);
          return;
        }

        // Job has completed (success or failure)
        // Get execution details
        const [execution] = await db
          .select()
          .from(executions)
          .where(eq(executions.jobId, jobId))
          .orderBy(desc(executions.createdAt))
          .limit(1);

        // Get log details
        const [log] = await db
          .select()
          .from(logs)
          .where(eq(logs.jobId, jobId))
          .orderBy(desc(logs.createdAt))
          .limit(1);

        // Calculate duration
        let duration: number | undefined;
        if (job.startedAt && job.completedAt) {
          duration =
            new Date(job.completedAt).getTime() -
            new Date(job.startedAt).getTime();
        } else if (log?.duration) {
          duration = log.duration;
        }

        // Extract script output and condition from job result
        let scriptOutput: unknown;
        let condition: boolean | undefined;

        if (job.result && typeof job.result === "object") {
          const result = job.result as Record<string, unknown>;

          // Check for script output in various locations
          if ("scriptOutput" in result) {
            scriptOutput = result.scriptOutput;
          } else if ("output" in result && typeof result.output === "object") {
            const outputData = result.output as Record<string, unknown>;
            if ("data" in outputData) {
              scriptOutput = outputData.data;
            }
          }

          // Check for condition
          if ("condition" in result) {
            condition = result.condition as boolean;
          }
        }

        // Determine success based on job status
        const success = job.status === JobStatus.COMPLETED;

        // Build result
        const result: JobResult = {
          success,
          status: job.status as JobStatus,
          output: execution?.output || log?.output || undefined,
          error: execution?.error || log?.error || job.lastError || undefined,
          scriptOutput,
          condition,
          exitCode: execution?.exitCode || log?.exitCode || undefined,
          duration,
          executionId: execution?.id,
        };

        resolve(result);
      } catch (error) {
        console.error(`Error polling job ${jobId}:`, error);
        // Don't reject, continue polling
        setTimeout(() => void checkJob(), pollInterval);
      }
    };

    // Start polling
    void checkJob();
  });
}

/**
 * Get job result immediately without waiting
 * Useful for checking if a job has already completed
 */
export async function getJobResult(jobId: string): Promise<JobResult | null> {
  try {
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      return null;
    }

    // If job is still running, return null
    if (
      job.status === JobStatus.QUEUED ||
      job.status === JobStatus.CLAIMED ||
      job.status === JobStatus.RUNNING
    ) {
      return null;
    }

    // Get execution and log details
    const [execution] = await db
      .select()
      .from(executions)
      .where(eq(executions.jobId, jobId))
      .orderBy(desc(executions.createdAt))
      .limit(1);

    const [log] = await db
      .select()
      .from(logs)
      .where(eq(logs.jobId, jobId))
      .orderBy(desc(logs.createdAt))
      .limit(1);

    // Calculate duration
    let duration: number | undefined;
    if (job.startedAt && job.completedAt) {
      duration =
        new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
    } else if (log?.duration) {
      duration = log.duration;
    }

    // Extract script output and condition
    let scriptOutput: unknown;
    let condition: boolean | undefined;

    if (job.result && typeof job.result === "object") {
      const result = job.result as Record<string, unknown>;

      if ("scriptOutput" in result) {
        scriptOutput = result.scriptOutput;
      } else if ("output" in result && typeof result.output === "object") {
        const outputData = result.output as Record<string, unknown>;
        if ("data" in outputData) {
          scriptOutput = outputData.data;
        }
      }

      if ("condition" in result) {
        condition = result.condition as boolean;
      }
    }

    const success = job.status === JobStatus.COMPLETED;

    return {
      success,
      status: job.status as JobStatus,
      output: execution?.output ?? log?.output ?? undefined,
      error: execution?.error ?? log?.error ?? job.lastError ?? undefined,
      scriptOutput,
      condition,
      exitCode: execution?.exitCode ?? log?.exitCode ?? undefined,
      duration,
      executionId: execution?.id,
    };
  } catch (error) {
    console.error(`Error getting job result for ${jobId}:`, error);
    return null;
  }
}
