import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { JobStatus } from "@shared/schema";
import { transitionJob } from "@/lib/scheduling/job-transition";

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

    // Release through the state machine: only CLAIMED (not-yet-started) jobs
    // may go back to the queue. Releasing a running/terminal job re-executed
    // it under the old blind update (review D3).
    const outcome = await transitionJob(jobId, JobStatus.QUEUED, {
      actor: "orchestrator:release",
      reason:
        body.message ?? "Released back to queue after orchestrator restart",
      expectedFrom: [JobStatus.CLAIMED],
      set: {
        orchestratorId: null,
        startedAt: null,
        leaseExpiresAt: null,
        lastError:
          body.message ?? "Released back to queue after orchestrator restart",
      },
    });

    if (!outcome.ok) {
      const notFound = outcome.error.includes("not found");
      return NextResponse.json(
        { error: outcome.error },
        { status: notFound ? 404 : 409 },
      );
    }

    return NextResponse.json({ success: true, job: outcome.job });
  } catch (error) {
    console.error("Error releasing job:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
