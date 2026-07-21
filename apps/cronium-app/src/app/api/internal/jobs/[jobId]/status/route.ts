import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { JobStatus } from "@shared/schema";
import { verifyInternalKey } from "@/lib/internal-auth";

// Update job status (orchestrator progress reports)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    if (!verifyInternalKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;
    const body = (await request.json()) as {
      status: JobStatus;
      orchestratorId?: string;
      timestamp: string;
      details?: {
        message?: string;
        exitCode?: number;
        error?: string;
      };
    };

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    if (!body.status) {
      return NextResponse.json({ error: "Status required" }, { status: 400 });
    }

    // Ownership precondition (review D6): only the claimer may report on its
    // job. The header is set by the Go client on every request; body fallback
    // kept for hand-driven testing.
    const reporterId =
      request.headers.get("x-orchestrator-id") ?? body.orchestratorId;
    const job = await jobService.getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.orchestratorId && reporterId && job.orchestratorId !== reporterId) {
      return NextResponse.json(
        { error: `Job is owned by ${job.orchestratorId}` },
        { status: 409 },
      );
    }
    const actor = `orchestrator:${reporterId ?? "unknown"}`;

    let updatedJob;
    switch (body.status) {
      case JobStatus.RUNNING:
        updatedJob = await jobService.updateJobStatus(
          jobId,
          JobStatus.RUNNING,
          { startedAt: new Date() },
          actor,
        );
        break;
      case JobStatus.COMPLETED: {
        const updateData: Parameters<typeof jobService.updateJobStatus>[2] = {
          completedAt: new Date(),
          exitCode: body.details?.exitCode ?? 0,
        };

        if (body.details?.message !== undefined) {
          updateData.output = body.details.message;
        }

        updatedJob = await jobService.updateJobStatus(
          jobId,
          JobStatus.COMPLETED,
          updateData,
          actor,
        );
        break;
      }
      case JobStatus.FAILED:
        updatedJob = await jobService.updateJobStatus(
          jobId,
          JobStatus.FAILED,
          {
            completedAt: new Date(),
            error:
              body.details?.error ?? body.details?.message ?? "Unknown error",
            exitCode: body.details?.exitCode ?? 1,
          },
          actor,
        );
        break;
      case JobStatus.TIMED_OUT:
        updatedJob = await jobService.updateJobStatus(
          jobId,
          JobStatus.TIMED_OUT,
          {
            completedAt: new Date(),
            error: body.details?.error ?? "Job execution timed out",
            exitCode: body.details?.exitCode ?? -1,
          },
          actor,
        );
        break;
      case JobStatus.CANCELLED:
        updatedJob = await jobService.updateJobStatus(
          jobId,
          JobStatus.CANCELLED,
          {
            completedAt: new Date(),
            error: body.details?.error ?? "Job cancelled",
          },
          actor,
        );
        break;
      default:
        return NextResponse.json(
          { error: "Invalid status transition" },
          { status: 400 },
        );
    }

    if (!updatedJob) {
      // CAS rejection: the job is already terminal (late/duplicate report).
      // Idempotent success when the terminal state matches; conflict otherwise.
      const current = await jobService.getJob(jobId);
      if (current?.status === body.status) {
        return NextResponse.json({ success: true, job: current, noop: true });
      }
      return NextResponse.json(
        {
          error: `Status update to ${body.status} rejected (current: ${current?.status ?? "unknown"})`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, job: updatedJob });
  } catch (error) {
    console.error("Error updating job status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
