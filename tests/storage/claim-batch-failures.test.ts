/**
 * What one job going wrong costs the rest of a claimed batch, and what a job's own
 * record says afterwards.
 *
 * Through the real claim and reporting routes on real Postgres, because the order
 * being tested is the order things commit in: a job's status commits in its own
 * transaction, its log is written afterwards, and the two can come apart. Failures
 * are real too. A job's log row is really gone, and a write that has to fail is
 * refused by a trigger on that one row, inside the real transaction.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { POST as completeRoute } from "@/app/api/internal/jobs/[jobId]/complete/route";
import { POST as failRoute } from "@/app/api/internal/jobs/[jobId]/fail/route";
import { PUT as statusRoute } from "@/app/api/internal/jobs/[jobId]/status/route";
import { POST as claimRoute } from "@/app/api/internal/jobs/claim/route";
import { PUT as executionUpdateRoute } from "@/app/api/internal/executions/[executionId]/update/route";
import { dispatchEventJob } from "@/lib/scheduling/dispatch";
import { runRetention } from "@/lib/scheduling/retention";
import { runSweepTick } from "@/lib/scheduling/sweeper";
import { runInProcessJob } from "@/lib/scheduler/in-process-executor";
import { encryptEnvVarValue } from "@/lib/security/field-secret";
import { jobService } from "@/lib/services/job-service";
import { db, pool } from "@/server/db";
import { storage } from "@/server/storage";
import {
  EventType,
  JobStatus,
  JobType,
  jobs,
  logs,
  LogStatus,
  UserRole,
  workflows,
} from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedEvent, seedExecution, seedJob, seedUser } from "./helpers/seed";

// A `testTimeout` on the Jest project has no effect, so without this these get 5s.
jest.setTimeout(120_000);

// There's no socket server here, and each log update would retry with backoff.
const mockBroadcastLogUpdate = jest.fn();
jest.mock("@/lib/websocket-broadcaster", () => ({
  getWebSocketBroadcaster: () => ({
    broadcastLogUpdate: (...args: unknown[]) =>
      mockBroadcastLogUpdate(...args) as unknown,
    broadcastExecutionUpdate: () =>
      Promise.resolve({ success: true, attempts: 1 }),
  }),
}));

// An outbound HTTP call isn't what's being tested, only whether it gets made.
const mockExecuteHttpEvent = jest.fn();
jest.mock("@/lib/scheduler/http-event-executor", () => ({
  executeHttpEvent: (...args: unknown[]) =>
    mockExecuteHttpEvent(...args) as unknown,
}));

const ORCHESTRATOR_KEY = "claim-failures-orchestrator-key";
const ORCHESTRATOR = "orch-claim-failures";
const MISSING_LOG = 999_999;
const COULD_NOT_PREPARE = "Could not prepare this job to run";

interface Delivered {
  id: string;
  capabilityToken: string;
  execution: { environment: Record<string, string> };
}

type JobRoute = (
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) => Promise<Response>;

function claim(batchSize = 10): Promise<Response> {
  return claimRoute(
    new NextRequest("http://localhost:5001/api/internal/jobs/claim", {
      method: "POST",
      headers: { authorization: `Bearer ${ORCHESTRATOR_KEY}` },
      body: JSON.stringify({ orchestratorId: ORCHESTRATOR, batchSize }),
    }),
  );
}

async function deliveredJobs(): Promise<Delivered[]> {
  const response = await claim();
  expect(response.status).toBe(200);
  const body = (await response.json()) as { jobs: Delivered[]; count: number };
  expect(body.count).toBe(body.jobs.length);
  return body.jobs;
}

const reportHeaders = (token: string) => ({
  "x-job-capability": token,
  "x-orchestrator-id": ORCHESTRATOR,
});

function report(
  route: JobRoute,
  method: "POST" | "PUT",
  job: Delivered,
  body: unknown,
): Promise<Response> {
  return route(
    new NextRequest(`http://localhost:5001/api/internal/jobs/${job.id}`, {
      method,
      headers: reportHeaders(job.capabilityToken),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId: job.id }) },
  );
}

const started = (job: Delivered) =>
  report(statusRoute, "PUT", job, { status: JobStatus.RUNNING });

const completed = (job: Delivered, stdout = "done") =>
  report(completeRoute, "POST", job, {
    status: "completed",
    exitCode: 0,
    output: { stdout, stderr: "" },
  });

const failedWithStderr = (job: Delivered, stderr: string) =>
  report(completeRoute, "POST", job, {
    status: "failed",
    exitCode: 3,
    output: { stdout: "", stderr },
  });

async function jobRow(id: string) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row!;
}

async function logRow(id: number) {
  const [row] = await db.select().from(logs).where(eq(logs.id, id));
  return row;
}

async function transitionReasons(id: string, to: JobStatus) {
  const { rows } = await pool.query<{ reason: string | null }>(
    `SELECT reason FROM job_transitions WHERE job_id = $1 AND to_status = $2`,
    [id, to],
  );
  return rows.map((row) => row.reason);
}

// Each refusal is one trigger on one row, so everything else in the same transaction
// and the same batch runs for real. The name is fixed: dropRefusals clears them all.
const REFUSALS = ["job_transitions", "logs"] as const;
const dropRefusals = async () => {
  for (const table of REFUSALS) {
    await pool.query(`DROP TRIGGER IF EXISTS test_refusal ON ${table}`);
  }
};

async function installRefusal(table: (typeof REFUSALS)[number], when: string) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_refuse_write() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'refused by the test'; END
    $$ LANGUAGE plpgsql`);
  await pool.query(`
    CREATE TRIGGER test_refusal BEFORE INSERT OR UPDATE ON ${table}
    FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION test_refuse_write()`);
}

/** The job's status can't change to FAILED. */
const refuseFailing = (jobId: string) =>
  installRefusal(
    "job_transitions",
    `NEW.job_id = '${jobId}' AND NEW.to_status = 'failed'`,
  );

