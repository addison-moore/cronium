/**
 * WorkflowCleanupService against real Postgres: the workflow_logs foreign key,
 * the run/workflow id sequences and the jobs metadata filter only mean anything
 * on a real database.
 *
 * workflow_executions and workflows number their rows independently, so run 2 and
 * workflow 2 are unrelated. The timeout path used to treat them as the same thing.
 */
import { eq } from "drizzle-orm";
import { db, pool } from "@/server/db";
import { storage } from "@/server/storage";
import { WorkflowCleanupService } from "@/lib/services/workflow-cleanup-service";
import {
  jobs,
  jobTransitions,
  workflowExecutions,
  workflowLogs,
  workflows,
  JobStatus,
  LogStatus,
  WorkflowLogLevel,
} from "@/shared/schema";
import { resetDatabase, closePool } from "./helpers/db-reset";
import { seedEvent, seedJob, seedUser } from "./helpers/seed";

const MAX_AGE_MS = 30 * 60 * 1000;
const TIMEOUT_MESSAGE = "Workflow execution timed out after 1800s";

const service = new WorkflowCleanupService({
  maxWorkflowAge: MAX_AGE_MS,
  sweepJobs: false,
});

const pastTheCutoff = () => new Date(Date.now() - 2 * MAX_AGE_MS);

async function seedWorkflow(userId: string): Promise<number> {
  const [row] = await db
    .insert(workflows)
    .values({ userId, name: `wf-${userId}` })
    .returning({ id: workflows.id });
  return row!.id;
}

async function seedStuckRun(
  workflowId: number,
  userId: string,
): Promise<number> {
  const [row] = await db
    .insert(workflowExecutions)
    .values({
      workflowId,
      userId,
      triggerType: "MANUAL",
      status: LogStatus.RUNNING,
      startedAt: pastTheCutoff(),
    })
    .returning({ id: workflowExecutions.id });
  return row!.id;
}

async function seedFinishedRun(
  workflowId: number,
  userId: string,
): Promise<number> {
  const [row] = await db
    .insert(workflowExecutions)
    .values({
      workflowId,
      userId,
      triggerType: "MANUAL",
      status: LogStatus.SUCCESS,
      startedAt: pastTheCutoff(),
      completedAt: new Date(),
    })
    .returning({ id: workflowExecutions.id });
  return row!.id;
}

async function runOf(id: number) {
  const [row] = await db
    .select()
    .from(workflowExecutions)
    .where(eq(workflowExecutions.id, id));
  return row!;
}

async function jobStatus(id: string): Promise<JobStatus> {
  const [row] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, id));
  return row!.status;
}

/** The rows an owner reads for this workflow. */
async function logsOf(workflowId: number) {
  const { logs } = await storage.getWorkflowLogs(workflowId, 50);
  return logs;
}

async function allLogs() {
  return db.select().from(workflowLogs);
}

/** Every new workflow_logs row now fails in Postgres itself. NOT VALID leaves
 * existing rows alone, and the constraint is gone again once `fn` returns. */
async function withWorkflowLogWritesRefused(
  fn: () => Promise<void>,
): Promise<void> {
  await pool.query(
    `ALTER TABLE workflow_logs ADD CONSTRAINT test_refuse_writes CHECK (false) NOT VALID`,
  );
  try {
    await fn();
  } finally {
    await pool.query(
      `ALTER TABLE workflow_logs DROP CONSTRAINT test_refuse_writes`,
    );
  }
}

beforeEach(async () => {
  await resetDatabase();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await closePool();
});

