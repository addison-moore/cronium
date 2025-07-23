import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
// import { jobService } from "@/lib/services/job-service";

// Orchestrator heartbeat
export async function POST(request: NextRequest) {
  try {
    // Verify internal API token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token || token !== process.env.INTERNAL_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      orchestratorId: string;
      timestamp: string;
      runningJobs?: string[];
      capacity?: {
        maxJobs: number;
        currentJobs: number;
        availableSlots: number;
      };
    };

    if (!body.orchestratorId) {
      return NextResponse.json(
        { error: "Orchestrator ID required" },
        { status: 400 },
      );
    }

    // Update job heartbeats for running jobs
    if (body.runningJobs && body.runningJobs.length > 0) {
      // TODO: Implement heartbeat update for jobs
      // This would update a last_heartbeat timestamp on running jobs
      // to detect stalled jobs
      for (const _jobId of body.runningJobs) {
        // await jobService.updateHeartbeat(_jobId);
      }
    }

    // TODO: Store orchestrator last seen timestamp
    // This helps detect offline orchestrators

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error processing heartbeat:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