/** The job's status can change, but its log can't be written. */
const refuseLogWrites = (logId: number) =>
  installRefusal("logs", `NEW.id = ${logId}`);

let owner: string;
let eventId: number;

const due = () => new Date(Date.now() - 1000);
const SCRIPT = { script: { type: EventType.BASH, content: "echo hi" } };

// Bound to another variable, so it fails authentication the way a value under a lost
// key does, without a key change.
const unpreparable = () => ({
  environment: { TOKEN: encryptEnvVarValue("x", eventId, "ANOTHER_VARIABLE") },
});

async function seedRun(
  payload: Record<string, unknown> = {},
  overrides: Partial<typeof jobs.$inferInsert> = {},
) {
  const log = await storage.createLog({
    eventId,
    status: LogStatus.PENDING,
    userId: owner,
  });
  const id = await seedJob(eventId, owner, {
    scheduledFor: due(),
    payload: { ...SCRIPT, executionLogId: log.id, ...payload },
    ...overrides,
  });
  await db.update(logs).set({ jobId: id }).where(eq(logs.id, log.id));
  return { id, logId: log.id };
}

const seedLoglessBadJob = (overrides: Partial<typeof jobs.$inferInsert> = {}) =>
  seedJob(eventId, owner, {
    scheduledFor: due(),
    payload: { ...SCRIPT, executionLogId: MISSING_LOG, ...unpreparable() },
    ...overrides,
  });

let errorSpy: jest.SpyInstance;

beforeAll(() => {
  process.env.CRONIUM_ORCHESTRATOR_KEY = ORCHESTRATOR_KEY;
});

beforeEach(async () => {
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  mockBroadcastLogUpdate.mockReset();
  mockBroadcastLogUpdate.mockResolvedValue({ success: true, attempts: 1 });
  await dropRefusals();
  await resetDatabase();
  owner = await seedUser({ role: UserRole.ADMIN });
  eventId = await seedEvent(owner);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await dropRefusals();
});

afterAll(async () => {
  delete process.env.CRONIUM_ORCHESTRATOR_KEY;
  await closePool();
});

