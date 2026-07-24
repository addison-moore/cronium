/**
 * Compare-and-swap job transitions against real SQL. transitionJob() is a
 * transactional CAS (SELECT … FOR UPDATE, legal-edge check, audit row, notify).
 * The properties that matter — illegal edges rejected, terminal states
 * absorbing, and exactly one winner when two transitions race — are enforced by
 * the row lock + the DB, so they are only meaningful against real Postgres.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { transitionJob } from "@/lib/scheduling/job-transition";
import { jobs, jobTransitions, JobStatus } from "@/shared/schema";
import { resetDatabase, closePool } from "./helpers/db-reset";
import { seedUser, seedEvent, seedJob } from "./helpers/seed";

async function freshJob(status: JobStatus = JobStatus.QUEUED): Promise<string> {
  const userId = await seedUser();
  const eventId = await seedEvent(userId);
  return seedJob(eventId, userId, { status });
}

async function statusOf(jobId: string): Promise<JobStatus> {
  const [row] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  return row!.status;
}

async function transitionCount(jobId: string): Promise<number> {
  const rows = await db
    .select()
    .from(jobTransitions)
    .where(eq(jobTransitions.jobId, jobId));
  return rows.length;
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe("transitionJob — legal edges", () => {
  it("QUEUED → CLAIMED → RUNNING → COMPLETED, each writing an audit row", async () => {
    const jobId = await freshJob();

    const r1 = await transitionJob(jobId, JobStatus.CLAIMED, { actor: "test" });
    expect(r1.ok).toBe(true);
    const r2 = await transitionJob(jobId, JobStatus.RUNNING, { actor: "test" });
    expect(r2.ok).toBe(true);
    const r3 = await transitionJob(jobId, JobStatus.COMPLETED, {
      actor: "test",
    });
    expect(r3.ok).toBe(true);

    expect(await statusOf(jobId)).toBe(JobStatus.COMPLETED);
    expect(await transitionCount(jobId)).toBe(3);
  });

  it("applies `set` columns atomically with the status change", async () => {
    const jobId = await freshJob();
    const startedAt = new Date("2026-01-01T00:00:00Z");
    await transitionJob(jobId, JobStatus.RUNNING, {
      actor: "test",
      set: { startedAt },
    });
    const [row] = await db
      .select({ status: jobs.status, startedAt: jobs.startedAt })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    expect(row!.status).toBe(JobStatus.RUNNING);
    expect(row!.startedAt?.toISOString()).toBe(startedAt.toISOString());
  });
});

describe("transitionJob — illegal edges rejected by the state machine", () => {
  it("rejects a transition out of a terminal state (absorbing)", async () => {
    const jobId = await freshJob();
    await transitionJob(jobId, JobStatus.COMPLETED, { actor: "test" });

    const bad = await transitionJob(jobId, JobStatus.RUNNING, {
      actor: "test",
    });
    expect(bad.ok).toBe(false);
    expect((bad as { current?: JobStatus }).current).toBe(JobStatus.COMPLETED);

    // Still terminal; no extra audit row for the rejected edge.
    expect(await statusOf(jobId)).toBe(JobStatus.COMPLETED);
    expect(await transitionCount(jobId)).toBe(1);
  });

  it("rejects terminal → terminal (COMPLETED → FAILED)", async () => {
    const jobId = await freshJob();
    await transitionJob(jobId, JobStatus.COMPLETED, { actor: "test" });
    const bad = await transitionJob(jobId, JobStatus.FAILED, { actor: "test" });
    expect(bad.ok).toBe(false);
    expect(await statusOf(jobId)).toBe(JobStatus.COMPLETED);
  });

  it("honors expectedFrom narrowing (never widens the legal set)", async () => {
    const jobId = await freshJob(JobStatus.RUNNING);
    // COMPLETED is legal from RUNNING, but we restrict expectedFrom to CLAIMED.
    const bad = await transitionJob(jobId, JobStatus.COMPLETED, {
      actor: "test",
      expectedFrom: [JobStatus.CLAIMED],
    });
    expect(bad.ok).toBe(false);
    expect(await statusOf(jobId)).toBe(JobStatus.RUNNING);
  });

  it("same-status transition is an idempotent no-op (no audit row)", async () => {
    const jobId = await freshJob(JobStatus.RUNNING);
    const res = await transitionJob(jobId, JobStatus.RUNNING, {
      actor: "test",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.noop).toBe(true);
    expect(await transitionCount(jobId)).toBe(0);
  });
});

describe("transitionJob — racing transitions on one job", () => {
  it("two competing terminal transitions: exactly one wins", async () => {
    const jobId = await freshJob();

    // Both fire concurrently against the same QUEUED job. The row lock
    // serializes them; whichever commits first makes the job terminal, so the
    // loser's target becomes an illegal terminal→terminal edge.
    const [a, b] = await Promise.all([
      transitionJob(jobId, JobStatus.COMPLETED, { actor: "A" }),
      transitionJob(jobId, JobStatus.FAILED, { actor: "B" }),
    ]);

    const winners = [a, b].filter((r) => r.ok && !r.noop);
    const losers = [a, b].filter((r) => !r.ok);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);

    // Exactly one audit row, matching the surviving status.
    expect(await transitionCount(jobId)).toBe(1);
    const finalStatus = await statusOf(jobId);
    expect([JobStatus.COMPLETED, JobStatus.FAILED]).toContain(finalStatus);
  });

  it("many concurrent claims of one job produce a single real transition", async () => {
    const jobId = await freshJob();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        transitionJob(jobId, JobStatus.CLAIMED, { actor: "racer" }),
      ),
    );
    // One real transition; the rest are same-status no-ops (they observed the
    // already-CLAIMED row). None illegally double-transitions.
    const real = results.filter((r) => r.ok && !r.noop);
    expect(real.length).toBe(1);
    expect(await transitionCount(jobId)).toBe(1);
    expect(await statusOf(jobId)).toBe(JobStatus.CLAIMED);
  });
});
