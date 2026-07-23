/**
 * @jest-environment node
 */
/**
 * Unit tests for the worker's in-process executor pool (worker-executor.ts).
 * The db, storage, job-transition, and in-process-executor boundaries are all
 * factory-mocked; the claim transaction runs against a chainable stub that
 * records the batch limit, the CLAIMED update, and the audit-row insert.
 */

jest.mock("@/server/db", () => ({
  db: {
    transaction: jest.fn(),
    update: jest.fn(),
    select: jest.fn(),
  },
}));
jest.mock("@/server/storage", () => ({
  storage: { getEventWithRelations: jest.fn() },
}));
jest.mock("../job-transition", () => ({ transitionJob: jest.fn() }));
jest.mock("@/lib/scheduler/in-process-executor", () => ({
  runInProcessJob: jest.fn(),
}));

import { db } from "@/server/db";
import { InProcessWorkerPool, hasDueInProcessJobs } from "../worker-executor";
import { storage } from "@/server/storage";
import { transitionJob } from "../job-transition";
import { runInProcessJob } from "@/lib/scheduler/in-process-executor";
import { JobStatus, JobType, type Job, type Event } from "@/shared/schema";

const mockDb = db as unknown as {
  transaction: jest.Mock;
  update: jest.Mock;
  select: jest.Mock;
};
const mockGetEvent = storage.getEventWithRelations as jest.Mock;
const mockTransition = transitionJob as jest.Mock;
const mockRun = runInProcessJob as jest.Mock;

const NOW = new Date("2026-07-20T10:00:00.000Z");
const event = { id: 1, userId: "u1" } as unknown as Event;

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    eventId: 1,
    type: JobType.TOOL_ACTION,
    status: JobStatus.QUEUED,
    timeoutMs: 5_000,
    cancelRequested: false,
    payload: null,
    priority: 1,
    ...overrides,
  } as unknown as Job;
}

interface TxCapture {
  limit?: number;
  updateSet?: Record<string, unknown>;
  insertValues?: Array<Record<string, unknown>>;
}

/** Prime db.transaction to return `rows` from the claim SELECT. */
function primeClaim(rows: Job[]): TxCapture {
  const capture: TxCapture = {};
  mockDb.transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: (n: number) => {
                  capture.limit = n;
                  return { for: () => Promise.resolve(rows) };
                },
              }),
            }),
          }),
        }),
        update: () => ({
          set: (values: Record<string, unknown>) => {
            capture.updateSet = values;
            return { where: () => Promise.resolve() };
          },
        }),
        insert: () => ({
          values: (values: Array<Record<string, unknown>>) => {
            capture.insertValues = values;
            return Promise.resolve();
          },
        }),
      }),
  );
  return capture;
}

