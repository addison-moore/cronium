/**
 * @jest-environment node
 */

/**
 * Unit tests for the CAS job state machine (job-transition.ts): every legal
 * edge succeeds and writes an audit row, every illegal edge is rejected, and
 * the compare-and-set guard (expectedFrom + row re-read under FOR UPDATE)
 * surfaces concurrent modifications as failures instead of silent success.
 *
 * The database is mocked at the driver boundary. State consts are declared
 * physically above the jest.mock factories, which close over them and read
 * them lazily at call time (house pattern; see
 * src/server/api/__tests__/trpc-authorization.test.ts).
 */

const state = {
  /** Row returned by the SELECT ... FOR UPDATE inside the transaction. */
  currentRow: null as Record<string, unknown> | null,
  /** Rows returned by UPDATE ... RETURNING. */
  updateReturning: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  updateSets: [] as Array<Record<string, unknown>>,
  txExecutes: 0,
  dbExecutes: 0,
};

jest.mock("@/server/db", () => {
  const makeTx = () => ({
    select: jest.fn(() => {
      const chain = {
        from: jest.fn(() => chain),
        where: jest.fn(() => chain),
        for: jest.fn(() =>
          Promise.resolve(state.currentRow ? [state.currentRow] : []),
        ),
      };
      return chain;
    }),
    update: jest.fn(() => {
      const chain = {
        set: jest.fn((values: Record<string, unknown>) => {
          state.updateSets.push(values);
          return chain;
        }),
        where: jest.fn(() => chain),
        returning: jest.fn(() => Promise.resolve(state.updateReturning)),
      };
      return chain;
    }),
    insert: jest.fn((table: unknown) => ({
      values: jest.fn((values: Record<string, unknown>) => {
        state.inserts.push({ table, values });
        return Promise.resolve(undefined);
      }),
    })),
    execute: jest.fn(() => {
      state.txExecutes++;
      return Promise.resolve(undefined);
    }),
  });
  return {
    db: {
      transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(makeTx()),
      ),
      insert: jest.fn((table: unknown) => ({
        values: jest.fn((values: Record<string, unknown>) => {
          state.inserts.push({ table, values });
          return Promise.resolve(undefined);
        }),
      })),
      execute: jest.fn(() => {
        state.dbExecutes++;
        return Promise.resolve(undefined);
      }),
    },
  };
});

jest.mock("@/lib/security/execution-token-revocation", () => ({
  revokeJobExecutionTokens: jest.fn(() => Promise.resolve(undefined)),
}));

import { transitionJob, recordJobCreated } from "../job-transition";
import { revokeJobExecutionTokens } from "@/lib/security/execution-token-revocation";
import { JobStatus, jobTransitions } from "@/shared/schema";

const mockRevoke = revokeJobExecutionTokens as jest.Mock;

const TERMINAL: JobStatus[] = [
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.TIMED_OUT,
  JobStatus.CANCELLED,
];
const NON_TERMINAL: JobStatus[] = [
  JobStatus.QUEUED,
  JobStatus.CLAIMED,
  JobStatus.RUNNING,
];
const ALL: JobStatus[] = [...NON_TERMINAL, ...TERMINAL];

/** Mirror of the legal edge set the module documents. */
const LEGAL_PAIRS: Array<[JobStatus, JobStatus]> = [
  [JobStatus.CLAIMED, JobStatus.QUEUED],
  [JobStatus.RUNNING, JobStatus.QUEUED],
  [JobStatus.QUEUED, JobStatus.CLAIMED],
  [JobStatus.QUEUED, JobStatus.RUNNING],
  [JobStatus.CLAIMED, JobStatus.RUNNING],
  ...NON_TERMINAL.flatMap((from) =>
    TERMINAL.map((to): [JobStatus, JobStatus] => [from, to]),
  ),
];

const isLegal = (from: JobStatus, to: JobStatus): boolean =>
  LEGAL_PAIRS.some(([f, t]) => f === from && t === to);

const ILLEGAL_PAIRS: Array<[JobStatus, JobStatus]> = ALL.flatMap((from) =>
  ALL.filter((to) => to !== from && !isLegal(from, to)).map(
    (to): [JobStatus, JobStatus] => [from, to],
  ),
);

function jobRow(status: JobStatus): Record<string, unknown> {
  return { id: "job-1", status, attempts: 0 };
}

const transitionInserts = () =>
  state.inserts.filter((i) => i.table === jobTransitions);