describe("a claimed batch with a job that goes wrong", () => {
  it("delivers the rest when the job it can't prepare has no log, and they run", async () => {
    const good = await seedRun();
    const bad = await seedLoglessBadJob();

    const delivered = await deliveredJobs();

    expect(delivered.map((job) => job.id)).toEqual([good.id]);
    expect(delivered[0]!.capabilityToken).toBeTruthy();
    expect((await jobRow(good.id)).status).toBe(JobStatus.CLAIMED);

    expect(await jobRow(bad)).toMatchObject({
      status: JobStatus.FAILED,
      lastError: expect.stringContaining(COULD_NOT_PREPARE) as string,
      activeKey: null,
    });
    expect((await jobRow(bad)).completedAt).toBeInstanceOf(Date);

    // The rest of the batch is still the orchestrator's to run, to the end.
    expect((await started(delivered[0]!)).status).toBe(200);
    expect((await completed(delivered[0]!)).status).toBe(200);
    expect((await jobRow(good.id)).status).toBe(JobStatus.COMPLETED);
    expect(await logRow(good.logId)).toMatchObject({
      status: LogStatus.SUCCESS,
      output: "done",
    });
  });

  it("leaves the sweeper nothing to do to a job it delivered", async () => {
    const good = await seedRun();
    await seedLoglessBadJob();

    const [delivered] = await deliveredJobs();
    await jobService.heartbeatJobs(ORCHESTRATOR, [delivered!.id], 300_000);

    const sweep = await runSweepTick(new Date(Date.now() + 120_000));

    expect(sweep).toEqual({ requeued: 0, failed: 0, timedOut: 0 });
    expect((await jobRow(good.id)).status).toBe(JobStatus.CLAIMED);
  });

  it("fails every job it can't prepare, with or without a log, each with the reason", async () => {
    const noLogA = await seedLoglessBadJob();
    const withLog = await seedRun(unpreparable());
    const noLogB = await seedLoglessBadJob();
    const good = await seedRun();

    const delivered = await deliveredJobs();

    expect(delivered.map((job) => job.id)).toEqual([good.id]);
    for (const id of [noLogA, withLog.id, noLogB]) {
      const row = await jobRow(id);
      expect(row.status).toBe(JobStatus.FAILED);
      expect(row.lastError).toContain(COULD_NOT_PREPARE);
      expect(await transitionReasons(id, JobStatus.FAILED)).toEqual([
        expect.stringContaining(COULD_NOT_PREPARE),
      ]);
    }
    expect(await logRow(withLog.logId)).toMatchObject({
      status: LogStatus.FAILURE,
      error: expect.stringContaining(COULD_NOT_PREPARE) as string,
    });
  });

  it("answers 200 with no jobs when nothing in the batch could be prepared", async () => {
    const bad = await seedLoglessBadJob();

    expect(await deliveredJobs()).toEqual([]);

    expect((await jobRow(bad)).status).toBe(JobStatus.FAILED);
  });

  it("costs only that job when its status can't be written, and the lease recovers it", async () => {
    const stuck = await seedRun(unpreparable());
    const otherBad = await seedLoglessBadJob();
    const good = await seedRun();
    await refuseFailing(stuck.id);

    const delivered = await deliveredJobs();

    expect(delivered.map((job) => job.id)).toEqual([good.id]);
    expect((await jobRow(otherBad)).status).toBe(JobStatus.FAILED);

    // Nothing committed for this one, so it's still claimed and nobody is on it. The
    // orchestrator was never handed it, so it can't renew the lease.
    const row = await jobRow(stuck.id);
    expect(row.status).toBe(JobStatus.CLAIMED);
    expect(row.orchestratorId).toBe(ORCHESTRATOR);

    // The server log names the job, and not the query with its values.
    const logged = errorSpy.mock.calls.find(([first]) =>
      String(first).includes(`Could not finish failing job ${stuck.id}`),
    ) as string[] | undefined;
    expect(logged).toBeDefined();
    expect(logged![1]).toContain("refused by the test");
    expect(logged![1]).not.toMatch(/insert into|update "jobs"/i);

    await dropRefusals();
    await jobService.heartbeatJobs(ORCHESTRATOR, [good.id], 300_000);

    const sweep = await runSweepTick(
      new Date(row.leaseExpiresAt!.getTime() + 1),
    );

    expect(sweep.failed).toBe(1);
    expect(await jobRow(stuck.id)).toMatchObject({
      status: JobStatus.FAILED,
      lastError: expect.stringContaining("Lease expired") as string,
    });
    expect((await jobRow(good.id)).status).toBe(JobStatus.CLAIMED);
  });

  it("costs only the log when the log can't be written, and the job still says why", async () => {
    const bad = await seedRun(unpreparable());
    const good = await seedRun();
    await refuseLogWrites(bad.logId);

    const delivered = await deliveredJobs();

    expect(delivered.map((job) => job.id)).toEqual([good.id]);
    // Committed before the log write, so it isn't left claimed for a lease to expire.
    expect(await jobRow(bad.id)).toMatchObject({
      status: JobStatus.FAILED,
      lastError: expect.stringContaining(COULD_NOT_PREPARE) as string,
    });
    // No reporter is left to retry this write, so the log stays as it was.
    expect((await logRow(bad.logId))!.status).toBe(LogStatus.PENDING);
  });

  it("fails a job it can't mint a token for, and delivers the rest", async () => {
    // The one per-job reason minting refuses.
    const noUser = await seedUser({ id: "" });
    const event = await seedEvent(noUser);
    const unmintable = await seedJob(event, noUser, {
      scheduledFor: due(),
      payload: SCRIPT,
    });
    const good = await seedRun();

    const delivered = await deliveredJobs();

    expect(delivered.map((job) => job.id)).toEqual([good.id]);
    expect(await jobRow(unmintable)).toMatchObject({
      status: JobStatus.FAILED,
      lastError: expect.stringContaining(COULD_NOT_PREPARE) as string,
    });
  });

  it("requeues a job with retries left even with no log, and fails it when they run out", async () => {
    const bad = await seedLoglessBadJob({ maxAttempts: 1 });
    const good = await seedRun();

    expect((await deliveredJobs()).map((job) => job.id)).toEqual([good.id]);

    const waiting = await jobRow(bad);
    expect(waiting).toMatchObject({
      status: JobStatus.QUEUED,
      attempts: 1,
      orchestratorId: null,
      lastError: expect.stringContaining(COULD_NOT_PREPARE) as string,
    });
    expect(waiting.scheduledFor.getTime()).toBeGreaterThan(Date.now());
    expect(await deliveredJobs()).toEqual([]);

    await db.update(jobs).set({ scheduledFor: due() }).where(eq(jobs.id, bad));
    expect(await deliveredJobs()).toEqual([]);

    expect((await jobRow(bad)).status).toBe(JobStatus.FAILED);
  });

  it("fails several at once, so the rest don't wait on each in turn", async () => {
    const count = 3;
    for (let i = 0; i < count; i++) await seedRun(unpreparable());
    const good = await seedRun();

    // Holds each log broadcast until they've all arrived. One at a time, the first
    // would be held until the deadline, and the most ever in flight would be one.
    let inFlight = 0;
    let mostInFlight = 0;
    let release: () => void = () => undefined;
    const allArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockBroadcastLogUpdate.mockImplementation(async () => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      if (inFlight === count) release();
      await Promise.race([
        allArrived,
        new Promise((resolve) => setTimeout(resolve, 15_000)),
      ]);
      inFlight--;
      return { success: true, attempts: 1 };
    });

    const delivered = await deliveredJobs();

    expect(mostInFlight).toBe(count);
    expect(delivered.map((job) => job.id)).toEqual([good.id]);
  });
});

