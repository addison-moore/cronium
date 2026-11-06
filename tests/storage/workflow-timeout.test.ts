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
import { deriveNodeStatuses } from "@/components/workflows/lib/execution-graph";
import * as httpEvents from "@/lib/scheduler/http-event-executor";
import { dispatchEventJob } from "@/lib/scheduling/dispatch";
import { InProcessWorkerPool } from "@/lib/scheduling/worker-executor";
import {
  advanceRunsForJob,
  advanceWorkflowRun,
  settleTimedOutRunSteps,
  startWorkflowRun,
} from "@/lib/scheduling/workflow-engine";
import { jobService } from "@/lib/services/job-service";
import { WorkflowCleanupService } from "@/lib/services/workflow-cleanup-service";
import * as resourceAccess from "@/server/security/resource-access";
import {
  executions,
  jobs,
  jobTransitions,
  logs,
  workflowConnections,
  workflowExecutionEvents,
  workflowExecutions,
  workflowLogs,
  workflowNodes,
  workflows,
  workflowStepRuns,
  ConnectionType,
  EventType,
  JobStatus,
  OverlapPolicy,
  LogStatus,
  WorkflowLogLevel,
  WorkflowStepStatus,
  WorkflowTriggerType,
} from "@/shared/schema";
import { resetDatabase, closePool } from "./helpers/db-reset";
import { seedEvent, seedExecution, seedJob, seedUser } from "./helpers/seed";

// Real engine runs and many queries per test. `testTimeout` on the Jest project
// has no effect, so without this these get the 5 second default.
jest.setTimeout(60_000);

// There's no socket server here, and each log update would retry with backoff.
jest.mock("@/lib/websocket-broadcaster", () => ({
  getWebSocketBroadcaster: () => ({
    broadcastLogUpdate: () => Promise.resolve({ success: true, attempts: 1 }),
  }),
}));

const MAX_AGE_MS = 30 * 60 * 1000;
const TIMEOUT_MESSAGE = /^Workflow execution timed out after \d+s$/;
const MAX_TOTAL_DURATION_MS = 2_147_483_647;

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
  startedAt: Date = pastTheCutoff(),
): Promise<number> {
  const [row] = await db
    .insert(workflowExecutions)
    .values({
      workflowId,
      userId,
      triggerType: "MANUAL",
      status: LogStatus.RUNNING,
      startedAt,
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

/** Workflow first -> second, started through the real engine with nothing there
 * to claim its jobs, then aged past the cutoff. `first` is dispatched, with its
 * job queued and its telemetry row RUNNING. `second` is waiting on it. */
async function startStuckRun(
  eventOverrides: Parameters<typeof seedEvent>[1] = {},
) {
  const userId = await seedUser();
  const workflowId = await seedWorkflow(userId);
  const firstEvent = await seedEvent(userId, eventOverrides);
  const secondEvent = await seedEvent(userId);
  const [firstNode] = await db
    .insert(workflowNodes)
    .values({ workflowId, eventId: firstEvent })
    .returning({ id: workflowNodes.id });
  const [secondNode] = await db
    .insert(workflowNodes)
    .values({ workflowId, eventId: secondEvent })
    .returning({ id: workflowNodes.id });
  await db.insert(workflowConnections).values({
    workflowId,
    sourceNodeId: firstNode!.id,
    targetNodeId: secondNode!.id,
    connectionType: ConnectionType.ON_SUCCESS,
  });

  const started = await startWorkflowRun(workflowId, {
    triggerType: WorkflowTriggerType.MANUAL,
  });
  expect(started).toMatchObject({ success: true });
  const runId = started.executionId!;
  await db
    .update(workflowExecutions)
    .set({ startedAt: pastTheCutoff() })
    .where(eq(workflowExecutions.id, runId));

  const firstStep = await stepOf(runId, firstNode!.id);
  expect(firstStep.status).toBe(WorkflowStepStatus.DISPATCHED);
  expect(firstStep.jobId).toEqual(expect.any(String));
  expect(await jobStatus(firstStep.jobId!)).toBe(JobStatus.QUEUED);

  return {
    userId,
    workflowId,
    runId,
    jobId: firstStep.jobId!,
    firstEvent,
    secondEvent,
    firstNode: firstNode!.id,
    secondNode: secondNode!.id,
  };
}

/** Time out a run the way the code before step settling did: the run row alone,
 * which is the state older runs are still sitting in. */
async function timeOutRunRowOnly(runId: number, completedAt: Date) {
  await db
    .update(workflowExecutions)
    .set({ status: LogStatus.TIMEOUT, completedAt, totalDuration: MAX_AGE_MS })
    .where(eq(workflowExecutions.id, runId));
}

async function logOf(jobId: string) {
  const [row] = await db.select().from(logs).where(eq(logs.jobId, jobId));
  return row!;
}

async function jobOf(jobId: string) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  return row!;
}

/** The job, claimed and started, as an orchestrator would leave it. */
async function startJob(jobId: string) {
  const [claimed] = await jobService.claimJobs("orch-1", 10);
  expect(claimed?.id).toBe(jobId);
  await jobService.updateJobStatus(jobId, JobStatus.RUNNING, {
    startedAt: new Date(),
  });
}

async function closeAllSteps(runId: number) {
  await db
    .update(workflowStepRuns)
    .set({ status: WorkflowStepStatus.FAILED, completedAt: new Date() })
    .where(eq(workflowStepRuns.workflowExecutionId, runId));
}

async function closeAllTelemetry(runId: number) {
  await db
    .update(workflowExecutionEvents)
    .set({ status: LogStatus.FAILURE, completedAt: new Date() })
    .where(eq(workflowExecutionEvents.workflowExecutionId, runId));
}

/** Everything a run wrote, for checking that nothing changed. */
async function snapshot(runId: number) {
  return {
    run: await runOf(runId),
    steps: await db
      .select()
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.workflowExecutionId, runId))
      .orderBy(workflowStepRuns.id),
    telemetry: await telemetryOf(runId),
    jobs: await db.select().from(jobs).orderBy(jobs.id),
    workflowLogs: await db.select().from(workflowLogs).orderBy(workflowLogs.id),
  };
}

