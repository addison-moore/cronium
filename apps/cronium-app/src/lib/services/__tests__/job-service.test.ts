/**
 * Unit tests for JobService (src/lib/services/job-service.ts).
 *
 * The database is mocked at the drizzle boundary with a reusable chainable
 * query-builder mock; transitionJob is mocked and the interaction contract
 * (target status, actor, set payload) is asserted instead — its own CAS
 * semantics are covered by the scheduling suites.
 *
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Module mocks — physically first, before any imports (house pattern: the
// factories must be registered before the import chain pulls in @server/db,
// whose env validation crashes under jest).
// ---------------------------------------------------------------------------

jest.mock("@server/db", () => ({
  db: {
    insert: jest.fn(),
    select: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    transaction: jest.fn(),
    execute: jest.fn(),
  },
}));

// Same physical module as @server/db (both map to src/server/db); registered
// under the alias too so either specifier resolves to the mock.
jest.mock("@/server/db", () => ({
  db: {
    insert: jest.fn(),
    select: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    transaction: jest.fn(),
    execute: jest.fn(),
  },
}));

jest.mock("@server/storage", () => ({
  storage: {
    getLog: jest.fn(),
    updateLog: jest.fn(),
  },
}));

jest.mock("@/lib/scheduling/job-transition", () => ({
  transitionJob: jest.fn(),
}));

jest.mock("@/lib/websocket-broadcaster", () => ({
  getWebSocketBroadcaster: jest.fn(),
}));

// nanoid v5 is ESM-only (jest cannot parse it) and mocking it also makes
// generated job IDs deterministic.
jest.mock("nanoid", () => ({
  customAlphabet: () => () => "TESTNANOID12",
}));

import {
  JobService,
  DEFAULT_CLAIM_LEASE_MS,
  type CreateJobInput,
} from "../job-service";
import { db } from "@server/db";
import { storage } from "@server/storage";
import { transitionJob } from "@/lib/scheduling/job-transition";
import { getWebSocketBroadcaster } from "@/lib/websocket-broadcaster";
import {
  type Job,
  JobStatus,
  JobType,
  JobPriority,
  JobSource,
  LeaseLossPolicy,
  LogStatus,
  jobs as jobsTable,
  jobTransitions,
} from "@shared/schema";
import { eq, ne, and, isNull, lte, inArray } from "drizzle-orm";
import { RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS } from "../retry-policy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockDb = db as unknown as {
  insert: jest.Mock;
  select: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  transaction: jest.Mock;
  execute: jest.Mock;
};
const mockTransition = transitionJob as jest.Mock;
const mockStorage = storage as unknown as {
  getLog: jest.Mock;
  updateLog: jest.Mock;
};
const mockGetBroadcaster = getWebSocketBroadcaster as jest.Mock;

/**
 * Reusable chainable drizzle query mock: every builder method returns the
 * chain itself, and awaiting the chain resolves to `result`.
 */
type QueryChain = Record<string, jest.Mock> & PromiseLike<unknown>;

function chain(result: unknown = []): QueryChain {
  const c = {} as QueryChain;
  const methods = [
    "values",
    "returning",
    "from",
    "where",
    "orderBy",
    "limit",
    "offset",
    "set",
    "for",
    "groupBy",
    "$dynamic",
  ];
  for (const m of methods) {
    c[m] = jest.fn(() => c);
  }
  (c as { then: unknown }).then = (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return c;
}

/** Wire db.transaction to run its callback against a mock tx. */
function makeTx(opts: { eligible?: unknown[]; claimed?: unknown[] } = {}) {
  const selectChain = chain(opts.eligible ?? []);
  const updateChain = chain(opts.claimed ?? []);
  const insertChain = chain([]);
  const tx = {
    select: jest.fn(() => selectChain),
    update: jest.fn(() => updateChain),
    insert: jest.fn(() => insertChain),
  };
  mockDb.transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) =>
    cb(tx),
  );
  return { tx, selectChain, updateChain, insertChain };
}

const NOW = new Date("2026-07-22T12:00:00.000Z");

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job_1",
    eventId: 1,
    userId: "user-1",
    type: JobType.SCRIPT,
    status: JobStatus.QUEUED,
    priority: JobPriority.NORMAL,
    payload: {},
    metadata: {},
    attempts: 0,
    maxAttempts: 0,
    orchestratorId: null,
    leaseExpiresAt: null,
    cancelRequested: false,
    activeKey: null,
    scheduledFor: NOW,
    startedAt: null,
    completedAt: null,
    result: null,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as unknown as Job;
}

/** Extract string params (e.g. JSON.stringify'd merge payloads) from a
 * drizzle sql`` template object. */
