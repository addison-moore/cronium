import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { enhancedTransformJobsForOrchestrator } from "@/lib/services/enhanced-job-transformer";
import { verifyInternalKey } from "@/lib/internal-auth";
import { mintJobCapability } from "@/lib/security/job-capability";

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

    // Mint a per-job capability token (HI-10) scoped to the job, its owner, and
    // its target server. The orchestrator carries it and presents it on this
    // job's status/complete/fail/logs and execution create/update calls instead
    // of the shared internal key. The transform is 1:1 and order-preserving, so
    // job[i] pairs with transformedJobs[i].
    //
    // The token lifetime tracks the job's OWN timeout (not the lease, which is
    // short and renewed by heartbeat) plus a reporting buffer, so the token
    // covers the whole run through the final completion report. The capability
    // module clamps this to its absolute ceiling.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const REPORTING_BUFFER_SECONDS = 5 * 60;
    transformedJobs.forEach((tj, i) => {
      const source = jobs[i];
      if (!source) return;
      const timeoutSeconds = Math.ceil(tj.execution.timeout / 1e9);
      tj.capabilityToken = mintJobCapability(
        {
          jobId: tj.id,
          userId: source.userId ?? "",
          serverId: tj.execution.target.serverId,
          ttlSeconds: timeoutSeconds + REPORTING_BUFFER_SECONDS,
        },
        nowSeconds,
      );
    });

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