describe("reporting on a job whose log is gone", () => {
  async function deliveredWithoutItsLog() {
    const run = await seedRun();
    const [delivered] = await deliveredJobs();
    await storage.deleteLog(run.logId);
    return delivered!;
  }

  it("takes its status and completion, and a repeat of them, without a 500", async () => {
    const job = await deliveredWithoutItsLog();

    expect((await started(job)).status).toBe(200);
    expect((await jobRow(job.id)).status).toBe(JobStatus.RUNNING);

    expect((await completed(job)).status).toBe(200);
    const done = await jobRow(job.id);
    expect(done.status).toBe(JobStatus.COMPLETED);

    // The orchestrator stops at the first 200. A late duplicate is harmless too.
    expect((await completed(job)).status).toBe(200);
    expect((await jobRow(job.id)).status).toBe(JobStatus.COMPLETED);
  });

  it("keeps a failure's reason on the job", async () => {
    const job = await deliveredWithoutItsLog();

    const response = await failedWithStderr(job, "Traceback: it broke");

    expect(response.status).toBe(200);
    expect(await jobRow(job.id)).toMatchObject({
      status: JobStatus.FAILED,
      lastError: "Traceback: it broke",
    });
    expect(await transitionReasons(job.id, JobStatus.FAILED)).toEqual([
      "Traceback: it broke",
    ]);
  });

  it("takes a report on the fail route", async () => {
    const job = await deliveredWithoutItsLog();

    const response = await report(failRoute, "POST", job, {
      error: "could not start the container",
      timestamp: new Date().toISOString(),
    });

    expect(response.status).toBe(200);
    expect(await jobRow(job.id)).toMatchObject({
      status: JobStatus.FAILED,
      lastError: "could not start the container",
    });
  });

  it("takes the execution update that finishes it", async () => {
    const job = await deliveredWithoutItsLog();
    const executionId = await seedExecution(job.id, {
      status: JobStatus.RUNNING,
    });

    const response = await executionUpdateRoute(
      new NextRequest(
        `http://localhost:5001/api/internal/executions/${executionId}/update`,
        {
          method: "PUT",
          headers: reportHeaders(job.capabilityToken),
          body: JSON.stringify({
            status: JobStatus.COMPLETED,
            exitCode: 0,
            completedAt: new Date().toISOString(),
          }),
        },
      ),
      { params: Promise.resolve({ executionId }) },
    );

    expect(response.status).toBe(200);
    expect((await jobRow(job.id)).status).toBe(JobStatus.COMPLETED);
  });

  it("still runs a job the worker executes in process", async () => {
    mockExecuteHttpEvent.mockResolvedValue({
      exitCode: 0,
      stdout: "sent",
      stderr: "",
    });
    const id = await seedJob(eventId, owner, {
      type: JobType.HTTP_REQUEST,
      payload: { executionLogId: MISSING_LOG },
    });
    const event = await storage.getEvent(eventId);

    await runInProcessJob(await jobRow(id), event!);

    expect(mockExecuteHttpEvent).toHaveBeenCalledTimes(1);
    expect((await jobRow(id)).status).toBe(JobStatus.COMPLETED);
  });
});

