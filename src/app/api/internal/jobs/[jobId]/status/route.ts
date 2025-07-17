import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { JobStatus } from "@shared/schema";

// Update job status
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;
    const body = (await request.json()) as {
      status: JobStatus;
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

    // Update job status based on the provided status
    let updatedJob;
    switch (body.status) {
      case JobStatus.RUNNING:
        updatedJob = await jobService.startJob(jobId);
        break;
      case JobStatus.COMPLETED:
        updatedJob = await jobService.completeJob(jobId, {
          ...(body.details?.exitCode !== undefined && {
            exitCode: body.details.exitCode,
          }),
          ...(body.details?.message !== undefined && {
            output: body.details.message,
          }),
        });
        break;
      case JobStatus.FAILED:
        updatedJob = await jobService.failJob(
          jobId,
          body.details?.error ?? body.details?.message ?? "Unknown error",
        );
        break;
      default:
        return NextResponse.json(
          { error: "Invalid status transition" },
          { status: 400 },
        );
    }

    if (!updatedJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
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