describe("the timeout row", () => {
  it("lands on the run's workflow when another user's workflow has the run's id", async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const workflowA = await seedWorkflow(userA);
    const workflowB = await seedWorkflow(userB);
    await seedFinishedRun(workflowA, userA);
    const stuckRun = await seedStuckRun(workflowA, userA);
    // The collision this test is about: run 2 of workflow 1, and a workflow 2.
    expect(stuckRun).toBe(workflowB);

    await service.performCleanup();

    expect(await runOf(stuckRun)).toMatchObject({
      status: LogStatus.TIMEOUT,
      completedAt: expect.any(Date),
    });
    expect(await logsOf(workflowA)).toEqual([
      expect.objectContaining({
        workflowId: workflowA,
        userId: userA,
        status: LogStatus.TIMEOUT,
        level: WorkflowLogLevel.ERROR,
        message: TIMEOUT_MESSAGE,
      }),
    ]);
    expect(await logsOf(workflowB)).toEqual([]);
  });

  it("carries the run's workflow and owner when no workflow has the run's id", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    for (let i = 0; i < 5; i++) await seedFinishedRun(workflowId, userId);
    const stuckRun = await seedStuckRun(workflowId, userId);
    expect(stuckRun).toBe(6);

    await service.performCleanup();

    expect(await allLogs()).toEqual([
      expect.objectContaining({
        workflowId,
        userId,
        status: LogStatus.TIMEOUT,
        message: TIMEOUT_MESSAGE,
      }),
    ]);
  });

  it("goes to each stuck run's own workflow when a sweep finds several", async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const workflowA = await seedWorkflow(userA);
    const workflowB = await seedWorkflow(userB);
    // Crossed on purpose: run 1 is B's, and run 2 is A's.
    await seedStuckRun(workflowB, userB);
    await seedStuckRun(workflowA, userA);

    await service.performCleanup();

    expect(await logsOf(workflowA)).toEqual([
      expect.objectContaining({ workflowId: workflowA, userId: userA }),
    ]);
    expect(await logsOf(workflowB)).toEqual([
      expect.objectContaining({ workflowId: workflowB, userId: userB }),
    ]);
  });
});