/** Start a run while a spy interrupts its dispatch, so none of startStuckRun's
 * checks on the finished dispatch apply. */
async function startRunWithoutChecks() {
  const userId = await seedUser();
  const workflowId = await seedWorkflow(userId);
  const firstEvent = await seedEvent(userId);
  const secondEvent = await seedEvent(userId);
  const [firstNode] = await db
    .insert(workflowNodes)
    .values({ workflowId, eventId: firstEvent })
    .returning({ id: workflowNodes.id });
  const [secondNode] = await db
    .insert(workflowNodes)
    .values({ workflowId, eventId: secondEvent })
    .returning({ id: workflowNodes.id });
  await db.insert(workflowConnections).values({
    workflowId,
    sourceNodeId: firstNode!.id,
    targetNodeId: secondNode!.id,
    connectionType: ConnectionType.ON_SUCCESS,
  });

  const started = await startWorkflowRun(workflowId, {
    triggerType: WorkflowTriggerType.MANUAL,
  });
  expect(started).toMatchObject({ success: true });
  const [job] = await db.select().from(jobs);
  return {
    runId: started.executionId!,
    jobId: job!.id,
    firstNode: firstNode!.id,
    secondNode: secondNode!.id,
  };
}

async function stepOf(runId: number, nodeId: number) {
  const steps = await db
    .select()
    .from(workflowStepRuns)
    .where(eq(workflowStepRuns.workflowExecutionId, runId));
  return steps.find((step) => step.nodeId === nodeId)!;
}

