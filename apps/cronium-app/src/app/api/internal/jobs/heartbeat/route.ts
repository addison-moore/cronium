import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { verifyInternalKey } from "@/lib/internal-auth";

/**
 * Owner heartbeat (PLAN.md §4.2): renews leases for the orchestrator's
 * in-flight jobs and returns which of them have cancellation requested. This
 * is both the liveness signal (a lease that stops renewing hands the job to
 * the sweeper) and the cancellation channel (UI cancel reaches the running
 * container on the next beat).
 */
export async function POST(request: NextRequest) {
  try {
    if (!verifyInternalKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      orchestratorId?: string;
      jobIds?: string[];
      leaseSeconds?: number;
    };

    if (!body.orchestratorId) {
      return NextResponse.json(
        { error: "orchestratorId required" },
        { status: 400 },
      );
    }
    const jobIds = Array.isArray(body.jobIds) ? body.jobIds.slice(0, 200) : [];
    const leaseMs = body.leaseSeconds
      ? Math.min(Math.max(body.leaseSeconds, 15), 600) * 1000
      : undefined;

    const result = await jobService.heartbeatJobs(
      body.orchestratorId,
      jobIds,
      leaseMs,
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error processing job heartbeat:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