function sqlStringParams(sqlValue: unknown): string[] {
  const chunks = (sqlValue as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks
    .map((c) => (typeof c === "string" ? c : (c as { value?: unknown })?.value))
    .filter((v): v is string => typeof v === "string");
}

let service: JobService;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
let logSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
  service = new JobService();
  mockGetBroadcaster.mockReturnValue({
    broadcastLogUpdate: jest
      .fn()
      .mockResolvedValue({ success: true, attempts: 1 }),
  });
  mockStorage.getLog.mockResolvedValue(null);
  mockStorage.updateLog.mockResolvedValue({
    status: LogStatus.SUCCESS,
    output: "out",
    error: null,
    endTime: NOW,
    duration: 1000,
  });
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// createJob
// ---------------------------------------------------------------------------

describe("createJob", () => {
  const baseInput: CreateJobInput = {
    eventId: 7,
    userId: "user-1",
    type: JobType.SCRIPT,
    payload: { script: { type: "BASH" as never, content: "echo hi" } },
  };

  it("inserts a QUEUED job with generated id and defaults", async () => {
    const created = makeJob({ id: "job_TESTNANOID12" });
    const insertChain = chain([created]);
    mockDb.insert.mockReturnValueOnce(insertChain);

    const result = await service.createJob(baseInput);

    expect(mockDb.insert).toHaveBeenCalledWith(jobsTable);
    const values = insertChain.values.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(values).toEqual(
      expect.objectContaining({
        id: "job_TESTNANOID12",
        eventId: 7,
        userId: "user-1",
        type: JobType.SCRIPT,
        status: JobStatus.QUEUED,
        priority: JobPriority.NORMAL,
        payload: baseInput.payload,
        scheduledFor: NOW,
        metadata: {},
        attempts: 0,
        source: null,
        timeoutMs: null,
        maxAttempts: 0,
        activeKey: null,
        scheduledMiss: false,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    // leaseLossPolicy is omitted entirely when not provided so the column
    // default (RETRY) applies.
    expect(values).not.toHaveProperty("leaseLossPolicy");
    expect(result).toBe(created);
  });

  it("passes through explicit priority, schedule, metadata and kernel fields", async () => {
    const scheduledFor = new Date("2026-08-01T00:00:00.000Z");
    const insertChain = chain([makeJob()]);
    mockDb.insert.mockReturnValueOnce(insertChain);

    await service.createJob({
      ...baseInput,
      priority: JobPriority.CRITICAL,
      scheduledFor,
      metadata: { origin: "test" },
      source: JobSource.WORKFLOW_STEP,
      timeoutMs: 30_000,
      maxAttempts: 3,
      leaseLossPolicy: LeaseLossPolicy.FAIL,
      activeKey: "event:7",
      scheduledMiss: true,
    });

    const values = insertChain.values.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(values).toEqual(
      expect.objectContaining({
        priority: JobPriority.CRITICAL,
        scheduledFor,
        metadata: { origin: "test" },
        source: JobSource.WORKFLOW_STEP,
        timeoutMs: 30_000,
        maxAttempts: 3,
        leaseLossPolicy: LeaseLossPolicy.FAIL,
        activeKey: "event:7",
        scheduledMiss: true,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getJob
// ---------------------------------------------------------------------------

describe("getJob", () => {
  it("returns the job when found", async () => {
    const job = makeJob({ id: "job_x" });
    const selectChain = chain([job]);
    mockDb.select.mockReturnValueOnce(selectChain);

    const result = await service.getJob("job_x");

    expect(result).toBe(job);
    expect(selectChain.from).toHaveBeenCalledWith(jobsTable);
    expect(selectChain.where).toHaveBeenCalledWith(eq(jobsTable.id, "job_x"));
    expect(selectChain.limit).toHaveBeenCalledWith(1);
  });

  it("returns null when the job does not exist", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(service.getJob("missing")).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listJobs
// ---------------------------------------------------------------------------

describe("listJobs", () => {
  it("returns unfiltered jobs plus a real aggregate total", async () => {
    const rows = [makeJob({ id: "a" }), makeJob({ id: "b" })];
    const rowsChain = chain(rows);
    const countChain = chain([{ value: 42 }]);
    mockDb.select
      .mockReturnValueOnce(rowsChain)
      .mockReturnValueOnce(countChain);

    const result = await service.listJobs();

    expect(result).toEqual({ jobs: rows, total: 42 });
    expect(rowsChain.limit).toHaveBeenCalledWith(50);
    expect(rowsChain.offset).toHaveBeenCalledWith(0);
    expect(rowsChain.orderBy).toHaveBeenCalled();
    // No filters — neither query gets a where clause.
    expect(rowsChain.where).not.toHaveBeenCalled();
    expect(countChain.where).not.toHaveBeenCalled();
  });

  it("applies every filter branch and pagination to both queries", async () => {
    const rowsChain = chain([makeJob()]);
    const countChain = chain([{ value: 1 }]);
    mockDb.select
      .mockReturnValueOnce(rowsChain)
      .mockReturnValueOnce(countChain);

    const scheduledBefore = new Date("2026-07-22T13:00:00.000Z");
    const completedAfter = new Date("2026-07-21T00:00:00.000Z");
    const result = await service.listJobs(
      {
        status: JobStatus.RUNNING,
        orchestratorId: "orch-1",
        userId: "user-1",
        eventId: 9,
        priority: JobPriority.HIGH,
        scheduledBefore,
        completedAfter,
      },
      10,
      20,
    );

    expect(result.total).toBe(1);
    expect(rowsChain.limit).toHaveBeenCalledWith(10);
    expect(rowsChain.offset).toHaveBeenCalledWith(20);
    expect(rowsChain.where).toHaveBeenCalledTimes(1);
    expect(countChain.where).toHaveBeenCalledTimes(1);
    // Both queries share the same condition set.
    expect(rowsChain.where.mock.calls[0]![0]).toEqual(
      countChain.where.mock.calls[0]![0],
    );
  });

  it("supports a status array (OR of statuses)", async () => {
    const rowsChain = chain([]);
    const countChain = chain([{ value: 0 }]);
    mockDb.select
      .mockReturnValueOnce(rowsChain)
      .mockReturnValueOnce(countChain);

    const result = await service.listJobs({
      status: [JobStatus.QUEUED, JobStatus.CLAIMED],
    });

    expect(result).toEqual({ jobs: [], total: 0 });
    expect(rowsChain.where).toHaveBeenCalledTimes(1);
  });

  it("returns total 0 when the count row is missing", async () => {
    mockDb.select.mockReturnValueOnce(chain([])).mockReturnValueOnce(chain([]));
    const result = await service.listJobs({ userId: "user-1" });
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateJob
// ---------------------------------------------------------------------------

describe("updateJob", () => {
  it("maps provided fields and coerces explicit undefined to null", async () => {
    const updated = makeJob({ id: "job_u" });
    const updateChain = chain([updated]);
    mockDb.update.mockReturnValueOnce(updateChain);

    const completedAt = new Date("2026-07-22T12:05:00.000Z");
    const result = await service.updateJob("job_u", {
      status: JobStatus.RUNNING,
      orchestratorId: undefined,
      startedAt: undefined,
      completedAt,
      result: { exitCode: 0 },
      attempts: 2,
      lastError: undefined,
      scheduledFor: undefined,
    });

    expect(result).toBe(updated);
    expect(mockDb.update).toHaveBeenCalledWith(jobsTable);
    const setArg = updateChain.set.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg).toEqual({
      updatedAt: NOW,
      status: JobStatus.RUNNING,
      orchestratorId: null,
      startedAt: null,
      completedAt,
      result: { exitCode: 0 },
      attempts: 2,
      lastError: null,
      // scheduledFor: undefined is skipped (guarded by truthiness)
    });
    expect(setArg).not.toHaveProperty("scheduledFor");
    expect(updateChain.where).toHaveBeenCalledWith(eq(jobsTable.id, "job_u"));
  });

  it("only touches updatedAt when no fields are given, and includes scheduledFor when set", async () => {
    const updateChain = chain([makeJob()]);
    mockDb.update.mockReturnValueOnce(updateChain);
    const scheduledFor = new Date("2026-07-23T00:00:00.000Z");

    await service.updateJob("job_u", { scheduledFor });

    expect(updateChain.set.mock.calls[0]![0]).toEqual({
      updatedAt: NOW,
      scheduledFor,
    });
  });

  it("returns null when the job does not exist", async () => {
    mockDb.update.mockReturnValueOnce(chain([]));
    await expect(
      service.updateJob("missing", { attempts: 1 }),
    ).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// claimJobs
// ---------------------------------------------------------------------------

describe("claimJobs", () => {
  it("claims eligible rows in one transaction: CAS to CLAIMED, lease + owner stamped, audit rows written", async () => {
    const claimedRows = [
      makeJob({ id: "job_a", status: JobStatus.CLAIMED }),
      makeJob({ id: "job_b", status: JobStatus.CLAIMED }),
    ];
    const { tx, selectChain, updateChain, insertChain } = makeTx({
      eligible: [{ id: "job_a" }, { id: "job_b" }],
      claimed: claimedRows,
    });

    const result = await service.claimJobs("orch-1", 5);

    expect(result).toBe(claimedRows);

    // Eligibility query: QUEUED, unowned, due, not an in-process type;
    // locked FOR UPDATE SKIP LOCKED and capped at the batch size.
    expect(selectChain.where).toHaveBeenCalledWith(
      and(
        eq(jobsTable.status, JobStatus.QUEUED),
        isNull(jobsTable.orchestratorId),
        lte(jobsTable.scheduledFor, NOW),
        ne(jobsTable.type, JobType.TOOL_ACTION),
        ne(jobsTable.type, JobType.HTTP_REQUEST),
      ),
    );
    expect(selectChain.limit).toHaveBeenCalledWith(5);
    expect(selectChain.for).toHaveBeenCalledWith("update", {
      skipLocked: true,
    });

    // Claim update: ownership + lease with the default duration.
    expect(tx.update).toHaveBeenCalledWith(jobsTable);
    expect(updateChain.set).toHaveBeenCalledWith({
      status: JobStatus.CLAIMED,
      orchestratorId: "orch-1",
      leaseExpiresAt: new Date(NOW.getTime() + DEFAULT_CLAIM_LEASE_MS),
      updatedAt: NOW,
    });
    expect(updateChain.where).toHaveBeenCalledWith(
      inArray(jobsTable.id, ["job_a", "job_b"]),
    );

    // Audit trail rows for each claimed job.
    expect(tx.insert).toHaveBeenCalledWith(jobTransitions);
    expect(insertChain.values).toHaveBeenCalledWith([
      {
        jobId: "job_a",
        fromStatus: JobStatus.QUEUED,
        toStatus: JobStatus.CLAIMED,
        actor: "orchestrator:orch-1",
      },
      {
        jobId: "job_b",
        fromStatus: JobStatus.QUEUED,
        toStatus: JobStatus.CLAIMED,
        actor: "orchestrator:orch-1",
      },
    ]);
  });

  it("returns [] without updating anything when nothing is eligible", async () => {
    const { tx } = makeTx({ eligible: [] });

    const result = await service.claimJobs("orch-1");

    expect(result).toEqual([]);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("honors a custom lease duration", async () => {
    const { updateChain } = makeTx({
      eligible: [{ id: "job_a" }],
      claimed: [makeJob({ id: "job_a", status: JobStatus.CLAIMED })],
    });

    await service.claimJobs("orch-2", 10, 120_000);

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseExpiresAt: new Date(NOW.getTime() + 120_000),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// heartbeatJobs
// ---------------------------------------------------------------------------

describe("heartbeatJobs", () => {
  it("short-circuits on an empty id list without touching the db", async () => {
    const result = await service.heartbeatJobs("orch-1", []);
    expect(result).toEqual({ extended: [], cancelRequested: [] });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("extends leases only for the caller's CLAIMED/RUNNING jobs and reports cancel requests", async () => {
    const updateChain = chain([
      { id: "job_a", cancelRequested: false },
      { id: "job_b", cancelRequested: true },
    ]);
    mockDb.update.mockReturnValueOnce(updateChain);

    const result = await service.heartbeatJobs(
      "orch-1",
      ["job_a", "job_b", "job_stolen"],
      90_000,
    );

    expect(result).toEqual({
      extended: ["job_a", "job_b"],
      cancelRequested: ["job_b"],
    });
    expect(updateChain.set).toHaveBeenCalledWith({
      leaseExpiresAt: new Date(NOW.getTime() + 90_000),
      updatedAt: NOW,
    });
    // Ownership + in-flight-state guard: jobs owned by someone else or in a
    // terminal state are simply not matched.
    expect(updateChain.where).toHaveBeenCalledWith(
      and(
        inArray(jobsTable.id, ["job_a", "job_b", "job_stolen"]),
        eq(jobsTable.orchestratorId, "orch-1"),
        inArray(jobsTable.status, [JobStatus.CLAIMED, JobStatus.RUNNING]),
      ),
    );
  });

  it("returns empty sets when no rows matched (lease lost / wrong owner)", async () => {
    mockDb.update.mockReturnValueOnce(chain([]));
    const result = await service.heartbeatJobs("orch-1", ["job_a"]);
    expect(result).toEqual({ extended: [], cancelRequested: [] });
  });
});

// ---------------------------------------------------------------------------
// startJob / completeJob / failJob / cancelJob
// ---------------------------------------------------------------------------

describe("startJob", () => {
  it("transitions to RUNNING with startedAt and returns the job", async () => {
    const running = makeJob({ status: JobStatus.RUNNING });
    mockTransition.mockResolvedValueOnce({ ok: true, job: running });

    const result = await service.startJob("job_1", "orchestrator:orch-1");

    expect(result).toBe(running);
    expect(mockTransition).toHaveBeenCalledWith("job_1", JobStatus.RUNNING, {
      actor: "orchestrator:orch-1",
      set: { startedAt: NOW },
    });
  });

  it("returns null when the CAS transition is rejected", async () => {
    mockTransition.mockResolvedValueOnce({
      ok: false,
      current: JobStatus.CANCELLED,
      error: "Illegal transition cancelled → running",
    });
    await expect(service.startJob("job_1")).resolves.toBeNull();
  });
});

describe("completeJob", () => {
  it("marks exitCode 0 with no error as COMPLETED and stores only minimal result data", async () => {
    const done = makeJob({ status: JobStatus.COMPLETED });
    mockTransition.mockResolvedValueOnce({ ok: true, job: done });

    const result = await service.completeJob("job_1", {
      exitCode: 0,
      output: "big output blob",
      metrics: { durationMs: 12 },
    });

    expect(result).toBe(done);
    expect(mockTransition).toHaveBeenCalledWith("job_1", JobStatus.COMPLETED, {
      actor: "app",
      set: {
        completedAt: NOW,
        result: { exitCode: 0, metrics: { durationMs: 12 } },
        activeKey: null,
      },
    });
    // Output never lands in jobs.result — it lives on the execution record.
    const set = (
      mockTransition.mock.calls[0]![2] as { set: { result: object } }
    ).set;
    expect(set.result).not.toHaveProperty("output");
  });

  it("marks a non-zero exit code as FAILED", async () => {
    mockTransition.mockResolvedValueOnce({
      ok: true,
      job: makeJob({ status: JobStatus.FAILED }),
    });
    await service.completeJob("job_1", { exitCode: 2 });
    expect(mockTransition).toHaveBeenCalledWith(
      "job_1",
      JobStatus.FAILED,
      expect.objectContaining({ actor: "app" }),
    );
  });

  it("marks exitCode 0 with an error as FAILED", async () => {
    mockTransition.mockResolvedValueOnce({
      ok: true,
      job: makeJob({ status: JobStatus.FAILED }),
    });
    await service.completeJob("job_1", { exitCode: 0, error: "boom" });
    expect(mockTransition.mock.calls[0]![1]).toBe(JobStatus.FAILED);
  });

  it("treats a missing result as failure and returns null on CAS rejection", async () => {
    mockTransition.mockResolvedValueOnce({ ok: false, error: "terminal" });
    const result = await service.completeJob("job_1", undefined, "worker:w1");
    expect(result).toBeNull();
    expect(mockTransition).toHaveBeenCalledWith("job_1", JobStatus.FAILED, {
      actor: "worker:w1",
      set: { completedAt: NOW, result: {}, activeKey: null },
    });
  });
});

describe("failJob", () => {
  it("returns null and skips the transition when the job is missing", async () => {
    mockDb.select.mockReturnValueOnce(chain([]));
    await expect(service.failJob("missing", "err")).resolves.toBeNull();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("transitions to FAILED, increments attempts and records the error", async () => {
    mockDb.select.mockReturnValueOnce(chain([makeJob({ attempts: 2 })]));
    const failed = makeJob({ status: JobStatus.FAILED, attempts: 3 });
    mockTransition.mockResolvedValueOnce({ ok: true, job: failed });

    const result = await service.failJob("job_1", "disk full", "worker:w1");

    expect(result).toBe(failed);
    expect(mockTransition).toHaveBeenCalledWith("job_1", JobStatus.FAILED, {
      actor: "worker:w1",
      reason: "disk full",
      set: {
        completedAt: NOW,
        lastError: "disk full",
        attempts: 3,
        result: { exitCode: 1 },
        activeKey: null,
      },
    });
  });

  it("treats null attempts as 0 and returns null when the CAS is rejected", async () => {
    mockDb.select.mockReturnValueOnce(
      chain([makeJob({ attempts: null as unknown as number })]),
    );
    mockTransition.mockResolvedValueOnce({ ok: false, error: "terminal" });

    await expect(service.failJob("job_1", "err")).resolves.toBeNull();
    expect(
      (mockTransition.mock.calls[0]![2] as { set: { attempts: number } }).set
        .attempts,
    ).toBe(1);
  });
});

describe("cancelJob", () => {
  it("always sets cancelRequested, then transitions to CANCELLED", async () => {
    const updateChain = chain([]);
    mockDb.update.mockReturnValueOnce(updateChain);
    const cancelled = makeJob({ status: JobStatus.CANCELLED });
    mockTransition.mockResolvedValueOnce({ ok: true, job: cancelled });

    const result = await service.cancelJob("job_1", "user:u1");

    expect(result).toBe(cancelled);
    expect(updateChain.set).toHaveBeenCalledWith({
      cancelRequested: true,
      updatedAt: NOW,
    });
    expect(updateChain.where).toHaveBeenCalledWith(eq(jobsTable.id, "job_1"));
    expect(mockTransition).toHaveBeenCalledWith("job_1", JobStatus.CANCELLED, {
      actor: "user:u1",
      set: { completedAt: NOW, activeKey: null },
    });
  });

  it("still records the cancel request when the job is already terminal (CAS rejected)", async () => {
    const updateChain = chain([]);
    mockDb.update.mockReturnValueOnce(updateChain);
    mockTransition.mockResolvedValueOnce({
      ok: false,
      current: JobStatus.COMPLETED,
      error: "Illegal transition completed → cancelled",
    });

    const result = await service.cancelJob("job_1");

    expect(result).toBeNull();
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ cancelRequested: true }),
    );
  });
});

// ---------------------------------------------------------------------------
// getJobStats
// ---------------------------------------------------------------------------

describe("getJobStats", () => {
  it("aggregates grouped counts: CLAIMED folds into running, TIMED_OUT into failed", async () => {
    const grouped = [
      { status: JobStatus.QUEUED, value: 2 },
      { status: JobStatus.CLAIMED, value: 3 },
      { status: JobStatus.RUNNING, value: 1 },
      { status: JobStatus.COMPLETED, value: 5 },
      { status: JobStatus.FAILED, value: 1 },
      { status: JobStatus.TIMED_OUT, value: 2 },
      { status: JobStatus.CANCELLED, value: 4 },
    ];
    const selectChain = chain(grouped);
    mockDb.select.mockReturnValueOnce(selectChain);

    const stats = await service.getJobStats();

    expect(stats).toEqual({
      total: 18,
      queued: 2,
      running: 4,
      completed: 5,
      failed: 3,
      cancelled: 4,
    });
    expect(selectChain.where).toHaveBeenCalledWith(undefined);
    expect(selectChain.groupBy).toHaveBeenCalledWith(jobsTable.status);
  });

  it("scopes to a user and zero-fills missing statuses", async () => {
    const selectChain = chain([{ status: JobStatus.QUEUED, value: 1 }]);
    mockDb.select.mockReturnValueOnce(selectChain);

    const stats = await service.getJobStats("user-1");

    expect(stats).toEqual({
      total: 1,
      queued: 1,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(selectChain.where).toHaveBeenCalledWith(
      eq(jobsTable.userId, "user-1"),
    );
  });
});

// ---------------------------------------------------------------------------
// updateJobStatus
// ---------------------------------------------------------------------------

describe("updateJobStatus", () => {
  it("passes non-terminal updates through the CAS without releasing the overlap slot", async () => {
    const running = makeJob({ status: JobStatus.RUNNING });
    mockTransition.mockResolvedValueOnce({ ok: true, job: running });
    const startedAt = new Date("2026-07-22T11:59:00.000Z");

    const result = await service.updateJobStatus(
      "job_1",
      JobStatus.RUNNING,
      { startedAt },
      "orchestrator:orch-1",
    );

    expect(result).toBe(running);
    const [, status, opts] = mockTransition.mock.calls[0]! as [
      string,
      JobStatus,
      { actor: string; set: Record<string, unknown> },
    ];
    expect(status).toBe(JobStatus.RUNNING);
    expect(opts.actor).toBe("orchestrator:orch-1");
    expect(opts.set).toEqual({ startedAt });
    expect(opts.set).not.toHaveProperty("activeKey");
    // No executionLogId — no log finalization or broadcast.
    expect(mockStorage.updateLog).not.toHaveBeenCalled();
  });

  it("releases activeKey and merges exitCode/metrics into result on terminal statuses", async () => {
    mockTransition.mockResolvedValueOnce({
      ok: true,
      job: makeJob({ status: JobStatus.COMPLETED }),
    });
    const completedAt = new Date("2026-07-22T12:01:00.000Z");

    await service.updateJobStatus("job_1", JobStatus.COMPLETED, {
      exitCode: 0,
      metrics: { cpuMs: 5 },
      completedAt,
    });

    const opts = mockTransition.mock.calls[0]![2] as {
      set: Record<string, unknown>;
    };
    expect(opts.set.activeKey).toBeNull();
    expect(opts.set.completedAt).toEqual(completedAt);
    // result is a jsonb-merge sql expression carrying the minimal payload.
    expect(opts.set.result).toBeDefined();
    expect(sqlStringParams(opts.set.result)).toContain(
      JSON.stringify({ exitCode: 0, metrics: { cpuMs: 5 } }),
    );
  });

  it("prefers a directly provided result object over exitCode/metrics", async () => {
    mockTransition.mockResolvedValueOnce({
      ok: true,
      job: makeJob({ status: JobStatus.COMPLETED }),
    });

    await service.updateJobStatus("job_1", JobStatus.COMPLETED, {
      result: { scriptOutput: { rows: [1, 2] } },
      exitCode: 0,
    });

    const opts = mockTransition.mock.calls[0]![2] as {
      set: Record<string, unknown>;
    };
    expect(sqlStringParams(opts.set.result)).toContain(
      JSON.stringify({ scriptOutput: { rows: [1, 2] } }),
    );
  });

  it("omits result entirely when there is nothing to record", async () => {
    mockTransition.mockResolvedValueOnce({
      ok: true,
      job: makeJob({ status: JobStatus.CANCELLED }),
    });

    await service.updateJobStatus("job_1", JobStatus.CANCELLED, {});

    const opts = mockTransition.mock.calls[0]![2] as {
      set: Record<string, unknown>;
    };
    expect(opts.set).not.toHaveProperty("result");
    expect(opts.set.activeKey).toBeNull();
  });

  it("returns null and warns when the CAS rejects a late/duplicate report", async () => {
    mockTransition.mockResolvedValueOnce({
      ok: false,
      current: JobStatus.CANCELLED,
      error: "Illegal transition cancelled → completed",
    });

    const result = await service.updateJobStatus("job_1", JobStatus.COMPLETED, {
      exitCode: 0,
    });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("rejected for job job_1"),
    );
    expect(mockStorage.updateLog).not.toHaveBeenCalled();
  });

  it("passes the error through as the transition reason", async () => {
    // FAILED consults getJob for the retry budget first; no budget here.
    mockDb.select.mockReturnValueOnce(chain([makeJob()]));
    mockTransition.mockResolvedValueOnce({
      ok: true,
      job: makeJob({ status: JobStatus.FAILED }),
    });

    await service.updateJobStatus("job_1", JobStatus.FAILED, {
      error: "exploded",
    });

    // No retry budget on the default job (getJob is only consulted for
    // FAILED, so prime it).
    const opts = mockTransition.mock.calls.at(-1)![2] as { reason?: string };
    expect(opts.reason).toBe("exploded");
  });

  describe("retry with backoff on FAILED", () => {
    it("requeues with exponential backoff when maxAttempts budget remains", async () => {
      // getJob inside maybeRequeueFailedJob
      mockDb.select.mockReturnValueOnce(
        chain([makeJob({ maxAttempts: 3, attempts: 1 })]),
      );
      const requeued = makeJob({ status: JobStatus.QUEUED, attempts: 2 });
      mockTransition.mockResolvedValueOnce({ ok: true, job: requeued });

      const result = await service.updateJobStatus("job_1", JobStatus.FAILED, {
        error: "flaky",
      });

      expect(result).toBe(requeued);
      // 5s * 2^1 = 10s backoff
      expect(mockTransition).toHaveBeenCalledTimes(1);
      expect(mockTransition).toHaveBeenCalledWith("job_1", JobStatus.QUEUED, {
        actor: "app",
        reason: "retry 2/3: flaky",
        set: {
          orchestratorId: null,
          startedAt: null,
          completedAt: null,
          leaseExpiresAt: null,
          attempts: 2,
          lastError: "flaky",
          scheduledFor: new Date(NOW.getTime() + RETRY_BASE_DELAY_MS * 2),
        },
      });
      // No FAILED finalization, no log finalization.
      expect(mockStorage.updateLog).not.toHaveBeenCalled();
    });

    it("caps the backoff at 5 minutes and honors legacy payload.retries", async () => {
      mockDb.select.mockReturnValueOnce(
        chain([
          makeJob({
            maxAttempts: 0,
            attempts: 10,
            payload: { retries: 20 },
          }),
        ]),
      );
      mockTransition.mockResolvedValueOnce({
        ok: true,
        job: makeJob({ status: JobStatus.QUEUED, attempts: 11 }),
      });

      await service.updateJobStatus("job_1", JobStatus.FAILED, {
        error: "still flaky",
      });

      const set = (
        mockTransition.mock.calls[0]![2] as {
          set: { scheduledFor: Date };
        }
      ).set;
      expect(set.scheduledFor).toEqual(
        new Date(NOW.getTime() + RETRY_MAX_DELAY_MS),
      );
    });

    it("records the retry on the execution log without finalizing it", async () => {
      mockDb.select.mockReturnValueOnce(
        chain([
          makeJob({
            maxAttempts: 2,
            attempts: 0,
            payload: { executionLogId: 55 },
          }),
        ]),
      );
      mockTransition.mockResolvedValueOnce({
        ok: true,
        job: makeJob({ status: JobStatus.QUEUED, attempts: 1 }),
      });

      await service.updateJobStatus("job_1", JobStatus.FAILED, {
        error: "flaky",
      });

      expect(mockStorage.updateLog).toHaveBeenCalledWith(55, {
        status: LogStatus.RUNNING,
        error: expect.stringContaining("Attempt 1 failed, retrying in 5s"),
      });
    });

    it("still returns the requeued job when the retry log write fails", async () => {
      mockDb.select.mockReturnValueOnce(
        chain([
          makeJob({
            maxAttempts: 2,
            attempts: 0,
            metadata: { executionLogId: 56 },
          }),
        ]),
      );
      const requeued = makeJob({ status: JobStatus.QUEUED, attempts: 1 });
      mockTransition.mockResolvedValueOnce({ ok: true, job: requeued });
      mockStorage.updateLog.mockRejectedValueOnce(new Error("db down"));

      const result = await service.updateJobStatus("job_1", JobStatus.FAILED, {
        error: "flaky",
      });

      expect(result).toBe(requeued);
      expect(errorSpy).toHaveBeenCalledWith(
        "[JobService] Failed to record retry on execution log:",
        expect.any(Error),
      );
    });

    it("finalizes as FAILED when the retry budget is exhausted", async () => {
      mockDb.select.mockReturnValueOnce(
        chain([makeJob({ maxAttempts: 2, attempts: 2 })]),
      );
      const failed = makeJob({ status: JobStatus.FAILED });
      mockTransition.mockResolvedValueOnce({ ok: true, job: failed });

      const result = await service.updateJobStatus("job_1", JobStatus.FAILED, {
        error: "fatal",
        exitCode: 1,
      });

      expect(result).toBe(failed);
      expect(mockTransition).toHaveBeenCalledTimes(1);
      expect(mockTransition.mock.calls[0]![1]).toBe(JobStatus.FAILED);
    });

    it("finalizes as FAILED when there is no budget at all (maxAttempts 0, no payload.retries)", async () => {
      mockDb.select.mockReturnValueOnce(
        chain([makeJob({ maxAttempts: 0, attempts: 0 })]),
      );
      mockTransition.mockResolvedValueOnce({
        ok: true,
        job: makeJob({ status: JobStatus.FAILED }),
      });

      await service.updateJobStatus("job_1", JobStatus.FAILED, {
        error: "fatal",
      });

      expect(mockTransition.mock.calls[0]![1]).toBe(JobStatus.FAILED);
    });

    it("falls through to FAILED when the requeue CAS is lost to a concurrent transition", async () => {
      mockDb.select.mockReturnValueOnce(
        chain([makeJob({ maxAttempts: 3, attempts: 0 })]),
      );
      // Requeue rejected (e.g. sweeper already moved the job)...
      mockTransition.mockResolvedValueOnce({
        ok: false,
        current: JobStatus.CANCELLED,
        error: "Illegal transition cancelled → queued",
      });
      // ...then the FAILED finalization is attempted and also rejected.
      mockTransition.mockResolvedValueOnce({
        ok: false,
        current: JobStatus.CANCELLED,
        error: "Illegal transition cancelled → failed",
      });

      const result = await service.updateJobStatus("job_1", JobStatus.FAILED, {
        error: "flaky",
      });

      expect(result).toBeNull();
      expect(mockTransition).toHaveBeenCalledTimes(2);
      expect(mockTransition.mock.calls[0]![1]).toBe(JobStatus.QUEUED);
      expect(mockTransition.mock.calls[1]![1]).toBe(JobStatus.FAILED);
    });

    it("skips the retry check when the job vanished", async () => {
      mockDb.select.mockReturnValueOnce(chain([]));
      mockTransition.mockResolvedValueOnce({
        ok: false,
        error: "Job job_1 not found",
      });

      const result = await service.updateJobStatus("job_1", JobStatus.FAILED, {
        error: "gone",
      });
      expect(result).toBeNull();
    });
  });

  describe("execution-log finalization and broadcast", () => {
    const broadcast = () =>
      (
        mockGetBroadcaster.mock.results[0]!.value as {
          broadcastLogUpdate: jest.Mock;
        }
      ).broadcastLogUpdate;

    it("finalizes the log with duration and broadcasts on COMPLETED", async () => {
      const startTime = new Date(NOW.getTime() - 8000);
      mockTransition.mockResolvedValueOnce({
        ok: true,
        job: makeJob({
          status: JobStatus.COMPLETED,
          payload: { executionLogId: 42 },
        }),
      });
      mockStorage.getLog.mockResolvedValueOnce({ id: 42, startTime });
      const updatedLog = {
        status: LogStatus.SUCCESS,
        output: "done",
        error: null,
        endTime: NOW,
        duration: 8000,
      };
      mockStorage.updateLog.mockResolvedValueOnce(updatedLog);

      const result = await service.updateJobStatus(
        "job_1",
        JobStatus.COMPLETED,
        {
          exitCode: 0,
          output: "done",
          executionDuration: 7500,
          setupDuration: 500,
        },
      );

      expect(result).not.toBeNull();
      expect(mockStorage.getLog).toHaveBeenCalledWith(42);
      expect(mockStorage.updateLog).toHaveBeenCalledWith(42, {
        status: LogStatus.SUCCESS,
        endTime: NOW,
        duration: 8000,
        output: "done",
        executionDuration: 7500,
        setupDuration: 500,
      });
      expect(broadcast()).toHaveBeenCalledWith(42, {
        status: updatedLog.status,
        output: updatedLog.output,
        error: updatedLog.error,
        endTime: updatedLog.endTime,
        duration: updatedLog.duration,
      });
    });

    it("reads executionLogId from metadata and leaves endTime/duration unset for non-terminal statuses", async () => {
      mockTransition.mockResolvedValueOnce({
        ok: true,
        job: makeJob({
          status: JobStatus.RUNNING,
          metadata: { executionLogId: 43 },
        }),
      });
      mockStorage.getLog.mockResolvedValueOnce({ id: 43, startTime: NOW });

      await service.updateJobStatus("job_1", JobStatus.RUNNING, {
        output: "partial",
      });

      expect(mockStorage.updateLog).toHaveBeenCalledWith(43, {
        status: LogStatus.RUNNING,
        endTime: undefined,
        duration: undefined,
        output: "partial",
      });
    });

    it("logs but survives a failed broadcast", async () => {
      mockTransition.mockResolvedValueOnce({
        ok: true,
        job: makeJob({
          status: JobStatus.COMPLETED,
          payload: { executionLogId: 44 },
        }),
      });
      mockGetBroadcaster.mockReturnValueOnce({
        broadcastLogUpdate: jest.fn().mockResolvedValue({
          success: false,
          attempts: 3,
          error: "socket closed",
        }),
      });

      const result = await service.updateJobStatus(
        "job_1",
        JobStatus.COMPLETED,
        { exitCode: 0 },
      );

      expect(result).not.toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Broadcast failed after 3 attempts"),
      );
    });

    it("notes a broadcast that needed retries", async () => {
      mockTransition.mockResolvedValueOnce({
        ok: true,
        job: makeJob({
          status: JobStatus.COMPLETED,
          payload: { executionLogId: 44 },
        }),
      });
      mockGetBroadcaster.mockReturnValueOnce({
        broadcastLogUpdate: jest
          .fn()
          .mockResolvedValue({ success: true, attempts: 2 }),
      });

      await service.updateJobStatus("job_1", JobStatus.COMPLETED, {
        exitCode: 0,
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Broadcast succeeded after 2 attempts"),
      );
    });

    it("survives a broadcaster that throws", async () => {
      mockTransition.mockResolvedValueOnce({
        ok: true,
        job: makeJob({
          status: JobStatus.COMPLETED,
          payload: { executionLogId: 45 },
        }),
      });
      mockGetBroadcaster.mockImplementationOnce(() => {
        throw new Error("no socket server");
      });

      const result = await service.updateJobStatus(
        "job_1",
        JobStatus.COMPLETED,
        { exitCode: 0 },
      );

      expect(result).not.toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        "[JobService] Error sending broadcast:",
        expect.any(Error),
      );
    });
  });

  describe("job status → log status mapping", () => {
    const finalizeWith = async (
      status: JobStatus,
      data?: Parameters<JobService["updateJobStatus"]>[2],
    ) => {
      // FAILED consults getJob for retry budget first; give it a job with none.
      if (status === JobStatus.FAILED) {
        mockDb.select.mockReturnValueOnce(chain([makeJob()]));
      }
      mockTransition.mockResolvedValueOnce({
        ok: true,
        job: makeJob({ status, payload: { executionLogId: 60 } }),
      });
      await service.updateJobStatus("job_1", status, data);
      const call = mockStorage.updateLog.mock.calls.at(-1)!;
      return (call[1] as { status: LogStatus }).status;
    };

    it("maps FAILED with exit code -1 to TIMEOUT", async () => {
      await expect(
        finalizeWith(JobStatus.FAILED, { exitCode: -1, error: "killed" }),
      ).resolves.toBe(LogStatus.TIMEOUT);
    });

    it("maps FAILED with a timeout-ish error message to TIMEOUT", async () => {
      await expect(
        finalizeWith(JobStatus.FAILED, {
          error: "Operation timed out after 30s",
        }),
      ).resolves.toBe(LogStatus.TIMEOUT);
    });

    it("maps plain FAILED to FAILURE", async () => {
      await expect(
        finalizeWith(JobStatus.FAILED, { error: "segfault", exitCode: 139 }),
      ).resolves.toBe(LogStatus.FAILURE);
    });

    it("maps COMPLETED with exit code >= 100 to PARTIAL (multi-server)", async () => {
      await expect(
        finalizeWith(JobStatus.COMPLETED, { exitCode: 101 }),
      ).resolves.toBe(LogStatus.PARTIAL);
    });

    it("maps COMPLETED to SUCCESS, CANCELLED to FAILURE, TIMED_OUT to TIMEOUT, QUEUED to PENDING", async () => {
      await expect(
        finalizeWith(JobStatus.COMPLETED, { exitCode: 0 }),
      ).resolves.toBe(LogStatus.SUCCESS);
      await expect(finalizeWith(JobStatus.CANCELLED)).resolves.toBe(
        LogStatus.FAILURE,
      );
      await expect(finalizeWith(JobStatus.TIMED_OUT)).resolves.toBe(
        LogStatus.TIMEOUT,
      );
      await expect(finalizeWith(JobStatus.QUEUED)).resolves.toBe(
        LogStatus.PENDING,
      );
    });
  });
});