describe("the run's jobs", () => {
  it("time out when no workflow has the run's id, which used to skip them", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const eventId = await seedEvent(userId);
    for (let i = 0; i < 5; i++) await seedFinishedRun(workflowId, userId);
    const stuckRun = await seedStuckRun(workflowId, userId);
    expect(stuckRun).toBe(6);
    const running = await seedJob(eventId, userId, {
      status: JobStatus.RUNNING,
      metadata: { workflowExecutionId: stuckRun },
    });
    const claimed = await seedJob(eventId, userId, {
      status: JobStatus.CLAIMED,
      metadata: { workflowExecutionId: stuckRun },
    });

    await service.performCleanup();

    expect((await runOf(stuckRun)).status).toBe(LogStatus.TIMEOUT);
    expect(await jobStatus(running)).toBe(JobStatus.TIMED_OUT);
    expect(await jobStatus(claimed)).toBe(JobStatus.TIMED_OUT);
    // Through the state machine, so the outbox hears about it.
    const transitions = await db
      .select()
      .from(jobTransitions)
      .where(eq(jobTransitions.jobId, running));
    expect(transitions).toEqual([
      expect.objectContaining({
        fromStatus: JobStatus.RUNNING,
        toStatus: JobStatus.TIMED_OUT,
        actor: "sweeper",
      }),
    ]);
  });

  it("time out when Postgres refuses the log line, for every stuck run", async () => {
    const errors = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const eventId = await seedEvent(userId);
    const firstRun = await seedStuckRun(workflowId, userId);
    const secondRun = await seedStuckRun(workflowId, userId);
    const firstJob = await seedJob(eventId, userId, {
      status: JobStatus.RUNNING,
      metadata: { workflowExecutionId: firstRun },
    });
    const secondJob = await seedJob(eventId, userId, {
      status: JobStatus.RUNNING,
      metadata: { workflowExecutionId: secondRun },
    });

    await withWorkflowLogWritesRefused(() => service.performCleanup());

    expect((await runOf(firstRun)).status).toBe(LogStatus.TIMEOUT);
    expect((await runOf(secondRun)).status).toBe(LogStatus.TIMEOUT);
    expect(await jobStatus(firstJob)).toBe(JobStatus.TIMED_OUT);
    expect(await jobStatus(secondJob)).toBe(JobStatus.TIMED_OUT);
    expect(await allLogs()).toEqual([]);
    // Nothing else records the lost line, so it has to reach the server log.
    const logged = errors.mock.calls.map((call) => String(call[0]));
    expect(
      logged.filter((line) => line.includes(`run ${firstRun}`)),
    ).toHaveLength(1);
    expect(
      logged.filter((line) => line.includes(`run ${secondRun}`)),
    ).toHaveLength(1);
  });

  it("are only the active ones stamped with this run", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const eventId = await seedEvent(userId);
    const stuckRun = await seedStuckRun(workflowId, userId);
    const [liveRun] = await db
      .insert(workflowExecutions)
      .values({
        workflowId,
        userId,
        triggerType: "MANUAL",
        status: LogStatus.RUNNING,
        startedAt: new Date(),
      })
      .returning({ id: workflowExecutions.id });
    const seed = (status: JobStatus, metadata: Record<string, unknown>) =>
      seedJob(eventId, userId, { status, metadata });

    const mine = await seed(JobStatus.RUNNING, {
      workflowExecutionId: stuckRun,
    });
    const otherRun = await seed(JobStatus.RUNNING, {
      workflowExecutionId: liveRun!.id,
    });
    // Compared as a value, so 1 must not match 10 or 11.
    const sharedPrefix = await seed(JobStatus.RUNNING, {
      workflowExecutionId: Number(`${stuckRun}0`),
    });
    // The same number in the neighbouring metadata keys is not this run.
    const otherKeys = await seed(JobStatus.RUNNING, {
      workflowId: stuckRun,
      workflowStepRunId: stuckRun,
    });
    const noMetadata = await seed(JobStatus.RUNNING, {});
    // Not picked up by this path; the worker's own sweeps own these.
    const queued = await seed(JobStatus.QUEUED, {
      workflowExecutionId: stuckRun,
    });
    const finished = await seed(JobStatus.COMPLETED, {
      workflowExecutionId: stuckRun,
    });

    await service.performCleanup();

    expect(await jobStatus(mine)).toBe(JobStatus.TIMED_OUT);
    expect(await jobStatus(otherRun)).toBe(JobStatus.RUNNING);
    expect(await jobStatus(sharedPrefix)).toBe(JobStatus.RUNNING);
    expect(await jobStatus(otherKeys)).toBe(JobStatus.RUNNING);
    expect(await jobStatus(noMetadata)).toBe(JobStatus.RUNNING);
    expect(await jobStatus(queued)).toBe(JobStatus.QUEUED);
    expect(await jobStatus(finished)).toBe(JobStatus.COMPLETED);
  });

  it("are found by a filtered query, not by loading the jobs table", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const eventId = await seedEvent(userId);
    const stuckRun = await seedStuckRun(workflowId, userId);
    await seedJob(eventId, userId, {
      status: JobStatus.RUNNING,
      metadata: { workflowExecutionId: stuckRun },
    });
    const query = jest.spyOn(pool, "query");

    await service.performCleanup();

    const onJobs = query.mock.calls
      .map(([q]) => (typeof q === "string" ? q : (q as { text: string }).text))
      .filter((text) => /from "jobs"/.test(text));
    // Empty would mean the spy stopped seeing drizzle's queries, not a pass.
    expect(onJobs.length).toBeGreaterThan(0);
    for (const text of onJobs) {
      expect(text).toMatch(/where/);
    }
  });
});

describe("a failure finding the run's jobs", () => {
  it("is logged, and the run and its log line stand", async () => {
    const errors = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const stuckRun = await seedStuckRun(workflowId, userId);
    await pool.query(`ALTER TABLE jobs RENAME TO jobs_hidden`);
    try {
      await expect(service.cleanupWorkflow(stuckRun)).resolves.toBe(true);
    } finally {
      await pool.query(`ALTER TABLE jobs_hidden RENAME TO jobs`);
    }

    expect((await runOf(stuckRun)).status).toBe(LogStatus.TIMEOUT);
    expect(await logsOf(workflowId)).toHaveLength(1);
    expect(
      errors.mock.calls.some((call) =>
        String(call[0]).includes(`run ${stuckRun}`),
      ),
    ).toBe(true);
  });
});

