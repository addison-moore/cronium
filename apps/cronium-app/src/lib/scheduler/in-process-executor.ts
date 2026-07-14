/**
 * In-process execution for job types the Go orchestrator cannot run.
 *
 * The orchestrator only has `container` and `ssh` executors (chosen by target),
 * so a TOOL_ACTION job — which has no script — was dispatched as a container job
 * and rejected with "container job missing script configuration". Tool actions
 * are plain outbound HTTPS/SMTP calls with no need for a container, and the app
 * already has a hardened engine for them (`executeToolAction`: SSRF guard,
 * single-attempt retry, circuit breaker, secret redaction).
 *
 * So we keep the `jobs`/`logs` records (the UI, conditional-action hooks, and
 * workflow polling all key off them) but execute the job here, in-process, and
 * report the outcome through `jobService.updateJobStatus` — the exact completion
 * path the orchestrator's callback uses (log finalize + broadcast + hooks).
 */
import { type Event, type Job, JobStatus, JobType } from "@/shared/schema";
import { jobService } from "@/lib/services/job-service";
import { executeToolAction } from "@/lib/scheduler/tool-action-executor";
import { executeHttpEvent } from "@/lib/scheduler/http-event-executor";

/**
 * Job types executed in the app process rather than dispatched to the
 * orchestrator (which only runs container/ssh scripts). Both tool actions and
 * HTTP requests are scriptless outbound calls with a working in-process engine.
 */
export function isInProcessJobType(type: JobType): boolean {
  return type === JobType.TOOL_ACTION || type === JobType.HTTP_REQUEST;
}

/**
 * Run a tool-action job in-process and finalize it via the normal job lifecycle.
 * Never throws and always finalizes the job (COMPLETED/FAILED) so it can't be
 * left QUEUED — the orchestrator will never claim it (see jobService.claimJobs).
 */
export async function runInProcessJob(
  job: Job,
  event: Event,
  input: Record<string, unknown> = {},
): Promise<void> {
  const startedAt = Date.now();
  try {
    await jobService.updateJobStatus(job.id, JobStatus.RUNNING, {
      startedAt: new Date(),
    });

    const result =
      job.type === JobType.HTTP_REQUEST
        ? await executeHttpEvent(event, input)
        : await executeToolAction(event, input);
    const executionDuration = Date.now() - startedAt;
    const succeeded = result.exitCode === 0;

    await jobService.updateJobStatus(
      job.id,
      succeeded ? JobStatus.COMPLETED : JobStatus.FAILED,
      {
        output: succeeded ? result.stdout : result.stderr,
        exitCode: result.exitCode,
        executionDuration,
        result: { exitCode: result.exitCode },
        ...(succeeded ? {} : { error: result.stderr || "Tool action failed" }),
      },
    );
  } catch (err) {
    // executeToolAction is designed not to throw, but stay defensive: a failure
    // here must still finalize the job, never leave it stuck QUEUED/RUNNING.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[InProcess] Job ${job.id} failed to execute:`, message);
    try {
      await jobService.updateJobStatus(job.id, JobStatus.FAILED, {
        output: message,
        error: message,
        exitCode: 1,
        executionDuration: Date.now() - startedAt,
      });
    } catch (finalizeErr) {
      console.error(
        `[InProcess] Could not finalize failed job ${job.id}:`,
        finalizeErr,
      );
    }
  }
}
