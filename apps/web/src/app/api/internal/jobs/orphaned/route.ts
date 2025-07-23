import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { JobStatus } from "@shared/schema";

// Get orphaned jobs for a specific orchestrator
export async function GET(request: NextRequest) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const orchestratorId = searchParams.get("orchestratorId");

    if (!orchestratorId) {
      return NextResponse.json(
        { error: "orchestratorId parameter required" },
        { status: 400 },
      );
    }

    // Get jobs that were claimed or running by this orchestrator
    const orphanedJobs = await jobService.listJobs(
      {
        orchestratorId,
        status: [JobStatus.CLAIMED, JobStatus.RUNNING],
      },
      100, // Get up to 100 orphaned jobs
      0,
    );

    return NextResponse.json(orphanedJobs.jobs);
  } catch (error) {
    console.error("Error fetching orphaned jobs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
