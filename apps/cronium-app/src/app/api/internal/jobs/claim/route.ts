import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { enhancedTransformJobsForOrchestrator } from "@/lib/services/enhanced-job-transformer";
import { verifyInternalKey } from "@/lib/internal-auth";

/**
 * Orchestrator claim endpoint (PLAN.md §4.2): a POST that atomically claims a
 * batch of due SCRIPT jobs under a lease (FOR UPDATE SKIP LOCKED in
 * jobService.claimJobs). Replaces the old mutating GET /api/internal/jobs/queue
 * and the acknowledge step — a claim IS the acknowledgment; a lost claimer is
 * recovered by lease expiry, not by orphan queries.
 */
export async function POST(request: NextRequest) {
  try {
    if (!verifyInternalKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      orchestratorId?: string;
      batchSize?: number;
      leaseSeconds?: number;
    };

    if (!body.orchestratorId) {
      return NextResponse.json(
        { error: "orchestratorId required" },
        { status: 400 },
      );
    }

    const batchSize = Math.min(Math.max(body.batchSize ?? 10, 1), 50);
    const leaseMs = body.leaseSeconds
      ? Math.min(Math.max(body.leaseSeconds, 15), 600) * 1000
      : undefined;

    const jobs = await jobService.claimJobs(
      body.orchestratorId,
      batchSize,
      leaseMs,
    );
    const transformedJobs = await enhancedTransformJobsForOrchestrator(jobs);

    return NextResponse.json({
      jobs: transformedJobs,
      count: transformedJobs.length,
    });
  } catch (error) {
    console.error("Error claiming jobs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
