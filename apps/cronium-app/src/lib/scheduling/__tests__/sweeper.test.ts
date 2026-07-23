/**
 * @jest-environment node
 */

/**
 * Unit tests for the lease/timeout sweeper (sweeper.ts): expired-lease
 * handling per leaseLossPolicy (requeue with backoff while retry budget
 * remains, otherwise loud failure), unleased RUNNING jobs bounded by their
 * own timeout (+grace), stalled unleased CLAIMED jobs, and the at-most-once
 * guard — every write goes through the CAS state machine, and a job whose
 * real completion landed first (transition rejected/noop) is left alone.
 *
 * The db mock resolves the sweep's three SELECTs from a FIFO queue:
 * [expired leases, unleased RUNNING, stalled CLAIMED].
 */

const state = {
  selectResults: [] as unknown[][],
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  insertShouldReject: false,
};

jest.mock("@/server/db", () => {
  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = jest.fn(() => chain);
    chain.where = jest.fn(() => chain);
    chain.limit = jest.fn(() =>
      Promise.resolve(state.selectResults.shift() ?? []),
    );
    return chain;
  };
  return {
    db: {
      select: jest.fn(() => makeSelectChain()),
      insert: jest.fn((table: unknown) => ({
        values: jest.fn((values: Record<string, unknown>) => {
          state.inserts.push({ table, values });
          return state.insertShouldReject
            ? Promise.reject(new Error("incident insert failed"))
            : Promise.resolve(undefined);
        }),
      })),
    },
  };
});

jest.mock("@/server/storage", () => ({
  storage: { updateLog: jest.fn() },
}));

jest.mock("../job-transition", () => ({
  transitionJob: jest.fn(),
}));

jest.mock("@/lib/services/retry-policy", () => ({
  computeRetryBackoffMs: jest.fn(() => 5000),
}));

import {
  runSweepTick,
  TIMEOUT_GRACE_MS,
  DEFAULT_TIMEOUT_MS,
  CLAIM_STALL_MS,
} from "../sweeper";
import { transitionJob } from "../job-transition";
import { storage } from "@/server/storage";
import { computeRetryBackoffMs } from "@/lib/services/retry-policy";
import {
  scheduleIncidents,
  JobStatus,
  LeaseLossPolicy,
  LogStatus,
  ScheduleIncidentKind,
  type Job,
} from "@/shared/schema";

const mockTransition = transitionJob as jest.Mock;
const mockUpdateLog = storage.updateLog as jest.Mock;
const mockBackoff = computeRetryBackoffMs as jest.Mock;

const NOW = new Date("2026-07-22T12:00:00.000Z");

function makeJob(overrides: Record<string, unknown> = {}): Job {
  return {
    id: "job-1",
    eventId: 7,
    status: JobStatus.RUNNING,
    attempts: 0,
    maxAttempts: 2,
    leaseLossPolicy: LeaseLossPolicy.RETRY,
    orchestratorId: "orch-1",
    timeoutMs: 120000,
    startedAt: null,
    updatedAt: new Date(NOW.getTime() - 60000),
    payload: {},
    metadata: { logId: 42 },
    ...overrides,
  } as unknown as Job;
}

/** Script the three sweep SELECTs: expired leases, unleased RUNNING,
 * stalled CLAIMED. */
function enqueueSweep(
  expired: Job[] = [],
  running: Job[] = [],
  stalled: Job[] = [],
): void {
  state.selectResults = [expired, running, stalled];
}

const incidentInserts = () =>
  state.inserts.filter((i) => i.table === scheduleIncidents);

/** Options object of the nth transitionJob call. */
const transitionOpts = (n = 0) =>
  mockTransition.mock.calls[n]![2] as {
    actor: string;
    reason?: string;
    set?: Record<string, unknown>;
  };