describe("a log write that fails with the log still there", () => {
  it("answers 500 with the status committed, and the retry fills in the log", async () => {
    const run = await seedRun();
    const [job] = await deliveredJobs();
    await refuseLogWrites(run.logId);

    const refused = await completed(job!, "the output");

    // Unlike a missing log this can pass, so the reporter is told to try again.
    expect(refused.status).toBe(500);
    expect((await jobRow(run.id)).status).toBe(JobStatus.COMPLETED);
    expect((await logRow(run.logId))!.status).toBe(LogStatus.PENDING);

    await dropRefusals();
    const retried = await completed(job!, "the output");

    expect(retried.status).toBe(200);
    expect(await logRow(run.logId)).toMatchObject({
      status: LogStatus.SUCCESS,
      output: "the output",
    });
  });

  it("has the reason on the job from the first attempt", async () => {
    const run = await seedRun();
    const [job] = await deliveredJobs();
    await refuseLogWrites(run.logId);

    expect((await failedWithStderr(job!, "it broke")).status).toBe(500);

    expect(await jobRow(run.id)).toMatchObject({
      status: JobStatus.FAILED,
      lastError: "it broke",
    });
  });
});

describe("the reason on a job", () => {
  it("is the end of a long stderr, with all of it on the log and the transition", async () => {
    const run = await seedRun();
    const [job] = await deliveredJobs();
    const stderr = `${"noise\n".repeat(200_000)}ValueError: the real problem`;

    expect((await failedWithStderr(job!, stderr)).status).toBe(200);

    const { lastError } = await jobRow(run.id);
    expect(lastError!.length).toBeLessThanOrEqual(4001);
    expect(lastError).toMatch(/^….*ValueError: the real problem$/s);
    expect((await logRow(run.logId))!.error).toBe(stderr);
    expect(await transitionReasons(run.id, JobStatus.FAILED)).toEqual([stderr]);
  });

  it("isn't set on a job that completed", async () => {
    const run = await seedRun();
    await jobService.updateJobStatus(run.id, JobStatus.COMPLETED, {
      exitCode: 0,
      error: "a warning on the way to succeeding",
    });

    expect((await jobRow(run.id)).lastError).toBeNull();
  });
});

