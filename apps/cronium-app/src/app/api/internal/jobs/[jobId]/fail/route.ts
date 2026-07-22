import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { JobStatus } from "@shared/schema";
import {
  authorizeCapability,
  assertJobScope,
} from "@/lib/security/internal-route-auth";

// Mark job as failed
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;

    const auth = authorizeCapability(request, "job:fail");
    if (!auth.ok) return auth.response;
    const scopeError = assertJobScope(auth.cap, jobId);
    if (scopeError) return scopeError;

    const body = (await request.json()) as {
      error: string;
      orchestratorId?: string;
      exitCode?: number;
      timestamp: string;
    };

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    if (!body.error) {
      return NextResponse.json(
        { error: "Error message required" },
        { status: 400 },
      );
    }

    // Ownership precondition (review D6)
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

    const updatedJob = await jobService.updateJobStatus(
      jobId,
      JobStatus.FAILED,
      {
        completedAt: new Date(),
        error: body.error,
        exitCode: body.exitCode ?? 1,
      },
      `orchestrator:${reporterId ?? "unknown"}`,
    );

    if (!updatedJob) {
      const current = await jobService.getJob(jobId);
      if (current?.status === JobStatus.FAILED) {
        return NextResponse.json({ success: true, job: current, noop: true });
      }
      return NextResponse.json(
        {
          error: `Fail report rejected (current: ${current?.status ?? "unknown"})`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, job: updatedJob });
  } catch (error) {
    console.error("Error failing job:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
