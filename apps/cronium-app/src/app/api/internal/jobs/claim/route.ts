import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobService } from "@/lib/services/job-service";
import { prepareJobsForOrchestrator } from "@/lib/services/enhanced-job-transformer";
import type { OrchestratorJob } from "@/lib/services/job-transformer";
import { JobStatus, type Job } from "@/shared/schema";
import { verifyOrchestratorKey } from "@/lib/internal-auth";
import { mintJobCapability } from "@/lib/security/job-capability";
import { describeFailure, failureWithStack } from "@/lib/pg-errors";

/**
 * Fail a claimed job that can't be delivered, now and with the reason, instead of
 * letting it wait out a lease. The message stays generic: decryption and driver
 * errors go to the server log, not to the job record the user reads.
 *
 * Never rejects, because by this point the whole batch is CLAIMED. A 500 would
 * deliver none of it: jobs that could have run would sit until their leases expire
 * and the sweeper failed them or spent one of their retries, and the orchestrator
 * would answer the 500 by claiming another batch. If what can't be written is this
 * job's own status, it stays CLAIMED and the sweeper deals with it at lease expiry,
 * as it does with any job whose owner went away.
 */
async function failUndeliverableJob(
  job: Job,
  error: unknown,
  orchestratorId: string,
): Promise<void> {
  console.error(
    `Could not prepare job ${job.id} for the orchestrator:`,
    describeFailure(error),
  );
  try {
    await jobService.updateJobStatus(
      job.id,
      JobStatus.FAILED,
      {
        completedAt: new Date(),
        error:
          "Could not prepare this job to run. An environment variable or server credential may no longer be decryptable; re-enter it and run again.",
        exitCode: 1,
      },
      `orchestrator:${orchestratorId}`,
    );
  } catch (failure) {
    console.error(
      `Could not finish failing job ${job.id}; if its status did not change, the sweeper handles it when its lease expires:`,
      describeFailure(failure),
    );
  }
}

/**
 * Orchestrator claim endpoint (PLAN.md §4.2): a POST that atomically claims a
 * batch of due SCRIPT jobs under a lease (FOR UPDATE SKIP LOCKED in
 * jobService.claimJobs). Replaces the old mutating GET /api/internal/jobs/queue
 * and the acknowledge step — a claim IS the acknowledgment; a lost claimer is
 * recovered by lease expiry, not by orphan queries.
 *
 * Once the claim commits this always answers 200, with the jobs it could deliver.
 * A 500 means the claim itself failed, so there is nothing stranded for a retry to
 * leave behind.
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

    const { orchestratorId } = body;
    if (!orchestratorId) {
      return NextResponse.json(
        { error: "orchestratorId required" },
        { status: 400 },
      );
    }

    const batchSize = Math.min(Math.max(body.batchSize ?? 10, 1), 50);
    const leaseMs = body.leaseSeconds
      ? Math.min(Math.max(body.leaseSeconds, 15), 600) * 1000
      : undefined;

    const jobs = await jobService.claimJobs(orchestratorId, batchSize, leaseMs);
    const { ready, failed } = await prepareJobsForOrchestrator(jobs);

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
    const transformedJobs: OrchestratorJob[] = [];
    const undeliverable = [...failed];
    for (const { job, transformed } of ready) {
      const timeoutSeconds = Math.ceil(transformed.execution.timeout / 1e9);
      try {
        transformed.capabilityToken = mintJobCapability(
          {
            jobId: transformed.id,
            userId: job.userId ?? "",
            serverId: transformed.execution.target.serverId,
            ttlSeconds: timeoutSeconds + REPORTING_BUFFER_SECONDS,
          },
          nowSeconds,
        );
        transformedJobs.push(transformed);
      } catch (error) {
        undeliverable.push({ job, error });
      }
    }

    // Side by side, so the jobs about to be delivered don't wait on each failure in
    // turn. A failure can take seconds when the socket server is down, and their
    // leases are already running.
    await Promise.all(
      undeliverable.map(({ job, error }) =>
        failUndeliverableJob(job, error, orchestratorId),
      ),
    );

    return NextResponse.json({
      jobs: transformedJobs,
      count: transformedJobs.length,
    });
  } catch (error) {
    console.error("Error claiming jobs:", failureWithStack(error));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
