/**
 * Concurrent job claiming against real Postgres. jobService.claimJobs uses
 * `SELECT … FOR UPDATE SKIP LOCKED` in a transaction; the guarantee we assert is
 * that two orchestrators racing for the same queue never double-claim a job.
 * That property only holds at the SQL level, so it can only be tested against a
 * real database — the whole reason this suite exists.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { jobService, DEFAULT_CLAIM_LEASE_MS } from "@/lib/services/job-service";
import { jobs, JobStatus } from "@/shared/schema";
import { resetDatabase, closePool } from "./helpers/db-reset";
import { seedUser, seedEvent, seedJob } from "./helpers/seed";

async function seedQueuedScriptJobs(count: number): Promise<string[]> {
  const userId = await seedUser();
  const eventId = await seedEvent(userId);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(
      await seedJob(eventId, userId, {
        status: JobStatus.QUEUED,
        scheduledFor: new Date(Date.now() - 1000),
      }),
    );
  }
  return ids;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe("claimJobs — concurrent disjoint claiming", () => {
  it("two orchestrators racing for N jobs claim disjoint sets, each job once", async () => {
    const N = 20;
    await seedQueuedScriptJobs(N);

    // Fire both claimants concurrently, each asking for the whole batch.
    const [a, b] = await Promise.all([
      jobService.claimJobs("orch-A", N),
      jobService.claimJobs("orch-B", N),
    ]);

    const aIds = new Set(a.map((j) => j.id));
    const bIds = new Set(b.map((j) => j.id));

    // Disjoint: no job appears in both claim sets.
    for (const id of aIds) expect(bIds.has(id)).toBe(false);

    // Every job claimed exactly once, total == N.
    expect(a.length + b.length).toBe(N);

    // Ownership + lease columns stamped for each claimant.
    for (const job of a) {
      expect(job.orchestratorId).toBe("orch-A");
      expect(job.status).toBe(JobStatus.CLAIMED);
      expect(job.leaseExpiresAt).toBeInstanceOf(Date);
    }
    for (const job of b) {
      expect(job.orchestratorId).toBe("orch-B");
    }

    // Nothing left QUEUED, nothing double-owned in the DB.
    const remaining = await db
      .select()
      .from(jobs)
      .where(eq(jobs.status, JobStatus.QUEUED));
    expect(remaining.length).toBe(0);
  });

  it("holds across several rounds (no residual double-claims)", async () => {
    for (let round = 0; round < 4; round++) {
      await resetDatabase();
      const N = 12;
      await seedQueuedScriptJobs(N);
      const [a, b] = await Promise.all([
        jobService.claimJobs("orch-A", N),
        jobService.claimJobs("orch-B", N),
      ]);
      const all = [...a, ...b].map((j) => j.id);
      expect(new Set(all).size).toBe(N); // no id claimed twice
      expect(all.length).toBe(N);
    }
  });

  it("never claims TOOL_ACTION / HTTP_REQUEST jobs (orchestrator scope)", async () => {
    const userId = await seedUser();
    const eventId = await seedEvent(userId);
    // scheduledFor a second in the past: claimJobs filters scheduledFor <= its
    // own Node-clock `now`, so relying on the DB-default timestamp is flaky
    // under container/host clock skew.
    const scheduledFor = new Date(Date.now() - 1000);
    await seedJob(eventId, userId, {
      type: "TOOL_ACTION" as never,
      status: JobStatus.QUEUED,
      scheduledFor,
    });
    await seedJob(eventId, userId, {
      type: "HTTP_REQUEST" as never,
      status: JobStatus.QUEUED,
      scheduledFor,
    });
    const scriptId = await seedJob(eventId, userId, {
      status: JobStatus.QUEUED,
      scheduledFor,
    });

    const claimed = await jobService.claimJobs("orch-A", 10);
    expect(claimed.map((j) => j.id)).toEqual([scriptId]);
  });
});

describe("heartbeatJobs — lease renewal is owner-scoped", () => {
  it("extends only the owner's leases, not another orchestrator's", async () => {
    const [j1, j2] = await seedQueuedScriptJobs(2);
    await jobService.claimJobs("orch-A", 2);

    // orch-B tries to heartbeat orch-A's jobs — must renew none.
    const bResult = await jobService.heartbeatJobs("orch-B", [j1!, j2!]);
    expect(bResult.extended).toEqual([]);

    // orch-A heartbeats its own — both extended.
    const before = await db
      .select({ id: jobs.id, lease: jobs.leaseExpiresAt })
      .from(jobs)
      .where(inArray(jobs.id, [j1!, j2!]));
    const aResult = await jobService.heartbeatJobs("orch-A", [j1!, j2!]);
    expect(new Set(aResult.extended)).toEqual(new Set([j1!, j2!]));

    const after = await db
      .select({ id: jobs.id, lease: jobs.leaseExpiresAt })
      .from(jobs)
      .where(inArray(jobs.id, [j1!, j2!]));
    for (const row of after) {
      const prev = before.find((b) => b.id === row.id)!;
      expect(row.lease!.getTime()).toBeGreaterThanOrEqual(
        prev.lease!.getTime(),
      );
    }
  });
});

describe("claimJobs — expired lease re-claim", () => {
  it("a job whose lease has expired can be claimed by another orchestrator", async () => {
    const [jobId] = await seedQueuedScriptJobs(1);

    // orch-A claims it, then we force its lease into the past (simulate a dead
    // owner that stopped heartbeating).
    await jobService.claimJobs("orch-A", 1);
    await db
      .update(jobs)
      .set({
        status: JobStatus.QUEUED,
        orchestratorId: null,
        leaseExpiresAt: new Date(Date.now() - DEFAULT_CLAIM_LEASE_MS - 1000),
      })
      .where(eq(jobs.id, jobId!));

    // It is claimable again — by a different orchestrator.
    const reclaimed = await jobService.claimJobs("orch-B", 1);
    expect(reclaimed.map((j) => j.id)).toEqual([jobId]);
    expect(reclaimed[0]!.orchestratorId).toBe("orch-B");
  });
});