describe("the error object the orchestrator sends when a job can't start", () => {
  const CANNOT_START = "server details required for SSH execution";
  // types.ErrorDetails, as the Go client's UpdateJobStatus sends it.
  const couldNotStart = (job: Delivered) =>
    report(statusRoute, "PUT", job, {
      status: JobStatus.FAILED,
      details: {
        message: CANNOT_START,
        error: {
          type: "generic",
          code: "EXECUTION_ERROR",
          message: CANNOT_START,
          retryable: false,
        },
      },
    });

  it("gives its message to the job, the log and the transition, not its JSON", async () => {
    const run = await seedRun();
    const [job] = await deliveredJobs();

    expect((await couldNotStart(job!)).status).toBe(200);

    expect(await jobRow(run.id)).toMatchObject({
      status: JobStatus.FAILED,
      lastError: CANNOT_START,
    });
    expect((await logRow(run.logId))!.error).toBe(CANNOT_START);
    expect(await transitionReasons(run.id, JobStatus.FAILED)).toEqual([
      CANNOT_START,
    ]);
  });

  it("gives it to a retry's reason too", async () => {
    const run = await seedRun({}, { maxAttempts: 1 });
    const [job] = await deliveredJobs();

    expect((await couldNotStart(job!)).status).toBe(200);

    expect(await jobRow(run.id)).toMatchObject({
      status: JobStatus.QUEUED,
      lastError: CANNOT_START,
    });
    expect(await transitionReasons(run.id, JobStatus.QUEUED)).toEqual([
      `retry 1/1: ${CANNOT_START}`,
    ]);
  });
});

describe("how a log comes to be gone with its job still queued", () => {
  it("deleting a workflow takes the log of a step still in the queue", async () => {
    const [workflow] = await db
      .insert(workflows)
      .values({ userId: owner, name: "workflow" })
      .returning({ id: workflows.id });
    const event = await storage.getEventWithRelations(eventId);
    const { job, logId } = await dispatchEventJob(event!, {
      triggeredBy: "workflow",
      workflowId: workflow!.id,
    });

    await storage.deleteWorkflow(workflow!.id);

    expect(await logRow(logId!)).toBeUndefined();
    expect((await jobRow(job!.id)).status).toBe(JobStatus.QUEUED);

    const [delivered] = await deliveredJobs();
    expect(delivered!.id).toBe(job!.id);
    expect((await completed(delivered!)).status).toBe(200);
    expect((await jobRow(job!.id)).status).toBe(JobStatus.COMPLETED);
  });

  describe("retention", () => {
    const pastTheLogWindow = () => ({
      now: new Date(Date.now() + 91 * 86_400_000),
      windows: {
        jobs: 30,
        logs: 90,
        workflowExecutions: 0,
        scheduleIncidents: 0,
        toolActionLogs: 0,
        toolAuditLogs: 0,
        webhooks: 0,
      },
    });

    it("spares the log of a queued job it can match to that job", async () => {
      const event = await storage.getEventWithRelations(eventId);
      const { job, logId } = await dispatchEventJob(event!, {
        triggeredBy: "manual",
      });

      const { deleted } = await runRetention(pastTheLogWindow());

      expect(deleted.logs).toBe(0);
      expect(await logRow(logId!)).toBeDefined();
      expect((await jobRow(job!.id)).status).toBe(JobStatus.QUEUED);
    });

    it("takes one dispatch couldn't link to its job, and the job still runs", async () => {
      const event = await storage.getEventWithRelations(eventId);
      const { job, logId } = await dispatchEventJob(event!, {
        triggeredBy: "manual",
      });
      // What dispatch leaves if its best-effort link write fails. The job still finds
      // its log through its payload, but the guard reads the log's own job_id.
      await db.update(logs).set({ jobId: null }).where(eq(logs.id, logId!));

      const { deleted } = await runRetention(pastTheLogWindow());

      expect(deleted.logs).toBe(1);
      expect(await logRow(logId!)).toBeUndefined();
      expect((await jobRow(job!.id)).status).toBe(JobStatus.QUEUED);

      const [delivered] = await deliveredJobs();
      expect((await completed(delivered!)).status).toBe(200);
    });
  });
});
