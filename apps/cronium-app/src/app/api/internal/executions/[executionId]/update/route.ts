import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { executionService } from "@/lib/services/execution-service";
import { jobService } from "@/lib/services/job-service";
import { JobStatus } from "@/shared/schema";
import { unifiedIoDebug } from "@/lib/unified-io/debug";
import { mergeCompletionResult } from "@/lib/unified-io/merge-completion-result";
import { verifyInternalKey } from "@/lib/internal-auth";

// Update an execution
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> },
) {
  try {
    // Timing-safe internal-key check (HI-10)
    if (!verifyInternalKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { executionId } = await params;
    const body = (await request.json()) as {
      status?: JobStatus;
      startedAt?: string;
      completedAt?: string;
      exitCode?: number;
      output?: string;
      error?: string;
      metadata?: Record<string, unknown>;
      // Phase-based timing fields
      setupStartedAt?: string;
      setupCompletedAt?: string;
      executionStartedAt?: string;
      executionCompletedAt?: string;
      cleanupStartedAt?: string;
      cleanupCompletedAt?: string;
      setupDuration?: number;
      executionDuration?: number;
      cleanupDuration?: number;
      totalDuration?: number;
      executionMetadata?: Record<string, unknown>;
    };

    // Convert date strings to Date objects
    const updateData: Parameters<typeof executionService.updateExecution>[1] =
      {};

    if (body.status !== undefined) updateData.status = body.status;
    if (body.startedAt !== undefined)
      updateData.startedAt = new Date(body.startedAt);
    if (body.completedAt !== undefined)
      updateData.completedAt = new Date(body.completedAt);
    if (body.exitCode !== undefined) updateData.exitCode = body.exitCode;
    if (body.output !== undefined) updateData.output = body.output;
    if (body.error !== undefined) updateData.error = body.error;
    if (body.metadata !== undefined) updateData.metadata = body.metadata;

    // Phase-based timing fields
    if (body.setupStartedAt !== undefined)
      updateData.setupStartedAt = new Date(body.setupStartedAt);
    if (body.setupCompletedAt !== undefined)
      updateData.setupCompletedAt = new Date(body.setupCompletedAt);
    if (body.executionStartedAt !== undefined)
      updateData.executionStartedAt = new Date(body.executionStartedAt);
    if (body.executionCompletedAt !== undefined)
      updateData.executionCompletedAt = new Date(body.executionCompletedAt);
    if (body.cleanupStartedAt !== undefined)
      updateData.cleanupStartedAt = new Date(body.cleanupStartedAt);
    if (body.cleanupCompletedAt !== undefined)
      updateData.cleanupCompletedAt = new Date(body.cleanupCompletedAt);
    if (body.setupDuration !== undefined)
      updateData.setupDuration = body.setupDuration;
    if (body.executionDuration !== undefined)
      updateData.executionDuration = body.executionDuration;
    if (body.cleanupDuration !== undefined)
      updateData.cleanupDuration = body.cleanupDuration;
    if (body.totalDuration !== undefined)
      updateData.totalDuration = body.totalDuration;
    if (body.executionMetadata !== undefined)
      updateData.executionMetadata = body.executionMetadata;

    // Update the execution
    const execution = await executionService.updateExecution(
      executionId,
      updateData,
    );

    if (!execution) {
      return NextResponse.json(
        { error: "Execution not found" },
        { status: 404 },
      );
    }

    // Broadcast execution update via WebSocket
    try {
      const { getWebSocketBroadcaster } =
        await import("@/lib/websocket-broadcaster");
      const broadcaster = getWebSocketBroadcaster();

      const broadcastData: Parameters<
        typeof broadcaster.broadcastExecutionUpdate
      >[2] = {};
      if (execution.output) broadcastData.output = execution.output;
      if (execution.error) broadcastData.error = execution.error;
      if (execution.exitCode !== null)
        broadcastData.exitCode = execution.exitCode;
      if (execution.startedAt) broadcastData.startedAt = execution.startedAt;
      if (execution.completedAt)
        broadcastData.completedAt = execution.completedAt;

      await broadcaster.broadcastExecutionUpdate(
        executionId,
        execution.status,
        broadcastData,
      );
    } catch (error) {
      console.error("[Execution API] Error broadcasting update:", error);
    }

    // If execution is completing, also update the associated job's log
    if (
      execution.jobId &&
      (body.completedAt ||
        body.status === JobStatus.COMPLETED ||
        body.status === JobStatus.FAILED)
    ) {
      // Get the job to find the log ID
      const job = await jobService.getJob(execution.jobId);
      if (job) {
        // Update job status to sync with execution (this will also update the log)
        const jobUpdateData: Parameters<typeof jobService.updateJobStatus>[2] =
          {};

        if (execution.output) jobUpdateData.output = execution.output;
        if (execution.error) jobUpdateData.error = execution.error;
        if (execution.exitCode !== null)
          jobUpdateData.exitCode = execution.exitCode;
        if (execution.completedAt)
          jobUpdateData.completedAt = execution.completedAt;

        // Carry what the runtime wrote to job.result forward (cronium.output()
        // and cronium.setCondition()) and promote output -> scriptOutput.
        // updateJobStatus replaces `result`, so without this it is lost. This is
        // the real completion path for container/ssh jobs (the orchestrator
        // finalizes via UpdateExecution, not /jobs/*/complete).
        const existingResult =
          (job.result as Record<string, unknown> | null) ?? {};
        const mergedResult = mergeCompletionResult(
          existingResult,
          execution.exitCode,
        );
        if (mergedResult) {
          jobUpdateData.result = mergedResult;
        }
        unifiedIoDebug(
          `execution ${executionId} completing job ${execution.jobId}: result keys=${Object.keys(existingResult).join(",") || "none"}; scriptOutput promoted=${mergedResult && "scriptOutput" in mergedResult ? "yes" : "no"}; condition=${JSON.stringify(mergedResult?.condition ?? "none")}`,
        );

        // Pass timing information to job update
        if (
          execution.executionDuration !== null &&
          execution.executionDuration !== undefined
        )
          jobUpdateData.executionDuration = execution.executionDuration;
        if (
          execution.setupDuration !== null &&
          execution.setupDuration !== undefined
        )
          jobUpdateData.setupDuration = execution.setupDuration;

        // Derive the job status with the same semantics as the /complete
        // route (exit -2 = cancelled, -1 = timed out): this sync races the
        // orchestrator's completion report, and under the CAS state machine
        // both writers must agree on the terminal status or one gets a
        // spurious 409 (observed live: a cancelled job landed FAILED here
        // first and the real `cancelled` completion was rejected).
        let syncStatus = execution.status;
        if (execution.exitCode === -2) {
          syncStatus = JobStatus.CANCELLED;
        } else if (execution.exitCode === -1) {
          syncStatus = JobStatus.TIMED_OUT;
        } else if (execution.status === JobStatus.FAILED) {
          syncStatus = JobStatus.FAILED;
        } else if (execution.exitCode === 0) {
          syncStatus = JobStatus.COMPLETED;
        }

        await jobService.updateJobStatus(
          execution.jobId,
          syncStatus,
          jobUpdateData,
          "execution-sync",
        );
      }
    }

    return NextResponse.json({ success: true, execution });
  } catch (error) {
    console.error("Error updating execution:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
