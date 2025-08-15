import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { executionService } from "@/lib/services/execution-service";
import { jobService } from "@/lib/services/job-service";
import { JobStatus } from "@/shared/schema";

// Update an execution
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> },
) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
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
      const { getWebSocketBroadcaster } = await import(
        "@/lib/websocket-broadcaster"
      );
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

        await jobService.updateJobStatus(
          execution.jobId,
          execution.status,
          jobUpdateData,
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