beforeEach(() => {
  state.selectResults = [];
  state.inserts = [];
  state.insertShouldReject = false;
  mockTransition.mockReset().mockResolvedValue({ ok: true, job: {} });
  mockUpdateLog.mockReset().mockResolvedValue(undefined);
  mockBackoff.mockReset().mockReturnValue(5000);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("runSweepTick — nothing to sweep", () => {
  it("returns zero counters and writes nothing", async () => {
    enqueueSweep();

    const result = await runSweepTick(NOW);

    expect(result).toEqual({ requeued: 0, failed: 0, timedOut: 0 });
    expect(mockTransition).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
    expect(mockUpdateLog).not.toHaveBeenCalled();
  });
});

describe("runSweepTick — expired leases (a)", () => {
  it("requeues with backoff and attempt+1 while the retry budget remains", async () => {
    enqueueSweep([makeJob({ attempts: 0, maxAttempts: 2 })]);

    const result = await runSweepTick(NOW);

    expect(result).toEqual({ requeued: 1, failed: 0, timedOut: 0 });
    expect(mockTransition).toHaveBeenCalledTimes(1);
    expect(mockTransition.mock.calls[0]![0]).toBe("job-1");
    expect(mockTransition.mock.calls[0]![1]).toBe(JobStatus.QUEUED);

    const opts = transitionOpts();
    expect(opts.actor).toBe("sweeper");
    expect(opts.reason).toContain("Lease expired (owner orch-1");
    expect(opts.reason).toContain("retrying (attempt 1/2)");
    expect(opts.set).toMatchObject({
      orchestratorId: null,
      leaseExpiresAt: null,
      startedAt: null,
      attempts: 1,
    });
    // Backoff pushes scheduledFor into the future.
    expect(mockBackoff).toHaveBeenCalledWith(0);
    const scheduledFor = opts.set!.scheduledFor as Date;
    expect(scheduledFor).toBeInstanceOf(Date);
    expect(scheduledFor.getTime()).toBeGreaterThan(Date.now());

    // Loud: LEASE_LOST incident + log kept alive with the retry note.
    expect(incidentInserts()).toHaveLength(1);
    expect(incidentInserts()[0]!.values).toMatchObject({
      eventId: 7,
      kind: ScheduleIncidentKind.LEASE_LOST,
      details: expect.objectContaining({ jobId: "job-1", action: "requeued" }),
    });
    expect(mockUpdateLog).toHaveBeenCalledWith(42, {
      status: LogStatus.RUNNING,
      error: expect.stringContaining("retrying in 5s"),
    });
  });

  it("fails the job when the retry budget is exhausted", async () => {
    enqueueSweep([makeJob({ attempts: 2, maxAttempts: 2 })]);

    const result = await runSweepTick(NOW);

    expect(result).toEqual({ requeued: 0, failed: 1, timedOut: 0 });
    expect(mockTransition.mock.calls[0]![1]).toBe(JobStatus.FAILED);
    const opts = transitionOpts();
    expect(opts.set).toMatchObject({
      activeKey: null,
      result: { exitCode: -1, error: expect.stringContaining("Lease expired") },
    });
    expect(opts.set!.completedAt).toBeInstanceOf(Date);

    expect(incidentInserts()[0]!.values).toMatchObject({
      kind: ScheduleIncidentKind.LEASE_LOST,
      details: expect.objectContaining({ action: "failed" }),
    });
    // finalizeLog: the execution log is closed as a failure.
    expect(mockUpdateLog).toHaveBeenCalledWith(42, {
      status: LogStatus.FAILURE,
      endTime: expect.any(Date),
      error: expect.stringContaining("Lease expired"),
    });
  });

  it("fails immediately under the FAIL lease-loss policy even with budget left", async () => {
    enqueueSweep([
      makeJob({
        attempts: 0,
        maxAttempts: 3,
        leaseLossPolicy: LeaseLossPolicy.FAIL,
      }),
    ]);

    const result = await runSweepTick(NOW);

    expect(result).toEqual({ requeued: 0, failed: 1, timedOut: 0 });
    expect(mockTransition.mock.calls[0]![1]).toBe(JobStatus.FAILED);
  });

  it("counts nothing when the CAS transition loses (real completion landed first)", async () => {
    mockTransition.mockResolvedValue({
      ok: false,
      current: JobStatus.COMPLETED,
      error: "Illegal transition",
    });
    enqueueSweep([makeJob({ attempts: 0 })]);

    const result = await runSweepTick(NOW);

    expect(result).toEqual({ requeued: 0, failed: 0, timedOut: 0 });
    expect(incidentInserts()).toHaveLength(0);
    expect(mockUpdateLog).not.toHaveBeenCalled();
  });

  it("counts nothing on a same-status no-op outcome", async () => {
    mockTransition.mockResolvedValue({ ok: true, job: {}, noop: true });
    enqueueSweep([makeJob({ attempts: 2, maxAttempts: 2 })]);

    const result = await runSweepTick(NOW);

    expect(result).toEqual({ requeued: 0, failed: 0, timedOut: 0 });
    expect(incidentInserts()).toHaveLength(0);
  });

  it("names an unknown owner and survives a failing incident insert", async () => {
    state.insertShouldReject = true;
    enqueueSweep([
      makeJob({ attempts: 2, maxAttempts: 2, orchestratorId: null }),
    ]);

    const result = await runSweepTick(NOW);

    expect(result.failed).toBe(1);
    expect(transitionOpts().reason).toContain("owner unknown");
  });
});

describe("runSweepTick — unleased RUNNING timeouts (b)", () => {
  it("leaves a job alone while it is within its own timeout plus grace", async () => {
    // Deadline is exactly now: startedAt + timeout + grace == now → not swept.
    const startedAt = new Date(NOW.getTime() - 120000 - TIMEOUT_GRACE_MS);
    enqueueSweep([], [makeJob({ startedAt, timeoutMs: 120000 })]);

    const result = await runSweepTick(NOW);

    expect(result).toEqual({ requeued: 0, failed: 0, timedOut: 0 });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it("times out a job past its deadline and closes the log", async () => {
    const startedAt = new Date(NOW.getTime() - 120000 - TIMEOUT_GRACE_MS - 1);
    enqueueSweep([], [makeJob({ startedAt, timeoutMs: 120000 })]);

    const result = await runSweepTick(NOW);

    expect(result).toEqual({ requeued: 0, failed: 0, timedOut: 1 });
    expect(mockTransition).toHaveBeenCalledTimes(1);
    expect(mockTransition.mock.calls[0]![1]).toBe(JobStatus.TIMED_OUT);
    const opts = transitionOpts();
    expect(opts.actor).toBe("sweeper");
    expect(opts.reason).toBe(
      "Job exceeded its 120s timeout with no completion report",
    );
    expect(opts.set).toMatchObject({
      activeKey: null,
      result: { exitCode: -1, error: "Timeout" },
    });
    expect(mockUpdateLog).toHaveBeenCalledWith(42, {
      status: LogStatus.TIMEOUT,
      endTime: expect.any(Date),
      error: expect.stringContaining("120s timeout"),
    });
  });

  it("falls back to the historical default timeout for legacy rows", async () => {
    const overdue = new Date(
      NOW.getTime() - DEFAULT_TIMEOUT_MS - TIMEOUT_GRACE_MS - 1,
    );
    const fresh = new Date(NOW.getTime() - DEFAULT_TIMEOUT_MS);
    enqueueSweep(
      [],
      [
        makeJob({ id: "job-old", startedAt: overdue, timeoutMs: null }),
        makeJob({ id: "job-fresh", startedAt: fresh, timeoutMs: null }),
      ],
    );

    const result = await runSweepTick(NOW);

    expect(result.timedOut).toBe(1);
    expect(mockTransition).toHaveBeenCalledTimes(1);
    expect(mockTransition.mock.calls[0]![0]).toBe("job-old");
  });

  it("does not count a timeout when the CAS transition loses", async () => {
    mockTransition.mockResolvedValue({ ok: false, error: "gone" });
    const startedAt = new Date(NOW.getTime() - 120000 - TIMEOUT_GRACE_MS - 1);
    enqueueSweep([], [makeJob({ startedAt })]);

    const result = await runSweepTick(NOW);

    expect(result.timedOut).toBe(0);
    expect(mockUpdateLog).not.toHaveBeenCalled();
  });
});

describe("runSweepTick — stalled CLAIMED jobs (c)", () => {
  it("treats a claim stalled past the grace as lease loss and requeues", async () => {
    enqueueSweep(
      [],
      [],
      [
        makeJob({
          status: JobStatus.CLAIMED,
          attempts: 0,
          maxAttempts: 1,
          updatedAt: new Date(NOW.getTime() - CLAIM_STALL_MS - 1000),
        }),
      ],
    );

    const result = await runSweepTick(NOW);

    expect(result).toEqual({ requeued: 1, failed: 0, timedOut: 0 });
    expect(mockTransition.mock.calls[0]![1]).toBe(JobStatus.QUEUED);
    expect(transitionOpts().reason).toContain(
      "Claimed by orch-1 but never started",
    );
  });

  it("fails a stalled claim with no retry budget", async () => {
    enqueueSweep(
      [],
      [],
      [makeJob({ status: JobStatus.CLAIMED, attempts: 1, maxAttempts: 1 })],
    );

    const result = await runSweepTick(NOW);

    expect(result).toEqual({ requeued: 0, failed: 1, timedOut: 0 });
    expect(mockTransition.mock.calls[0]![1]).toBe(JobStatus.FAILED);
  });
});

describe("runSweepTick — execution log resolution", () => {
  it("prefers payload.executionLogId over metadata", async () => {
    enqueueSweep([
      makeJob({
        attempts: 2,
        maxAttempts: 2,
        payload: { executionLogId: 99 },
        metadata: { logId: 42 },
      }),
    ]);

    await runSweepTick(NOW);

    expect(mockUpdateLog).toHaveBeenCalledWith(99, expect.any(Object));
  });

  it("falls back to metadata.executionLogId before metadata.logId", async () => {
    enqueueSweep([
      makeJob({
        attempts: 2,
        maxAttempts: 2,
        payload: {},
        metadata: { executionLogId: 77, logId: 42 },
      }),
    ]);

    await runSweepTick(NOW);

    expect(mockUpdateLog).toHaveBeenCalledWith(77, expect.any(Object));
  });

  it("sweeps a job with no resolvable log id without touching logs", async () => {
    enqueueSweep([
      makeJob({ attempts: 2, maxAttempts: 2, payload: {}, metadata: {} }),
    ]);

    const result = await runSweepTick(NOW);

    expect(result.failed).toBe(1);
    expect(mockUpdateLog).not.toHaveBeenCalled();
  });

  it("still counts the sweep when the log write fails", async () => {
    mockUpdateLog.mockRejectedValue(new Error("log table locked"));
    enqueueSweep(
      [makeJob({ id: "job-f", attempts: 2, maxAttempts: 2 })],
      [
        makeJob({
          id: "job-t",
          startedAt: new Date(NOW.getTime() - 120000 - TIMEOUT_GRACE_MS - 1000),
        }),
      ],
      [],
    );

    const result = await runSweepTick(NOW);

    expect(result).toEqual({ requeued: 0, failed: 1, timedOut: 1 });
  });

  it("still requeues when the retry log note fails to write", async () => {
    mockUpdateLog.mockRejectedValue(new Error("log table locked"));
    enqueueSweep([makeJob({ attempts: 0, maxAttempts: 2 })]);

    const result = await runSweepTick(NOW);

    expect(result.requeued).toBe(1);
  });
});