async function telemetryOf(runId: number) {
  return db
    .select()
    .from(workflowExecutionEvents)
    .where(eq(workflowExecutionEvents.workflowExecutionId, runId));
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
        message: expect.stringMatching(TIMEOUT_MESSAGE),
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
        message: expect.stringMatching(TIMEOUT_MESSAGE),
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

describe("the time it records", () => {
  /** The seconds in the run's timeout line, and that the run's own columns agree. */
  async function recordedSeconds(runId: number, workflowId: number) {
    const run = await runOf(runId);
    const [line] = await logsOf(workflowId);
    const [, seconds] = line!.message!.match(/after (\d+)s$/)!;
    return { run, seconds: Number(seconds) };
  }

  it("is how long a run stuck past the limit really ran, not the limit", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const threeHours = 3 * 60 * 60 * 1000;
    const stuckRun = await seedStuckRun(
      workflowId,
      userId,
      new Date(Date.now() - threeHours),
    );

    await service.performCleanup();

    const { run, seconds } = await recordedSeconds(stuckRun, workflowId);
    expect(run.totalDuration).toBeGreaterThanOrEqual(threeHours);
    expect(run.totalDuration).toBeLessThan(threeHours + 60_000);
    expect(seconds).toBeGreaterThanOrEqual(10_800);
    expect(seconds).toBeLessThan(10_860);
  });

  it("is how long the run really ran when an admin stops it early", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const twoMinutes = 2 * 60 * 1000;
    const runId = await seedStuckRun(
      workflowId,
      userId,
      new Date(Date.now() - twoMinutes),
    );

    await expect(service.cleanupWorkflow(runId)).resolves.toBe(true);

    const { run, seconds } = await recordedSeconds(runId, workflowId);
    expect(run.totalDuration).toBeGreaterThanOrEqual(twoMinutes);
    expect(run.totalDuration).toBeLessThan(twoMinutes + 60_000);
    expect(seconds).toBeGreaterThanOrEqual(120);
    expect(seconds).toBeLessThan(180);
  });

  it("is the same instant on completed_at and updated_at", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const stuckRun = await seedStuckRun(workflowId, userId);
    const before = await runOf(stuckRun);

    await service.performCleanup();

    const after = await runOf(stuckRun);
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime(),
    );
    expect(after.updatedAt).toEqual(after.completedAt);
  });

  it("does not stop a run stuck longer than the column can hold from timing out", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(thirtyDays).toBeGreaterThan(MAX_TOTAL_DURATION_MS);
    const stuckRun = await seedStuckRun(
      workflowId,
      userId,
      new Date(Date.now() - thirtyDays),
    );

    await service.performCleanup();

    const { run, seconds } = await recordedSeconds(stuckRun, workflowId);
    expect(run.status).toBe(LogStatus.TIMEOUT);
    expect(run.totalDuration).toBe(MAX_TOTAL_DURATION_MS);
    // The line isn't limited by the column, so it still tells the truth.
    expect(seconds).toBeGreaterThanOrEqual(2_592_000);
    expect(seconds).toBeLessThan(2_592_060);
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

  it("are only the unfinished ones stamped with this run", async () => {
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
    const queued = await seed(JobStatus.QUEUED, {
      workflowExecutionId: stuckRun,
    });
    const queuedForOtherRun = await seed(JobStatus.QUEUED, {
      workflowExecutionId: liveRun!.id,
    });
    const queuedOutsideAnyRun = await seed(JobStatus.QUEUED, {});
    const finished = await seed(JobStatus.COMPLETED, {
      workflowExecutionId: stuckRun,
    });

    await service.performCleanup();

    expect(await jobStatus(mine)).toBe(JobStatus.TIMED_OUT);
    expect(await jobStatus(otherRun)).toBe(JobStatus.RUNNING);
    expect(await jobStatus(sharedPrefix)).toBe(JobStatus.RUNNING);
    expect(await jobStatus(otherKeys)).toBe(JobStatus.RUNNING);
    expect(await jobStatus(noMetadata)).toBe(JobStatus.RUNNING);
    expect(await jobStatus(queued)).toBe(JobStatus.TIMED_OUT);
    expect(await jobStatus(queuedForOtherRun)).toBe(JobStatus.QUEUED);
    expect(await jobStatus(queuedOutsideAnyRun)).toBe(JobStatus.QUEUED);
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
  it("does not stop the steps that have no job from settling", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const eventId = await seedEvent(userId);
    const stuckRun = await seedStuckRun(workflowId, userId);
    await db.insert(workflowStepRuns).values({
      workflowExecutionId: stuckRun,
      nodeId: 1,
      eventId,
      status: WorkflowStepStatus.PENDING,
    });
    await pool.query(`ALTER TABLE jobs RENAME TO jobs_hidden`);
    try {
      await expect(service.cleanupWorkflow(stuckRun)).resolves.toBe(true);
    } finally {
      await pool.query(`ALTER TABLE jobs_hidden RENAME TO jobs`);
    }

    expect((await stepOf(stuckRun, 1)).status).toBe(WorkflowStepStatus.SKIPPED);
  });

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

describe("a step job still queued when its run times out", () => {
  it("is not claimed by an orchestrator afterwards", async () => {
    const { runId, jobId } = await startStuckRun();

    await service.performCleanup();

    expect((await runOf(runId)).status).toBe(LogStatus.TIMEOUT);
    expect(await jobService.claimJobs("orch-after-the-timeout", 10)).toEqual(
      [],
    );
    expect(await jobStatus(jobId)).toBe(JobStatus.TIMED_OUT);
  });

  it("is not claimed by the worker's in-process pool afterwards", async () => {
    const { runId, jobId } = await startStuckRun({
      type: EventType.HTTP_REQUEST,
      httpMethod: "GET",
      httpUrl: "https://example.test/never-called",
    });

    await service.performCleanup();

    expect((await runOf(runId)).status).toBe(LogStatus.TIMEOUT);
    const workerPool = new InProcessWorkerPool("worker-after-the-timeout", 10);
    const execute = jest.spyOn(httpEvents, "executeHttpEvent");
    await expect(workerPool.claimAndRun()).resolves.toBe(0);
    await workerPool.drain();
    expect(execute).not.toHaveBeenCalled();
    expect(await jobStatus(jobId)).toBe(JobStatus.TIMED_OUT);
  });

  it("says why, on the audit row, the job and its log", async () => {
    const { jobId } = await startStuckRun();

    await service.performCleanup();

    const reason = "Workflow run timed out before this job started";
    const transitions = await db
      .select()
      .from(jobTransitions)
      .where(eq(jobTransitions.jobId, jobId));
    expect(transitions.at(-1)).toMatchObject({
      fromStatus: JobStatus.QUEUED,
      toStatus: JobStatus.TIMED_OUT,
      actor: "sweeper",
      reason,
    });
    expect(await jobOf(jobId)).toMatchObject({
      lastError: reason,
      completedAt: expect.any(Date),
      startedAt: null,
    });
    // PENDING forever without this. It never ran, so it reports no duration.
    expect(await logOf(jobId)).toMatchObject({
      status: LogStatus.TIMEOUT,
      error: reason,
      endTime: expect.any(Date),
      duration: null,
    });
  });

  it("does not start later when it was waiting out a retry backoff", async () => {
    const { jobId } = await startStuckRun({ retries: 2 });
    await startJob(jobId);
    await seedExecution(jobId, {
      id: "exec-first-attempt",
      status: JobStatus.FAILED,
      completedAt: new Date(Date.now() - 1000),
      error: "the first attempt's own error",
      exitCode: 7,
    });
    await jobService.updateJobStatus(jobId, JobStatus.FAILED, {
      error: "the first attempt's own error",
    });
    const requeued = await jobOf(jobId);
    expect(requeued.status).toBe(JobStatus.QUEUED);
    expect(requeued.scheduledFor.getTime()).toBeGreaterThan(Date.now());

    await service.performCleanup();

    expect(await jobStatus(jobId)).toBe(JobStatus.TIMED_OUT);
    // Even once the backoff has passed
    await db
      .update(jobs)
      .set({ scheduledFor: new Date(Date.now() - 1000) })
      .where(eq(jobs.id, jobId));
    expect(await jobService.claimJobs("orch-after-the-timeout", 10)).toEqual(
      [],
    );
    // The attempt that really ran keeps what it reported
    const [execution] = await db
      .select()
      .from(executions)
      .where(eq(executions.jobId, jobId));
    expect(execution).toMatchObject({
      error: "the first attempt's own error",
      exitCode: 7,
    });
  });

  it("finishes an execution still in progress, unlike a finished one", async () => {
    const { jobId } = await startStuckRun();
    await startJob(jobId);
    await seedExecution(jobId, {
      id: "exec-in-progress",
      status: JobStatus.RUNNING,
      completedAt: null,
    });

    await service.performCleanup();

    const [execution] = await db
      .select()
      .from(executions)
      .where(eq(executions.jobId, jobId));
    expect(execution).toMatchObject({
      status: JobStatus.FAILED,
      error: "Workflow run timed out",
      exitCode: -1,
      completedAt: expect.any(Date),
    });
  });

  it("gives up its overlap slot, so the event can run again", async () => {
    const { jobId, firstEvent } = await startStuckRun({
      overlapPolicy: OverlapPolicy.SKIP,
    });
    const event = (await storage.getEventWithRelations(firstEvent))!;
    await expect(
      dispatchEventJob(event, { triggeredBy: "manual" }),
    ).resolves.toMatchObject({ job: null, skipped: "overlap" });

    await service.performCleanup();

    expect((await jobOf(jobId)).activeKey).toBeNull();
    const next = await dispatchEventJob(event, { triggeredBy: "manual" });
    expect(next.skipped).toBeUndefined();
    expect(next.job?.id).toEqual(expect.any(String));
  });

  it("does not execute if the pool claimed it just as the timeout landed", async () => {
    const { runId, jobId } = await startStuckRun({
      type: EventType.HTTP_REQUEST,
      httpMethod: "GET",
      httpUrl: "https://example.test/never-called",
    });
    const execute = jest.spyOn(httpEvents, "executeHttpEvent");
    const getEvent = storage.getEventWithRelations.bind(storage);
    // Runs between the claim and the job's first status report
    jest
      .spyOn(storage, "getEventWithRelations")
      .mockImplementationOnce(async (id) => {
        expect(await jobStatus(jobId)).toBe(JobStatus.CLAIMED);
        await service.cleanupWorkflow(runId);
        return getEvent(id);
      });
    const workerPool = new InProcessWorkerPool("worker-1", 10);

    await expect(workerPool.claimAndRun()).resolves.toBe(1);
    await workerPool.drain();

    expect(execute).not.toHaveBeenCalled();
    expect(await jobStatus(jobId)).toBe(JobStatus.TIMED_OUT);
  });
});

describe("a run that times out while a step is being dispatched", () => {
  it("creates no job when the timeout landed after the claim", async () => {
    const authorize = resourceAccess.assertWorkflowGraphCapability;
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const eventId = await seedEvent(userId);
    const [node] = await db
      .insert(workflowNodes)
      .values({ workflowId, eventId })
      .returning({ id: workflowNodes.id });
    jest
      .spyOn(resourceAccess, "assertWorkflowGraphCapability")
      // startWorkflowRun's own check, before the run exists
      .mockImplementationOnce(authorize)
      // The advance's check, after it committed the claim
      .mockImplementationOnce(async (...args) => {
        const [run] = await db.select().from(workflowExecutions);
        await service.cleanupWorkflow(run!.id);
        return authorize(...args);
      });

    const started = await startWorkflowRun(workflowId, {
      triggerType: WorkflowTriggerType.MANUAL,
    });

    expect(await db.select().from(jobs)).toEqual([]);
    expect(await db.select().from(logs)).toEqual([]);
    expect(await telemetryOf(started.executionId!)).toEqual([]);
    expect(await stepOf(started.executionId!, node!.id)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      error: "Workflow run timed out before this step's job was created",
    });
  });

  it("times out the job when the timeout landed before it was created", async () => {
    const getEvent = storage.getEventWithRelations.bind(storage);
    jest
      .spyOn(storage, "getEventWithRelations")
      .mockImplementationOnce(async (id) => {
        const [run] = await db.select().from(workflowExecutions);
        await service.cleanupWorkflow(run!.id);
        return getEvent(id);
      });

    const { runId, firstNode, jobId } = await startRunWithoutChecks();

    expect((await runOf(runId)).status).toBe(LogStatus.TIMEOUT);
    expect(await jobStatus(jobId)).toBe(JobStatus.TIMED_OUT);
    expect(await logOf(jobId)).toMatchObject({ status: LogStatus.TIMEOUT });
    expect(await jobService.claimJobs("orch-after-the-timeout", 10)).toEqual(
      [],
    );
    expect((await stepOf(runId, firstNode)).status).toBe(
      WorkflowStepStatus.FAILED,
    );
    // The telemetry row was created after the steps had already been settled
    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({
        nodeId: firstNode,
        status: LogStatus.FAILURE,
        completedAt: expect.any(Date),
      }),
    ]);
  });

  it("re-attaches a job created but not yet recorded on its step", async () => {
    const record = storage.recordEventDispatch.bind(storage);
    // Runs after the job insert, before the step is told about the job
    jest
      .spyOn(storage, "recordEventDispatch")
      .mockImplementationOnce(async (id) => {
        const [run] = await db.select().from(workflowExecutions);
        await service.cleanupWorkflow(run!.id);
        return record(id);
      });

    const { runId, firstNode, secondNode, jobId } =
      await startRunWithoutChecks();

    expect(await jobStatus(jobId)).toBe(JobStatus.TIMED_OUT);
    expect(await stepOf(runId, firstNode)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      jobId,
      error: "Workflow run timed out before this job started",
    });
    expect((await stepOf(runId, secondNode)).status).toBe(
      WorkflowStepStatus.SKIPPED,
    );
    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({ status: LogStatus.FAILURE }),
    ]);
  });

  it("leaves the step alone if the check after dispatch cannot read the run", async () => {
    const errors = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const select = db.select.bind(db);
    let dispatched = false;
    jest
      .spyOn(storage, "recordEventDispatch")
      .mockImplementationOnce(async () => {
        dispatched = true;
      });
    const failingSelect = jest.spyOn(db, "select").mockImplementation(((
      ...args: never[]
    ) => {
      // The next read of workflow_executions.status after the job exists
      const [fields] = args as unknown as [Record<string, unknown>?];
      if (dispatched && fields && "status" in fields) {
        throw new Error("connection lost");
      }
      return (select as (...a: never[]) => unknown)(...args);
    }) as never);

    const { runId, firstNode, jobId } = await startRunWithoutChecks();
    failingSelect.mockRestore();

    expect(await stepOf(runId, firstNode)).toMatchObject({
      status: WorkflowStepStatus.DISPATCHED,
      jobId,
    });
    expect(await jobStatus(jobId)).toBe(JobStatus.QUEUED);
    expect(
      errors.mock.calls.some((call) =>
        String(call[0]).includes(`run ${runId} for a timeout`),
      ),
    ).toBe(true);
  });
});