describe("cleanupWorkflow, the admin route's entry point", () => {
  it("takes a run id, and times out that run rather than a workflow's", async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const workflowA = await seedWorkflow(userA);
    const workflowB = await seedWorkflow(userB);
    await seedFinishedRun(workflowA, userA);
    const stuckRun = await seedStuckRun(workflowA, userA);
    const runOfB = await seedStuckRun(workflowB, userB);
    expect(stuckRun).toBe(workflowB);

    await expect(service.cleanupWorkflow(stuckRun)).resolves.toBe(true);

    expect((await runOf(stuckRun)).status).toBe(LogStatus.TIMEOUT);
    expect((await runOf(runOfB)).status).toBe(LogStatus.RUNNING);
    expect(await logsOf(workflowA)).toHaveLength(1);
    expect(await logsOf(workflowB)).toEqual([]);
  });

  it("leaves a finished run's result alone and writes no row", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const finished = await seedFinishedRun(workflowId, userId);
    const before = await runOf(finished);

    await expect(service.cleanupWorkflow(finished)).resolves.toBe(false);

    expect(await runOf(finished)).toEqual(before);
    expect(await allLogs()).toEqual([]);
  });

  it("does not time out the same run twice", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const stuckRun = await seedStuckRun(workflowId, userId);

    await expect(service.cleanupWorkflow(stuckRun)).resolves.toBe(true);
    const first = await runOf(stuckRun);
    await expect(service.cleanupWorkflow(stuckRun)).resolves.toBe(false);

    expect(await runOf(stuckRun)).toEqual(first);
    expect(await allLogs()).toHaveLength(1);
  });

  it("reports an id no run has", async () => {
    await expect(service.cleanupWorkflow(424242)).resolves.toBe(false);
    expect(await allLogs()).toEqual([]);
  });

  it("throws when the run itself cannot be updated, so the route can say so", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const stuckRun = await seedStuckRun(workflowId, userId);
    await pool.query(
      `ALTER TABLE workflow_executions ADD CONSTRAINT test_refuse_writes CHECK (false) NOT VALID`,
    );
    try {
      await expect(service.cleanupWorkflow(stuckRun)).rejects.toThrow();
    } finally {
      await pool.query(
        `ALTER TABLE workflow_executions DROP CONSTRAINT test_refuse_writes`,
      );
    }
    expect((await runOf(stuckRun)).status).toBe(LogStatus.RUNNING);
    expect(await allLogs()).toEqual([]);
  });
});

describe("the sweep", () => {
  it("carries on past a run it cannot update", async () => {
    const errors = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const eventId = await seedEvent(userId);
    const refused = await seedStuckRun(workflowId, userId);
    const fine = await seedStuckRun(workflowId, userId);
    const job = await seedJob(eventId, userId, {
      status: JobStatus.RUNNING,
      metadata: { workflowExecutionId: fine },
    });
    // A real failure for one row only, whichever order the sweep reads them in.
    await pool.query(
      `ALTER TABLE workflow_executions ADD CONSTRAINT test_refuse_one_run CHECK (id <> ${refused} OR status <> 'TIMEOUT') NOT VALID`,
    );
    try {
      await service.performCleanup();
    } finally {
      await pool.query(
        `ALTER TABLE workflow_executions DROP CONSTRAINT test_refuse_one_run`,
      );
    }

    expect((await runOf(refused)).status).toBe(LogStatus.RUNNING);
    expect((await runOf(fine)).status).toBe(LogStatus.TIMEOUT);
    expect(await jobStatus(job)).toBe(JobStatus.TIMED_OUT);
    expect(
      errors.mock.calls.some((call) =>
        String(call[0]).includes(`run ${refused}`),
      ),
    ).toBe(true);
  });

  it("ignores runs still inside the window", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const [live] = await db
      .insert(workflowExecutions)
      .values({
        workflowId,
        userId,
        triggerType: "MANUAL",
        status: LogStatus.RUNNING,
        startedAt: new Date(),
      })
      .returning({ id: workflowExecutions.id });

    await service.performCleanup();

    expect((await runOf(live!.id)).status).toBe(LogStatus.RUNNING);
    expect(await allLogs()).toEqual([]);
  });
});
