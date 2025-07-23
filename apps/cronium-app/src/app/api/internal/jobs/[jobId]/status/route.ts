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

    // Update job status and log status using the new method
    let updatedJob;
    switch (body.status) {
      case JobStatus.RUNNING:
        updatedJob = await jobService.updateJobStatus(
          jobId,
          JobStatus.RUNNING,
          {
            startedAt: new Date(),
          },
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
        );
        break;
      }
      case JobStatus.FAILED:
        updatedJob = await jobService.updateJobStatus(jobId, JobStatus.FAILED, {
          completedAt: new Date(),
          error:
            body.details?.error ?? body.details?.message ?? "Unknown error",
          exitCode: body.details?.exitCode ?? 1,
        });
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
