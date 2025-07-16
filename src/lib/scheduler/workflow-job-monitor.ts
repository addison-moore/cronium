import { jobService } from "@/lib/services/job-service";
import { JobStatus } from "@/shared/schema";
import type { Job } from "@/shared/schema";

export interface JobResult {
  success: boolean;
  output?: string;
  duration?: number;
  scriptOutput?: unknown;
  condition?: boolean;
}

/**
 * Monitor a job until it completes and return its result
 * This is used by the workflow executor to wait for job completion
 */
export async function waitForJobCompletion(
  jobId: string,
  options: {
    timeout?: number; // Maximum time to wait in milliseconds
    pollInterval?: number; // How often to check job status in milliseconds
  } = {},
): Promise<JobResult> {
  const { timeout = 300000, pollInterval = 1000 } = options; // Default 5 min timeout, 1s poll
  const startTime = Date.now();

  while (true) {
    // Check if we've exceeded the timeout
    if (Date.now() - startTime > timeout) {
      return {
        success: false,
        output: `Job ${jobId} timed out after ${timeout}ms`,
        duration: timeout,
      };
    }

    // Get current job status
    const job = await jobService.getJob(jobId);

    if (!job) {
      return {
        success: false,
        output: `Job ${jobId} not found`,
      };
    }

    // Check if job is complete
    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      return extractJobResult(job);
    }

    // Job is still running, wait before checking again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

/**
 * Extract execution result from a completed job
 */
export function extractJobResult(job: Job): JobResult {
  const duration =
    job.startedAt && job.completedAt
      ? job.completedAt.getTime() - job.startedAt.getTime()
      : undefined;

  if (job.status === JobStatus.COMPLETED && job.result) {
    const result = job.result as {
      output?: string;
      scriptOutput?: unknown;
      condition?: boolean;
    };

    return {
      success: true,
      output: result.output ?? `Job ${job.id} completed successfully`,
      duration,
      scriptOutput: result.scriptOutput,
      condition: result.condition,
    };
  }

  if (job.status === JobStatus.FAILED) {
    return {
      success: false,
      output:
        job.lastError ??
        (job.result as { error?: string } | null)?.error ??
        `Job ${job.id} failed`,
      duration,
    };
  }

  // Job is in an unexpected state
  return {
    success: false,
    output: `Job ${job.id} in unexpected state: ${job.status}`,
    duration,
  };
}

/**
 * Enhanced version of executeEvent that waits for job completion
 * This can be used by the workflow executor for synchronous execution
 */
export async function executeEventAndWait(
  executeEventFn: (eventId: number, ...args: unknown[]) => Promise<JobResult>,
  eventId: number,
  workflowExecutionId?: number,
  sequenceOrder?: number,
  inputData?: Record<string, unknown>,
  workflowId?: number,
): Promise<JobResult> {
  // Call the original executeEvent function
  const result = await executeEventFn(
    eventId,
    workflowExecutionId,
    sequenceOrder,
    inputData,
    workflowId,
  );

  // Extract job ID from the output message
  const jobIdMatch = result.output?.match(/Job (\S+) created/);
  if (!jobIdMatch) {
    return result; // Return as-is if we can't find job ID
  }

  const jobId = jobIdMatch[1];

  // Wait for the job to complete
  return waitForJobCompletion(jobId);
}