beforeEach(() => {
  state.currentRow = null;
  state.updateReturning = [];
  state.inserts = [];
  state.updateSets = [];
  state.txExecutes = 0;
  state.dbExecutes = 0;
  mockRevoke.mockClear().mockResolvedValue(undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("transitionJob — legal edges", () => {
  it.each(LEGAL_PAIRS)(
    "allows %s → %s, updates the row, and appends the audit row",
    async (from, to) => {
      state.currentRow = jobRow(from);
      state.updateReturning = [jobRow(to)];

      const outcome = await transitionJob("job-1", to, { actor: "tester" });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.noop).toBeUndefined();
      expect(outcome.job.status).toBe(to);

      // Status written atomically with updatedAt.
      expect(state.updateSets).toHaveLength(1);
      expect(state.updateSets[0]).toMatchObject({ status: to });
      expect(state.updateSets[0]!.updatedAt).toBeInstanceOf(Date);

      // Audit row (the outbox) records the exact edge.
      const audits = transitionInserts();
      expect(audits).toHaveLength(1);
      expect(audits[0]!.values).toEqual({
        jobId: "job-1",
        fromStatus: from,
        toStatus: to,
        actor: "tester",
        reason: null,
        data: null,
      });

      // pg_notify('job_changed') fired inside the transaction.
      expect(state.txExecutes).toBe(1);

      // Execution tokens are revoked exactly when the job turns terminal.
      if (TERMINAL.includes(to)) {
        expect(mockRevoke).toHaveBeenCalledWith("job-1");
      } else {
        expect(mockRevoke).not.toHaveBeenCalled();
      }
    },
  );

  it("records reason and structured data on the audit row and applies extra columns", async () => {
    state.currentRow = jobRow(JobStatus.QUEUED);
    state.updateReturning = [jobRow(JobStatus.CLAIMED)];

    const outcome = await transitionJob("job-1", JobStatus.CLAIMED, {
      actor: "orchestrator:o-1",
      reason: "claimed for execution",
      set: { orchestratorId: "o-1" },
      data: { leaseMs: 60000 },
    });

    expect(outcome.ok).toBe(true);
    expect(state.updateSets[0]).toMatchObject({
      status: JobStatus.CLAIMED,
      orchestratorId: "o-1",
    });
    expect(transitionInserts()[0]!.values).toMatchObject({
      actor: "orchestrator:o-1",
      reason: "claimed for execution",
      data: { leaseMs: 60000 },
    });
  });

  it("fails the CAS (no audit row, no notify) when RETURNING yields no row", async () => {
    // "Can't happen" under FOR UPDATE — but if it ever does (row deleted
    // mid-transaction, driver fault), returning ok with the stale pre-update
    // row would violate the CAS contract. It must fail like any lost race.
    const current = jobRow(JobStatus.QUEUED);
    state.currentRow = current;
    state.updateReturning = [];

    const outcome = await transitionJob("job-1", JobStatus.RUNNING, {
      actor: "worker:w-1",
    });

    expect(outcome).toEqual({
      ok: false,
      current: JobStatus.QUEUED,
      error: `Job job-1 was modified concurrently; transition ${JobStatus.QUEUED} → ${JobStatus.RUNNING} updated no row`,
    });
    expect(transitionInserts()).toHaveLength(0);
    expect(state.txExecutes).toBe(0);
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it("does not revoke tokens when a terminal transition loses the row", async () => {
    state.currentRow = jobRow(JobStatus.RUNNING);
    state.updateReturning = [];

    const outcome = await transitionJob("job-1", JobStatus.COMPLETED, {
      actor: "worker:w-1",
    });

    expect(outcome.ok).toBe(false);
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});

describe("transitionJob — illegal edges", () => {
  it.each(ILLEGAL_PAIRS)(
    "rejects %s → %s without writing anything",
    async (from, to) => {
      state.currentRow = jobRow(from);

      const outcome = await transitionJob("job-1", to, { actor: "tester" });

      expect(outcome).toEqual({
        ok: false,
        current: from,
        error: `Illegal transition ${from} → ${to}`,
      });
      expect(state.updateSets).toHaveLength(0);
      expect(transitionInserts()).toHaveLength(0);
      expect(state.txExecutes).toBe(0);
      expect(mockRevoke).not.toHaveBeenCalled();
    },
  );

  it("includes the reason in the rejection warning path", async () => {
    state.currentRow = jobRow(JobStatus.COMPLETED);

    const outcome = await transitionJob("job-1", JobStatus.RUNNING, {
      actor: "tester",
      reason: "late report",
    });

    expect(outcome.ok).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("transitionJob — compare-and-set guard", () => {
  it("fails when a concurrent actor already moved the job out of the expected state", async () => {
    // Caller believes the job is still CLAIMED (its lease expired), but an
    // orchestrator report moved it to RUNNING in between. RUNNING → QUEUED is
    // legal in general, so without expectedFrom this would silently requeue a
    // running job — the guard must reject it.
    state.currentRow = jobRow(JobStatus.RUNNING);
    state.updateReturning = [jobRow(JobStatus.QUEUED)];

    const outcome = await transitionJob("job-1", JobStatus.QUEUED, {
      actor: "sweeper",
      expectedFrom: [JobStatus.CLAIMED],
    });

    expect(outcome).toEqual({
      ok: false,
      current: JobStatus.RUNNING,
      error: `Illegal transition ${JobStatus.RUNNING} → ${JobStatus.QUEUED}`,
    });
    expect(state.updateSets).toHaveLength(0);
    expect(transitionInserts()).toHaveLength(0);
  });

  it("succeeds when the row still matches expectedFrom", async () => {
    state.currentRow = jobRow(JobStatus.CLAIMED);
    state.updateReturning = [jobRow(JobStatus.QUEUED)];

    const outcome = await transitionJob("job-1", JobStatus.QUEUED, {
      actor: "sweeper",
      expectedFrom: [JobStatus.CLAIMED],
    });

    expect(outcome.ok).toBe(true);
    expect(transitionInserts()).toHaveLength(1);
  });

  it("expectedFrom can only narrow, never widen, the legal source set", async () => {
    // COMPLETED is terminal; listing it in expectedFrom must not resurrect it.
    state.currentRow = jobRow(JobStatus.COMPLETED);

    const outcome = await transitionJob("job-1", JobStatus.RUNNING, {
      actor: "tester",
      expectedFrom: [JobStatus.COMPLETED],
    });

    expect(outcome.ok).toBe(false);
    expect(state.updateSets).toHaveLength(0);
    expect(transitionInserts()).toHaveLength(0);
  });
});

describe("transitionJob — same-status no-ops", () => {
  it("returns noop without any write when the status matches and no set is given", async () => {
    state.currentRow = jobRow(JobStatus.RUNNING);

    const outcome = await transitionJob("job-1", JobStatus.RUNNING, {
      actor: "worker:w-1",
    });

    expect(outcome).toEqual({
      ok: true,
      job: state.currentRow,
      noop: true,
    });
    expect(state.updateSets).toHaveLength(0);
    expect(transitionInserts()).toHaveLength(0);
    expect(state.txExecutes).toBe(0);
  });

  it("applies extra columns idempotently without recording a transition", async () => {
    state.currentRow = jobRow(JobStatus.RUNNING);
    const updated = { ...jobRow(JobStatus.RUNNING), progress: 50 };
    state.updateReturning = [updated];

    const outcome = await transitionJob("job-1", JobStatus.RUNNING, {
      actor: "worker:w-1",
      set: { lastError: null },
    });

    expect(outcome).toEqual({ ok: true, job: updated, noop: true });
    expect(state.updateSets).toHaveLength(1);
    expect(state.updateSets[0]).toMatchObject({ lastError: null });
    // No status column, no audit row, no notify.
    expect(state.updateSets[0]!.status).toBeUndefined();
    expect(transitionInserts()).toHaveLength(0);
    expect(state.txExecutes).toBe(0);
  });

  it("does not revoke tokens on a terminal same-status no-op", async () => {
    state.currentRow = jobRow(JobStatus.FAILED);
    state.updateReturning = [jobRow(JobStatus.FAILED)];

    const outcome = await transitionJob("job-1", JobStatus.FAILED, {
      actor: "sweeper",
      set: { lastError: "duplicate report" },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.noop).toBe(true);
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});

describe("transitionJob — missing job", () => {
  it("fails when the job row does not exist", async () => {
    state.currentRow = null;

    const outcome = await transitionJob("job-x", JobStatus.RUNNING, {
      actor: "tester",
    });

    expect(outcome).toEqual({ ok: false, error: "Job job-x not found" });
    expect(state.updateSets).toHaveLength(0);
    expect(transitionInserts()).toHaveLength(0);
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});

describe("recordJobCreated", () => {
  it("writes the birth audit row (NULL → QUEUED) and notifies claim loops", async () => {
    await recordJobCreated("job-9", "schedule", { eventId: 7 });

    const audits = transitionInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.values).toEqual({
      jobId: "job-9",
      fromStatus: null,
      toStatus: JobStatus.QUEUED,
      actor: "schedule",
      data: { eventId: 7 },
    });
    expect(state.dbExecutes).toBe(1);
  });

  it("defaults data to null", async () => {
    await recordJobCreated("job-9", "manual");

    expect(transitionInserts()[0]!.values).toMatchObject({ data: null });
  });
});
