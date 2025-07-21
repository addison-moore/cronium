import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { JobStatus } from "@shared/schema";

// Release a job back to the queue
export async function POST(
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
      message?: string;
    };

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    // Update job to release it back to the queue
    const updatedJob = await jobService.updateJob(jobId, {
      status: JobStatus.QUEUED,
      orchestratorId: undefined, // Clear the orchestrator ID
      startedAt: undefined, // Clear the start time
      lastError:
        body.message ?? "Released back to queue after orchestrator restart",
    });

    if (!updatedJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, job: updatedJob });
  } catch (error) {
    console.error("Error releasing job:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
