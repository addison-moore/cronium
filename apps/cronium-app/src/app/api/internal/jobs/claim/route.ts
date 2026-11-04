import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { prepareJobsForOrchestrator } from "@/lib/services/enhanced-job-transformer";
import { JobStatus } from "@/shared/schema";
import { verifyOrchestratorKey } from "@/lib/internal-auth";
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
    if (!verifyOrchestratorKey(request)) {
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
    const { ready, failed } = await prepareJobsForOrchestrator(jobs);

    // Fail what could not be prepared now, with the reason, instead of letting
    // it wait out a lease. The message stays generic: decryption and driver
    // errors go to the server log, not to the job record the user reads.
    for (const { job, error } of failed) {
      console.error(
        `Could not prepare job ${job.id} for the orchestrator:`,
        error instanceof Error ? error.message : String(error),
      );
      await jobService.updateJobStatus(
        job.id,
        JobStatus.FAILED,
        {
          completedAt: new Date(),
          error:
            "Could not prepare this job to run. An environment variable or server credential may no longer be decryptable; re-enter it and run again.",
          exitCode: 1,
        },
        `orchestrator:${body.orchestratorId}`,
      );
    }

    // Mint a per-job capability token (HI-10) scoped to the job, its owner, and
    // its target server. The orchestrator carries it and presents it on this
    // job's status/complete/fail/logs and execution create/update calls instead
    // of the shared internal key.
    //
    // The token lifetime tracks the job's OWN timeout (not the lease, which is
    // short and renewed by heartbeat) plus a reporting buffer, so the token
    // covers the whole run through the final completion report. The capability
    // module clamps this to its absolute ceiling.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const REPORTING_BUFFER_SECONDS = 5 * 60;
    const transformedJobs = ready.map(({ job, transformed }) => {
      const timeoutSeconds = Math.ceil(transformed.execution.timeout / 1e9);
      transformed.capabilityToken = mintJobCapability(
        {
          jobId: transformed.id,
          userId: job.userId ?? "",
          serverId: transformed.execution.target.serverId,
          ttlSeconds: timeoutSeconds + REPORTING_BUFFER_SECONDS,
        },
        nowSeconds,
      );
      return transformed;
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