describe("the steps of a timed-out run", () => {
  it("reach a terminal state, and so does their telemetry", async () => {
    const { runId, firstNode, secondNode } = await startStuckRun();
    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({
        nodeId: firstNode,
        status: LogStatus.RUNNING,
      }),
    ]);

    await service.performCleanup();

    const run = await runOf(runId);
    expect(run.status).toBe(LogStatus.TIMEOUT);
    expect(await stepOf(runId, firstNode)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      error: "Workflow run timed out before this job started",
      completedAt: run.completedAt,
    });
    expect(await stepOf(runId, secondNode)).toMatchObject({
      status: WorkflowStepStatus.SKIPPED,
      error: "Workflow run timed out before this step started",
      completedAt: run.completedAt,
    });
    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({
        nodeId: firstNode,
        status: LogStatus.FAILURE,
        errorMessage: "Workflow run timed out before this job started",
        completedAt: run.completedAt,
        duration: expect.any(Number),
      }),
    ]);
    expect(run).toMatchObject({ successfulEvents: 0, failedEvents: 1 });
  });

  it("no longer read as executing in the app's graph", async () => {
    const { runId, firstNode, secondNode } = await startStuckRun();
    const graphNode = (id: number) => ({
      id: `node-${id}`,
      type: "event",
      position: { x: 0, y: 0 },
      data: {
        eventId: 0,
        label: `node ${id}`,
        type: "BASH",
        eventTypeIcon: "",
        description: "",
      },
    });
    // What workflows.getExecution returns, through what the graph derives from it
    const graph = async () =>
      deriveNodeStatuses(
        [graphNode(firstNode), graphNode(secondNode)],
        (await storage.getWorkflowExecutionEvents(runId)) as never,
      );
    expect((await graph())[0]).toMatchObject({ isCurrentlyExecuting: true });

    await service.performCleanup();

    const [first, second] = await graph();
    expect(first).toMatchObject({
      isCurrentlyExecuting: false,
      status: LogStatus.FAILURE,
      hasError: true,
    });
    expect(second).toMatchObject({
      isCurrentlyExecuting: false,
      status: LogStatus.PENDING,
    });
  });

  it("take the result of a job that finished before the timeout", async () => {
    const { runId, jobId, firstNode, secondNode, secondEvent } =
      await startStuckRun();
    await startJob(jobId);
    await jobService.updateJobStatus(jobId, JobStatus.COMPLETED, {
      result: { scriptOutput: { rows: 3 }, condition: true },
    });

    await service.performCleanup();

    expect(await stepOf(runId, firstNode)).toMatchObject({
      status: WorkflowStepStatus.SUCCEEDED,
      output: { rows: 3 },
      condition: true,
      error: null,
    });
    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({
        status: LogStatus.SUCCESS,
        output: JSON.stringify({ rows: 3 }),
        errorMessage: null,
      }),
    ]);
    expect(await jobStatus(jobId)).toBe(JobStatus.COMPLETED);
    expect(await runOf(runId)).toMatchObject({
      status: LogStatus.TIMEOUT,
      successfulEvents: 1,
      failedEvents: 0,
    });
    // Its successor was ready to go, and the run is over, so it never starts
    expect((await stepOf(runId, secondNode)).status).toBe(
      WorkflowStepStatus.SKIPPED,
    );
    const stepJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.eventId, secondEvent));
    expect(stepJobs).toEqual([]);
  });

  it("keep the error of a job that failed on its own", async () => {
    const { runId, jobId, firstNode } = await startStuckRun();
    await startJob(jobId);
    await jobService.failJob(jobId, "exit status 3");

    await service.performCleanup();

    expect(await stepOf(runId, firstNode)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      error: "exit status 3",
    });
    expect(await jobStatus(jobId)).toBe(JobStatus.FAILED);
  });

  it("fail with the run's timeout when their job was still running", async () => {
    const { runId, jobId, firstNode } = await startStuckRun();
    await startJob(jobId);

    await service.performCleanup();

    expect(await jobOf(jobId)).toMatchObject({
      status: JobStatus.TIMED_OUT,
      lastError: "Workflow run timed out",
    });
    expect(await stepOf(runId, firstNode)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      error: "Workflow run timed out",
    });
    expect((await logOf(jobId)).duration).toEqual(expect.any(Number));
  });

  it("fail when retention already removed their job", async () => {
    const { runId, jobId, firstNode } = await startStuckRun();
    await db.update(logs).set({ jobId: null }).where(eq(logs.jobId, jobId));
    await db.delete(jobTransitions).where(eq(jobTransitions.jobId, jobId));
    await db.delete(jobs).where(eq(jobs.id, jobId));

    await service.performCleanup();

    expect(await stepOf(runId, firstNode)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      error: "Job record disappeared",
    });
  });

  it("settle telemetry that never got linked to its step", async () => {
    const { runId, firstNode } = await startStuckRun();
    // A crash between creating the telemetry row and recording its id
    await db
      .update(workflowStepRuns)
      .set({ executionEventId: null })
      .where(eq(workflowStepRuns.nodeId, firstNode));

    await service.performCleanup();

    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({ status: LogStatus.FAILURE }),
    ]);
  });

  it("settle when a step has been open longer than a duration column can hold", async () => {
    const { runId, firstNode, secondNode } = await startStuckRun();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    await db
      .update(workflowExecutions)
      .set({ startedAt: thirtyDaysAgo })
      .where(eq(workflowExecutions.id, runId));
    await db
      .update(workflowStepRuns)
      .set({ startedAt: thirtyDaysAgo })
      .where(eq(workflowStepRuns.workflowExecutionId, runId));
    await db
      .update(workflowExecutionEvents)
      .set({ startedAt: thirtyDaysAgo })
      .where(eq(workflowExecutionEvents.workflowExecutionId, runId));

    await service.performCleanup();

    expect((await stepOf(runId, firstNode)).status).toBe(
      WorkflowStepStatus.FAILED,
    );
    expect((await stepOf(runId, secondNode)).status).toBe(
      WorkflowStepStatus.SKIPPED,
    );
    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({
        status: LogStatus.FAILURE,
        duration: MAX_TOTAL_DURATION_MS,
      }),
    ]);
  });

  it("report a job that ran longer than a duration column can hold", async () => {
    const { jobId } = await startStuckRun();
    await startJob(jobId);
    await seedExecution(jobId, {
      id: "exec-in-progress",
      status: JobStatus.RUNNING,
      completedAt: null,
    });
    await db
      .update(jobs)
      .set({ startedAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(jobs.id, jobId));

    await service.performCleanup();

    expect(await jobStatus(jobId)).toBe(JobStatus.TIMED_OUT);
    expect(await logOf(jobId)).toMatchObject({
      status: LogStatus.TIMEOUT,
      duration: MAX_TOTAL_DURATION_MS,
    });
    // Written after the log, so a failed log update would have skipped it
    const [execution] = await db
      .select()
      .from(executions)
      .where(eq(executions.jobId, jobId));
    expect(execution).toMatchObject({ status: JobStatus.FAILED, exitCode: -1 });
  });

  it("settle through the admin route's entry point as well", async () => {
    const { runId, jobId, firstNode, secondNode } = await startStuckRun();

    await expect(service.cleanupWorkflow(runId)).resolves.toBe(true);

    expect(await jobStatus(jobId)).toBe(JobStatus.TIMED_OUT);
    expect((await stepOf(runId, firstNode)).status).toBe(
      WorkflowStepStatus.FAILED,
    );
    expect((await stepOf(runId, secondNode)).status).toBe(
      WorkflowStepStatus.SKIPPED,
    );
  });
});