/** Let the launched job promises run to completion (multiple await points). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

let errorSpy: jest.SpyInstance;
let logSpy: jest.SpyInstance;

beforeEach(() => {
  mockDb.transaction.mockReset();
  mockDb.update.mockReset();
  mockDb.select.mockReset();
  mockGetEvent.mockReset().mockResolvedValue(event);
  mockTransition.mockReset().mockResolvedValue({ ok: true });
  mockRun.mockReset().mockResolvedValue(undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
});

describe("claimAndRun", () => {
  it("claims due jobs, writes the lease, records audit rows, and dispatches execution", async () => {
    const jobA = makeJob({ id: "job-a", timeoutMs: 5_000 });
    const jobB = makeJob({ id: "job-b", timeoutMs: null as unknown as number });
    const capture = primeClaim([jobA, jobB]);
    const pool = new InProcessWorkerPool("w1", 10);

    const claimed = await pool.claimAndRun(NOW);

    expect(claimed).toBe(2);
    expect(capture.limit).toBe(10);
    expect(capture.updateSet).toMatchObject({
      status: JobStatus.CLAIMED,
      orchestratorId: "w1",
      updatedAt: NOW,
    });
    // Lease = now + max(timeouts, fallback 30s for the null one) + 60s slack.
    expect(capture.updateSet!.leaseExpiresAt).toEqual(
      new Date(NOW.getTime() + 30_000 + 60_000),
    );
    expect(capture.insertValues).toEqual([
      {
        jobId: "job-a",
        fromStatus: JobStatus.QUEUED,
        toStatus: JobStatus.CLAIMED,
        actor: "worker:w1",
      },
      {
        jobId: "job-b",
        fromStatus: JobStatus.QUEUED,
        toStatus: JobStatus.CLAIMED,
        actor: "worker:w1",
      },
    ]);

    await settle();
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenCalledWith(jobA, event, {});
    expect(mockRun).toHaveBeenCalledWith(jobB, event, {});
    expect(pool.activeCount).toBe(0);
  });

  it("forwards the payload input to the executor", async () => {
    const job = makeJob({
      payload: { input: { a: 1 } } as unknown as Job["payload"],
    });
    primeClaim([job]);
    const pool = new InProcessWorkerPool("w1");

    await pool.claimAndRun(NOW);
    await settle();

    expect(mockRun).toHaveBeenCalledWith(job, event, { a: 1 });
  });

  it("returns 0 without a db round-trip when the pool is at capacity", async () => {
    primeClaim([makeJob({ id: "job-a" })]);
    let releaseA!: () => void;
    mockRun.mockImplementation(
      () => new Promise<void>((resolve) => (releaseA = resolve)),
    );
    const pool = new InProcessWorkerPool("w1", 1);

    await pool.claimAndRun(NOW);
    await settle();
    expect(pool.activeCount).toBe(1);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    // No argument: also exercises the default `now` clock.
    const claimed = await pool.claimAndRun();
    expect(claimed).toBe(0);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    releaseA();
    await settle();
    expect(pool.activeCount).toBe(0);
  });

  it("shrinks the claim batch to the remaining capacity", async () => {
    const capture = primeClaim([makeJob({ id: "job-a" })]);
    let release!: () => void;
    mockRun.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const pool = new InProcessWorkerPool("w1", 3);

    await pool.claimAndRun(NOW);
    await settle();
    expect(capture.limit).toBe(3);

    const capture2 = primeClaim([]);
    await pool.claimAndRun(NOW);
    expect(capture2.limit).toBe(2);

    release();
    await settle();
  });

  it("cancels a job whose cancellation was requested before start, without executing it", async () => {
    const job = makeJob({ id: "job-c", cancelRequested: true });
    primeClaim([job]);
    const pool = new InProcessWorkerPool("w1");

    await pool.claimAndRun(NOW);
    await settle();

    expect(mockRun).not.toHaveBeenCalled();
    expect(mockTransition).toHaveBeenCalledWith(
      "job-c",
      JobStatus.CANCELLED,
      expect.objectContaining({
        actor: "worker:w1",
        reason: "Cancellation requested before start",
      }),
    );
    expect(pool.activeCount).toBe(0);
  });

  it("fails a job whose event no longer exists, without executing it", async () => {
    primeClaim([makeJob({ id: "job-d", eventId: 404 })]);
    mockGetEvent.mockResolvedValue(undefined);
    const pool = new InProcessWorkerPool("w1");

    await pool.claimAndRun(NOW);
    await settle();

    expect(mockRun).not.toHaveBeenCalled();
    expect(mockTransition).toHaveBeenCalledWith(
      "job-d",
      JobStatus.FAILED,
      expect.objectContaining({
        actor: "worker:w1",
        reason: "Event no longer exists",
        set: expect.objectContaining({ lastError: "Event no longer exists" }),
      }),
    );
  });

  it("marks a crashing job FAILED and keeps the pool alive for the next claim", async () => {
    primeClaim([makeJob({ id: "job-e" })]);
    mockRun.mockRejectedValue(new Error("executor blew up"));
    const pool = new InProcessWorkerPool("w1");

    await pool.claimAndRun(NOW);
    await settle();

    expect(mockTransition).toHaveBeenCalledWith(
      "job-e",
      JobStatus.FAILED,
      expect.objectContaining({
        reason: "executor blew up",
        set: expect.objectContaining({ lastError: "executor blew up" }),
      }),
    );
    expect(pool.activeCount).toBe(0);

    // The pool still claims and runs subsequent jobs.
    mockRun.mockResolvedValue(undefined);
    primeClaim([makeJob({ id: "job-f" })]);
    const claimed = await pool.claimAndRun(NOW);
    await settle();
    expect(claimed).toBe(1);
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-f" }),
      event,
      {},
    );
  });

  it("survives a crash even when the FAILED transition itself rejects", async () => {
    primeClaim([makeJob({ id: "job-g" })]);
    mockRun.mockRejectedValue(new Error("boom"));
    mockTransition.mockRejectedValue(new Error("db down"));
    const pool = new InProcessWorkerPool("w1");

    await expect(pool.claimAndRun(NOW)).resolves.toBe(1);
    await settle();
    expect(pool.activeCount).toBe(0);
  });
});

describe("extendLeases", () => {
  it("does nothing when no jobs are in flight", async () => {
    const pool = new InProcessWorkerPool("w1");
    await pool.extendLeases(NOW);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("extends the lease for in-flight jobs by the heartbeat window", async () => {
    primeClaim([makeJob({ id: "job-a" })]);
    let release!: () => void;
    mockRun.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    let updateSet: Record<string, unknown> | undefined;
    mockDb.update.mockImplementation(() => ({
      set: (values: Record<string, unknown>) => {
        updateSet = values;
        return { where: () => Promise.resolve() };
      },
    }));
    const pool = new InProcessWorkerPool("w1");
    await pool.claimAndRun(NOW);
    await settle();

    await pool.extendLeases(NOW);

    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(updateSet).toEqual({
      leaseExpiresAt: new Date(NOW.getTime() + 90_000),
      updatedAt: NOW,
    });

    release();
    await settle();
  });
});

describe("drain", () => {
  it("returns immediately when nothing is in flight", async () => {
    const pool = new InProcessWorkerPool("w1");
    await expect(pool.drain(10)).resolves.toBeUndefined();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("waits for in-flight jobs to finish", async () => {
    primeClaim([makeJob({ id: "job-a" })]);
    let release!: () => void;
    mockRun.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const pool = new InProcessWorkerPool("w1");
    await pool.claimAndRun(NOW);
    await settle();
    expect(pool.activeCount).toBe(1);

    let drained = false;
    // Small timeout so the losing race timer doesn't outlive the test run;
    // the job resolves far sooner, which is what the assertion checks.
    const drainPromise = pool.drain(200).then(() => {
      drained = true;
    });
    await settle();
    expect(drained).toBe(false);

    release();
    await drainPromise;
    expect(drained).toBe(true);
    expect(pool.activeCount).toBe(0);
  });

  it("gives up after the timeout when a job never finishes", async () => {
    primeClaim([makeJob({ id: "job-a" })]);
    mockRun.mockImplementation(() => new Promise<void>(() => undefined));
    const pool = new InProcessWorkerPool("w1");
    await pool.claimAndRun(NOW);
    await settle();

    const started = Date.now();
    await pool.drain(100);
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(pool.activeCount).toBe(1);
  });
});

describe("hasDueInProcessJobs", () => {
  function primeDueQuery(rows: Array<{ one: number }>): void {
    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    }));
  }

  it("is true when a due queued in-process job exists", async () => {
    primeDueQuery([{ one: 1 }]);
    await expect(hasDueInProcessJobs(NOW)).resolves.toBe(true);
  });

  it("is false when nothing is due (default clock)", async () => {
    primeDueQuery([]);
    await expect(hasDueInProcessJobs()).resolves.toBe(false);
  });
});
