import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { JobStatus, jobs } from "@shared/schema";
import { db } from "@/server/db";
import { eq } from "drizzle-orm";
import { unifiedIoDebug } from "@/lib/unified-io/debug";
import { verifyInternalKey } from "@/lib/internal-auth";

/**
 * Final completion report from an executor. Idempotent: a repeated report for
 * a job already in the same terminal state returns success; a conflicting
 * late report is rejected by the CAS state machine (409). Timeout and
 * cancellation are real statuses now (TIMED_OUT / CANCELLED), not exit-code
 * folklore (review H8).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    if (!verifyInternalKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;
    const body = (await request.json()) as {
      status?: string;
      orchestratorId?: string;
      output?: string | { stdout: string; stderr: string };
      exitCode?: number;
      metrics?: Record<string, unknown>;
      scriptOutput?: unknown; // Data from cronium.output()
      condition?: boolean; // Condition from cronium.setCondition()
      // Structured execution stats (PLAN.md §5): honest reporting of what was
      // dropped/truncated instead of silence.
      droppedLogLines?: number;
      outputTruncatedBytes?: number;
      serverResults?: Array<Record<string, unknown>>;
      timestamp: string;
    };

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    // Ownership precondition (review D6)
    const reporterId =
      request.headers.get("x-orchestrator-id") ?? body.orchestratorId;
    const existingJob = await jobService.getJob(jobId);
    if (!existingJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (
      existingJob.orchestratorId &&
      reporterId &&
      existingJob.orchestratorId !== reporterId
    ) {
      return NextResponse.json(
        { error: `Job is owned by ${existingJob.orchestratorId}` },
        { status: 409 },
      );
    }

    const exitCode = body.exitCode ?? 0;

    // Map the reported status; exit codes are a fallback only.
    let jobStatus: JobStatus;
    switch (body.status?.toLowerCase()) {
      case "completed":
        jobStatus = JobStatus.COMPLETED;
        break;
      case "failed":
        jobStatus = JobStatus.FAILED;
        break;
      case "timeout":
      case "timed_out":
        jobStatus = JobStatus.TIMED_OUT;
        break;
      case "cancelled":
        jobStatus = JobStatus.CANCELLED;
        break;
      default:
        jobStatus =
          exitCode === -1
            ? JobStatus.TIMED_OUT
            : exitCode === -2
              ? JobStatus.CANCELLED
              : exitCode === 0
                ? JobStatus.COMPLETED
                : JobStatus.FAILED;
    }

    // Handle both formats: string or {stdout, stderr}
    let output: string | undefined;
    let error: string | undefined;
    if (body.output) {
      if (typeof body.output === "string") {
        output = body.output;
      } else {
        output = body.output.stdout;
        if (body.output.stderr) {
          if (jobStatus === JobStatus.COMPLETED) {
            output += "\n--- STDERR ---\n" + body.output.stderr;
          } else {
            error = body.output.stderr;
          }
        }
      }
    }
    if (jobStatus === JobStatus.TIMED_OUT) {
      error = error
        ? `Job execution timed out\n${error}`
        : "Job execution timed out";
    } else if (jobStatus === JobStatus.CANCELLED && !error) {
      error = "Job cancelled";
    }

    const updateData: Parameters<typeof jobService.updateJobStatus>[2] = {
      completedAt: new Date(),
      exitCode: exitCode,
    };

    if (output !== undefined) {
      updateData.output = output;
    }

    if (error !== undefined) {
      updateData.error = error;
    }

    if (body.metrics !== undefined) {
      updateData.metrics = body.metrics;
    }

    // Resolve the structured output for workflow chaining. Container scripts
    // publish data via cronium.output() → the runtime /output route, which stores
    // it on job.result.output BEFORE this completion runs. The orchestrator's
    // completion body does not echo it, so read the already-stored output here
    // and promote it to scriptOutput (the one field workflow chaining reads).
    // An explicit body.scriptOutput wins. Since updateJobStatus MERGES the
    // result jsonb, a concurrent /output write cannot be lost either way.
    let scriptOutput: unknown = body.scriptOutput;
    if (scriptOutput === undefined) {
      const [existing] = await db
        .select({ result: jobs.result })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);
      const existingResult = existing?.result as Record<string, unknown> | null;
      if (
        existingResult &&
        "output" in existingResult &&
        existingResult.output !== undefined
      ) {
        scriptOutput = existingResult.output;
      }
      unifiedIoDebug(
        `complete job ${jobId}: existing result keys=${existingResult ? Object.keys(existingResult).join(",") : "none"}; promoted scriptOutput=${JSON.stringify(scriptOutput) ?? "undefined"}`,
      );
    }

    // Structured result fields (merged into jobs.result)
    const result: Record<string, unknown> = { exitCode };
    if (scriptOutput !== undefined) {
      result.scriptOutput = scriptOutput;
    }
    if (body.condition !== undefined) {
      result.condition = body.condition;
    }
    if (body.metrics !== undefined) {
      result.metrics = body.metrics;
    }
    if (body.droppedLogLines !== undefined && body.droppedLogLines > 0) {
      result.droppedLogLines = body.droppedLogLines;
    }
    if (
      body.outputTruncatedBytes !== undefined &&
      body.outputTruncatedBytes > 0
    ) {
      result.outputTruncatedBytes = body.outputTruncatedBytes;
    }
    if (body.serverResults !== undefined) {
      result.serverResults = body.serverResults;
    }
    updateData.result = result;

    const updatedJob = await jobService.updateJobStatus(
      jobId,
      jobStatus,
      updateData,
      `orchestrator:${reporterId ?? "unknown"}`,
    );

    if (!updatedJob) {
      // CAS rejection — idempotent when the terminal state already matches.
      const current = await jobService.getJob(jobId);
      if (current?.status === jobStatus) {
        return NextResponse.json({ success: true, job: current, noop: true });
      }
      return NextResponse.json(
        {
          error: `Completion to ${jobStatus} rejected (current: ${current?.status ?? "unknown"})`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, job: updatedJob });
  } catch (error) {
    console.error("Error completing job:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