describe("advancing a timed-out run", () => {
  it("settles a step when a job's notification arrives", async () => {
    const { runId, jobId, firstNode } = await startStuckRun();
    await timeOutRunRowOnly(runId, new Date());
    await jobService.failJob(jobId, "exit status 3");

    await advanceRunsForJob(jobId);

    expect(await stepOf(runId, firstNode)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      error: "exit status 3",
    });
  });

  it("holds a step open while its job is in flight, then closes it", async () => {
    const { runId, jobId, firstNode, secondNode } = await startStuckRun();
    await timeOutRunRowOnly(runId, new Date());

    await advanceWorkflowRun(runId);

    // The job could still report a real result
    expect((await stepOf(runId, firstNode)).status).toBe(
      WorkflowStepStatus.DISPATCHED,
    );
    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({ status: LogStatus.RUNNING }),
    ]);
    expect((await stepOf(runId, secondNode)).status).toBe(
      WorkflowStepStatus.SKIPPED,
    );

    await startJob(jobId);
    await jobService.updateJobStatus(jobId, JobStatus.COMPLETED, {
      result: { scriptOutput: "done" },
    });
    await advanceWorkflowRun(runId);

    expect((await stepOf(runId, firstNode)).status).toBe(
      WorkflowStepStatus.SUCCEEDED,
    );
    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({ status: LogStatus.SUCCESS }),
    ]);
  });

  it("changes nothing once everything is settled", async () => {
    const { runId } = await startStuckRun();
    await service.performCleanup();
    const before = await snapshot(runId);

    await advanceWorkflowRun(runId);
    await settleTimedOutRunSteps(runId);

    expect(await snapshot(runId)).toEqual(before);
  });

  it("leaves a run that finished on its own alone", async () => {
    const { runId, jobId } = await startStuckRun();
    await db
      .update(workflowExecutions)
      .set({ status: LogStatus.FAILURE, completedAt: new Date() })
      .where(eq(workflowExecutions.id, runId));
    const before = await snapshot(runId);

    await advanceWorkflowRun(runId);
    await settleTimedOutRunSteps(runId);
    await service.performCleanup();

    expect(await snapshot(runId)).toEqual(before);
    expect(await jobStatus(jobId)).toBe(JobStatus.QUEUED);
  });

  it("waits for an advance holding the run, where a plain advance would skip", async () => {
    const { runId, jobId, firstNode } = await startStuckRun();
    await timeOutRunRowOnly(runId, new Date());
    await jobService.failJob(jobId, "exit status 3");

    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        `SELECT id FROM workflow_executions WHERE id = $1 FOR UPDATE`,
        [runId],
      );

      await advanceWorkflowRun(runId);
      expect((await stepOf(runId, firstNode)).status).toBe(
        WorkflowStepStatus.DISPATCHED,
      );

      let finished = false;
      const settling = settleTimedOutRunSteps(runId).then(() => {
        finished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(finished).toBe(false);

      await holder.query("COMMIT");
      await settling;
    } finally {
      holder.release();
    }

    expect((await stepOf(runId, firstNode)).status).toBe(
      WorkflowStepStatus.FAILED,
    );
  });
});

describe("the sweep, for runs that have already timed out", () => {
  it("settles a run left open by an earlier version", async () => {
    const { runId, jobId, firstNode, secondNode } = await startStuckRun();
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    await timeOutRunRowOnly(runId, threeDaysAgo);
    const before = await runOf(runId);

    await service.performCleanup();

    expect(await jobStatus(jobId)).toBe(JobStatus.TIMED_OUT);
    // Closed when the run ended, not when the sweep got to it
    const first = await stepOf(runId, firstNode);
    expect(first).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      completedAt: threeDaysAgo,
    });
    expect(await stepOf(runId, secondNode)).toMatchObject({
      status: WorkflowStepStatus.SKIPPED,
      completedAt: threeDaysAgo,
    });
    const [telemetry] = await telemetryOf(runId);
    expect(telemetry).toMatchObject({
      status: LogStatus.FAILURE,
      completedAt: threeDaysAgo,
      // The row started after the back-dated timeout here, which real clocks
      // can't do by days, and a duration still never goes negative
      duration: 0,
    });
    // The run itself keeps its result, and gets no second timeout line
    expect(await runOf(runId)).toMatchObject({
      status: before.status,
      completedAt: before.completedAt,
      totalDuration: before.totalDuration,
    });
    const timeoutLines = (await allLogs()).filter(
      (row) => row.status === LogStatus.TIMEOUT,
    );
    expect(timeoutLines).toEqual([]);
  });

  it("retries after the job lookup failed", async () => {
    const errors = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { runId, jobId, firstNode } = await startStuckRun();
    await pool.query(`ALTER TABLE jobs RENAME TO jobs_hidden`);
    try {
      await expect(service.cleanupWorkflow(runId)).resolves.toBe(true);
    } finally {
      await pool.query(`ALTER TABLE jobs_hidden RENAME TO jobs`);
    }
    expect(await jobStatus(jobId)).toBe(JobStatus.QUEUED);
    expect(
      errors.mock.calls.some((call) =>
        String(call[0]).includes(`run ${runId}`),
      ),
    ).toBe(true);

    await service.performCleanup();

    expect(await jobStatus(jobId)).toBe(JobStatus.TIMED_OUT);
    expect((await stepOf(runId, firstNode)).status).toBe(
      WorkflowStepStatus.FAILED,
    );
    // Only the first attempt wrote a timeout line
    const timeoutLines = (await allLogs()).filter(
      (row) => row.status === LogStatus.TIMEOUT,
    );
    expect(timeoutLines).toHaveLength(1);
  });

  it("retries after settling the steps failed, which changed nothing", async () => {
    const errors = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { runId, firstNode, secondNode } = await startStuckRun();
    await pool.query(
      `ALTER TABLE workflow_step_runs ADD CONSTRAINT test_refuse_skipped CHECK (status <> 'SKIPPED') NOT VALID`,
    );
    try {
      await service.cleanupWorkflow(runId);
    } finally {
      await pool.query(
        `ALTER TABLE workflow_step_runs DROP CONSTRAINT test_refuse_skipped`,
      );
    }
    // All or nothing: the first step and its telemetry rolled back together
    expect((await stepOf(runId, firstNode)).status).toBe(
      WorkflowStepStatus.DISPATCHED,
    );
    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({ status: LogStatus.RUNNING }),
    ]);
    expect(
      errors.mock.calls.some((call) =>
        String(call[0]).includes(`steps of workflow run ${runId}`),
      ),
    ).toBe(true);

    await service.performCleanup();

    expect((await stepOf(runId, firstNode)).status).toBe(
      WorkflowStepStatus.FAILED,
    );
    expect((await stepOf(runId, secondNode)).status).toBe(
      WorkflowStepStatus.SKIPPED,
    );
    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({ status: LogStatus.FAILURE }),
    ]);
  });

  // Each of the next three is the only thing open, so it alone gets the run found.
  it("finds a run whose only open thing is a queued job", async () => {
    const { runId, jobId } = await startStuckRun();
    await timeOutRunRowOnly(runId, new Date());
    await closeAllSteps(runId);
    await closeAllTelemetry(runId);

    await service.performCleanup();

    expect(await jobStatus(jobId)).toBe(JobStatus.TIMED_OUT);
  });

  it("finds a run whose only open thing is a dispatched step", async () => {
    const { runId, jobId, firstNode, secondNode } = await startStuckRun();
    await timeOutRunRowOnly(runId, new Date());
    await jobService.failJob(jobId, "exit status 3");
    await closeAllTelemetry(runId);
    await db
      .update(workflowStepRuns)
      .set({ status: WorkflowStepStatus.SKIPPED })
      .where(eq(workflowStepRuns.nodeId, secondNode));

    await service.performCleanup();

    expect(await stepOf(runId, firstNode)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      error: "exit status 3",
    });
  });

  it("finds a run whose only open thing is a step that never started", async () => {
    const { runId, jobId, firstNode, secondNode } = await startStuckRun();
    await timeOutRunRowOnly(runId, new Date());
    await jobService.failJob(jobId, "exit status 3");
    await closeAllTelemetry(runId);
    await db
      .update(workflowStepRuns)
      .set({ status: WorkflowStepStatus.FAILED })
      .where(eq(workflowStepRuns.nodeId, firstNode));

    await service.performCleanup();

    expect((await stepOf(runId, secondNode)).status).toBe(
      WorkflowStepStatus.SKIPPED,
    );
  });

  it("finds a telemetry row left RUNNING under a settled step, and gives it the step's result", async () => {
    const { runId, jobId, firstNode } = await startStuckRun();
    await startJob(jobId);
    await jobService.updateJobStatus(jobId, JobStatus.COMPLETED, {
      result: { scriptOutput: "done" },
    });
    await service.performCleanup();
    // As if the best-effort write had failed on a run settled by the old path
    await db
      .update(workflowExecutionEvents)
      .set({ status: LogStatus.RUNNING, completedAt: null, output: null })
      .where(eq(workflowExecutionEvents.workflowExecutionId, runId));

    await service.performCleanup();

    expect((await stepOf(runId, firstNode)).status).toBe(
      WorkflowStepStatus.SUCCEEDED,
    );
    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({
        status: LogStatus.SUCCESS,
        output: JSON.stringify("done"),
        completedAt: expect.any(Date),
      }),
    ]);
  });

  it("finishes a telemetry row with no step, which only the old executor wrote", async () => {
    const { runId, firstEvent } = await startStuckRun();
    await timeOutRunRowOnly(runId, new Date());
    await db
      .delete(workflowStepRuns)
      .where(eq(workflowStepRuns.workflowExecutionId, runId));
    await db
      .update(jobs)
      .set({ metadata: {} })
      .where(eq(jobs.eventId, firstEvent));

    await service.performCleanup();

    expect(await telemetryOf(runId)).toEqual([
      expect.objectContaining({
        status: LogStatus.FAILURE,
        errorMessage: "Workflow run timed out",
      }),
    ]);
  });

  it("leaves a settled run alone", async () => {
    const { runId } = await startStuckRun();
    await service.performCleanup();
    const before = await snapshot(runId);

    await service.performCleanup();

    expect(await snapshot(runId)).toEqual(before);
  });

  it("carries on past a run it cannot settle", async () => {
    const errors = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const refused = await startStuckRun();
    const fine = await startStuckRun();
    await timeOutRunRowOnly(refused.runId, new Date());
    await timeOutRunRowOnly(fine.runId, new Date());
    await pool.query(
      `ALTER TABLE workflow_step_runs ADD CONSTRAINT test_refuse_one_run CHECK (workflow_execution_id <> ${refused.runId} OR status IN ('PENDING', 'DISPATCHED')) NOT VALID`,
    );
    try {
      await service.performCleanup();
    } finally {
      await pool.query(
        `ALTER TABLE workflow_step_runs DROP CONSTRAINT test_refuse_one_run`,
      );
    }

    expect((await stepOf(refused.runId, refused.firstNode)).status).toBe(
      WorkflowStepStatus.DISPATCHED,
    );
    expect((await stepOf(fine.runId, fine.firstNode)).status).toBe(
      WorkflowStepStatus.FAILED,
    );
    expect(errors).toHaveBeenCalled();
  });
});
