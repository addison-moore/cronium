/**
 * @jest-environment node
 *
 * Unit tests for the event-sourced workflow engine. The engine's own logic
 * (edge evaluation, the advance() reducer, recovery, finalization) runs REAL;
 * the boundaries are faked: an in-memory table store stands in for Postgres
 * (drizzle's eq/and/inArray/lt are mocked to plain descriptors the store can
 * interpret against the real schema tables), and storage / dispatch /
 * authorization are jest mocks.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */

type Row = Record<string, any>;

interface FakeDbImpl {
  transaction: (fn: (tx: any) => Promise<any>) => Promise<any>;
  select: (projection?: Record<string, unknown>) => any;
  update: (table: unknown) => any;
  insert: (table: unknown) => any;
}

// Holder referenced lazily by the factory below; populated after imports.
const fakeDb: { impl: FakeDbImpl | null } = { impl: null };

jest.mock("@/server/db", () => ({
  db: {
    transaction: (fn: any) => fakeDb.impl!.transaction(fn),
    select: (...args: any[]) => fakeDb.impl!.select(...args),
    update: (table: any) => fakeDb.impl!.update(table),
    insert: (table: any) => fakeDb.impl!.insert(table),
  },
}));

jest.mock("@/server/storage", () => ({
  storage: {
    getWorkflow: jest.fn(),
    getWorkflowNodes: jest.fn(),
    getWorkflowConnections: jest.fn(),
    createWorkflowExecution: jest.fn(),
    createWorkflowLog: jest.fn(),
    createWorkflowExecutionEvent: jest.fn(),
    updateWorkflowExecutionEvent: jest.fn(),
    getEventWithRelations: jest.fn(),
  },
}));

jest.mock("@/server/security/resource-access", () => ({
  assertWorkflowGraphCapability: jest.fn(),
}));

jest.mock("../dispatch", () => ({
  dispatchEventJob: jest.fn(),
}));

const mockSettleTimedOutRun = jest.fn();
jest.mock("@/lib/services/workflow-cleanup-service", () => ({
  getCleanupService: () => ({
    settleTimedOutRun: (runId: number) => mockSettleTimedOutRun(runId),
  }),
}));

// Replace the SQL condition builders with plain descriptors the in-memory
// store can evaluate. Everything else (sql, relations, getTableColumns, ...)
// stays real so @/shared/schema loads unchanged.
jest.mock("drizzle-orm", () => {
  const actual = jest.requireActual("drizzle-orm");
  return {
    ...actual,
    eq: (column: any, value: any) => ({ __op: "eq", column, value }),
    and: (...conds: any[]) => ({ __op: "and", conds }),
    inArray: (column: any, values: any[]) => ({
      __op: "inArray",
      column,
      values,
    }),
    lt: (column: any, value: any) => ({ __op: "lt", column, value }),
    // Stays real, because the schema needs it, but remembers its parts so the store
    // can evaluate `column->>'key' = value`.
    sql: Object.assign((strings: TemplateStringsArray, ...values: any[]) => {
      const real = actual.sql(strings, ...values);
      real.__fakeText = strings.join("?");
      real.__fakeValues = values;
      return real;
    }, actual.sql),
  };
});

import { getTableColumns } from "drizzle-orm";
import {
  ConnectionType,
  JobStatus,
  LogStatus,
  WorkflowStepStatus,
  WorkflowTriggerType,
  jobs as jobsTable,
  workflowExecutionEvents,
  workflowExecutions,
  workflowStepRuns,
} from "@/shared/schema";
import { storage } from "@/server/storage";
import { assertWorkflowGraphCapability } from "@/server/security/resource-access";
import { dispatchEventJob } from "../dispatch";
import {
  MAX_DURATION_MS,
  advanceRunsForJob,
  advanceWorkflowRun,
  evaluateEdge,
  reconcileWorkflowRuns,
  resolveReadiness,
  settleTimedOutRunSteps,
  startWorkflowRun,
  type EdgeState,
} from "../workflow-engine";

// ---------------------------------------------------------------------------
// In-memory drizzle stand-in
// ---------------------------------------------------------------------------

const runsStore: Row[] = [];
const stepsStore: Row[] = [];
const jobsStore: Row[] = [];
const telemetryStore: Row[] = [];

const tableStores = new Map<unknown, Row[]>([
  [workflowExecutions, runsStore],
  [workflowStepRuns, stepsStore],
  [jobsTable, jobsStore],
  [workflowExecutionEvents, telemetryStore],
]);

const columnKeys = new Map<unknown, string>();
for (const table of [
  workflowExecutions,
  workflowStepRuns,
  jobsTable,
  workflowExecutionEvents,
]) {
  for (const [key, col] of Object.entries(getTableColumns(table as any))) {
    columnKeys.set(col, key);
  }
}

function fieldOf(row: Row, column: unknown): any {
  const key = columnKeys.get(column);
  if (!key) throw new Error("Unknown column in condition");
  return row[key];
}

function evalCond(cond: any, row: Row): boolean {
  if (!cond) return true;
  if (cond.__fakeText) {
    const key = /->>'(\w+)' = \?$/.exec(cond.__fakeText)?.[1];
    if (!key) throw new Error(`Unsupported SQL: ${String(cond.__fakeText)}`);
    const [column, value] = cond.__fakeValues;
    return String(fieldOf(row, column)?.[key]) === value;
  }
  switch (cond.__op) {
    case "eq":
      return fieldOf(row, cond.column) === cond.value;
    case "and":
      return cond.conds.every((c: any) => evalCond(c, row));
    case "inArray":
      return cond.values.includes(fieldOf(row, cond.column));
    case "lt":
      return fieldOf(row, cond.column) < cond.value;
    default:
      throw new Error(`Unsupported condition op: ${String(cond.__op)}`);
  }
}

let idSeq = 1;

function makeSelect(projection?: Record<string, unknown>) {
  let table: unknown;
  let cond: any;
  let limitN: number | undefined;
  const exec = (): Row[] => {
    const store = tableStores.get(table);
    if (!store) throw new Error("Select from unknown table");
    let rows = store.filter((r) => evalCond(cond, r));
    if (limitN !== undefined) rows = rows.slice(0, limitN);
    return rows.map((r) => {
      if (!projection) return { ...r };
      const out: Row = {};
      for (const [key, col] of Object.entries(projection)) {
        out[key] = fieldOf(r, col);
      }
      return out;
    });
  };
  const builder: any = {
    from(t: unknown) {
      table = t;
      return builder;
    },
    where(c: unknown) {
      cond = c;
      return builder;
    },
    limit(n: number) {
      limitN = n;
      return builder;
    },
    for() {
      return builder; // FOR UPDATE SKIP LOCKED — single-process no-op here
    },
    then(resolve: any, reject: any) {
      return Promise.resolve().then(exec).then(resolve, reject);
    },
  };
  return builder;
}

function makeUpdate(table: unknown) {
  return {
    set(values: Row) {
      return {
        where(cond: unknown) {
          const store = tableStores.get(table);
          if (!store) throw new Error("Update on unknown table");
          for (const row of store) {
            if (evalCond(cond, row)) Object.assign(row, values);
          }
          return Promise.resolve();
        },
      };
    },
  };
}

function makeInsert(table: unknown) {
  return {
    values(vals: Row | Row[]) {
      const store = tableStores.get(table);
      if (!store) throw new Error("Insert into unknown table");
      const rows = Array.isArray(vals) ? vals : [vals];
      for (const v of rows) {
        store.push({
          id: idSeq++,
          jobId: null,
          output: null,
          condition: null,
          error: null,
          startedAt: null,
          completedAt: null,
          executionEventId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...v,
        });
      }
      return Promise.resolve();
    },
  };
}

const txApi = {
  execute: () => Promise.resolve(), // SET LOCAL lock_timeout has nothing to bound here
  select: (projection?: Record<string, unknown>) => makeSelect(projection),
  update: (table: unknown) => makeUpdate(table),
  insert: (table: unknown) => makeInsert(table),
};

fakeDb.impl = {
  transaction: (fn) => Promise.resolve(fn(txApi)),
  select: (projection?: Record<string, unknown>) => makeSelect(projection),
  update: (table: unknown) => makeUpdate(table),
  insert: (table: unknown) => makeInsert(table),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKFLOW_ID = 10;

const mockGetWorkflow = storage.getWorkflow as jest.Mock;
const mockNodes = storage.getWorkflowNodes as jest.Mock;
const mockConnections = storage.getWorkflowConnections as jest.Mock;
const mockCreateExecution = storage.createWorkflowExecution as jest.Mock;
const mockCreateLog = storage.createWorkflowLog as jest.Mock;
const mockCreateExecEvent = storage.createWorkflowExecutionEvent as jest.Mock;
const mockUpdateExecEvent = storage.updateWorkflowExecutionEvent as jest.Mock;
const mockGetEvent = storage.getEventWithRelations as jest.Mock;
const mockAssert = assertWorkflowGraphCapability as jest.Mock;
const mockDispatch = dispatchEventJob as jest.Mock;

let telemetryIdSeq = 500;

function seedRun(overrides: Row = {}): Row {
  const run: Row = {
    id: idSeq++,
    workflowId: WORKFLOW_ID,
    userId: "user-1",
    status: LogStatus.RUNNING,
    triggerType: WorkflowTriggerType.MANUAL,
    startedAt: new Date(Date.now() - 10_000),
    completedAt: null,
    totalDuration: null,
    totalEvents: 0,
    successfulEvents: 0,
    failedEvents: 0,
    executionData: { inputData: {} },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  runsStore.push(run);
  return run;
}

function seedStep(runId: number, overrides: Row = {}): Row {
  const step: Row = {
    id: idSeq++,
    workflowExecutionId: runId,
    nodeId: 1,
    eventId: 101,
    status: WorkflowStepStatus.PENDING,
    jobId: null,
    output: null,
    condition: null,
    error: null,
    startedAt: null,
    completedAt: null,
    executionEventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  stepsStore.push(step);
  return step;
}

function seedJob(overrides: Row = {}): Row {
  const job: Row = {
    id: `job-${idSeq++}`,
    eventId: 101,
    status: JobStatus.QUEUED,
    result: null,
    lastError: null,
    metadata: null,
    ...overrides,
  };
  jobsStore.push(job);
  return job;
}

function setGraph(
  nodes: Array<{ id: number; eventId: number }>,
  connections: Array<{
    sourceNodeId: number;
    targetNodeId: number;
    connectionType: ConnectionType;
  }> = [],
): void {
  mockNodes.mockResolvedValue(nodes);
  mockConnections.mockResolvedValue(
    connections.map((c, i) => ({
      id: 9000 + i,
      workflowId: WORKFLOW_ID,
      ...c,
    })),
  );
}

function stepRow(id: number): Row {
  const row = stepsStore.find((s) => s.id === id);
  if (!row) throw new Error(`step ${id} not found`);
  return row;
}

function runRow(id: number): Row {
  const row = runsStore.find((r) => r.id === id);
  if (!row) throw new Error(`run ${id} not found`);
  return row;
}

beforeEach(() => {
  runsStore.length = 0;
  stepsStore.length = 0;
  jobsStore.length = 0;
  jest.resetAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "log").mockImplementation(() => undefined);

  mockAssert.mockResolvedValue(undefined);
  mockGetWorkflow.mockResolvedValue({
    id: WORKFLOW_ID,
    userId: "owner-1",
    name: "wf",
  });
  setGraph([], []);
  mockGetEvent.mockImplementation((id: number) =>
    Promise.resolve({
      id,
      userId: "user-1",
      name: `event-${id}`,
      type: "BASH",
    }),
  );
  mockCreateLog.mockResolvedValue({ id: 1 });
  mockCreateExecEvent.mockImplementation(() =>
    Promise.resolve({ id: telemetryIdSeq++ }),
  );
  mockUpdateExecEvent.mockResolvedValue(undefined);
  mockCreateExecution.mockImplementation((data: Row) =>
    Promise.resolve(seedRun({ ...data })),
  );
  // Default dispatch: create a queued job row (with the step id stamped into
  // metadata, mirroring the real dispatcher) so replayed advances see it.
  mockDispatch.mockImplementation((event: Row, opts: Row) => {
    const job = seedJob({
      eventId: event.id,
      status: JobStatus.QUEUED,
      metadata: { workflowStepRunId: opts.workflowStepRunId },
    });
    return Promise.resolve({ job, logId: 42 });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("evaluateEdge", () => {
  const S = WorkflowStepStatus;
  const C = ConnectionType;
  const cases: Array<
    [WorkflowStepStatus, ConnectionType, boolean | null, EdgeState]
  > = [
    // Source still in flight → every edge is pending
    [S.PENDING, C.ON_SUCCESS, null, "pending"],
    [S.PENDING, C.ALWAYS, null, "pending"],
    [S.DISPATCHED, C.ON_FAILURE, null, "pending"],
    // Source succeeded
    [S.SUCCEEDED, C.ON_SUCCESS, null, "satisfied"],
    [S.SUCCEEDED, C.ALWAYS, null, "satisfied"],
    [S.SUCCEEDED, C.ON_FAILURE, null, "unsatisfiable"],
    [S.SUCCEEDED, C.ON_CONDITION, true, "satisfied"],
    [S.SUCCEEDED, C.ON_CONDITION, false, "unsatisfiable"],
    [S.SUCCEEDED, C.ON_CONDITION, null, "unsatisfiable"],
    // Source failed
    [S.FAILED, C.ON_FAILURE, null, "satisfied"],
    [S.FAILED, C.ALWAYS, null, "satisfied"],
    [S.FAILED, C.ON_SUCCESS, null, "unsatisfiable"],
    [S.FAILED, C.ON_CONDITION, true, "unsatisfiable"],
    // Source never ran → nothing downstream fires, including ALWAYS
    [S.SKIPPED, C.ALWAYS, null, "unsatisfiable"],
    [S.SKIPPED, C.ON_SUCCESS, null, "unsatisfiable"],
    [S.UNSATISFIABLE, C.ALWAYS, null, "unsatisfiable"],
  ];

  it.each(cases)(
    "source %s + edge %s (condition=%s) → %s",
    (status, connectionType, condition, expected) => {
      expect(evaluateEdge(connectionType, { status, condition })).toBe(
        expected,
      );
    },
  );

  it("falls back to pending for states outside the enum", () => {
    expect(
      evaluateEdge(ConnectionType.ALWAYS, {
        status: "BOGUS" as WorkflowStepStatus,
        condition: null,
      }),
    ).toBe("pending");
    // Unknown connection type on a succeeded source hits the defensive break
    expect(
      evaluateEdge("BOGUS" as ConnectionType, {
        status: WorkflowStepStatus.SUCCEEDED,
        condition: null,
      }),
    ).toBe("pending");
  });
});

describe("resolveReadiness", () => {
  it("treats a step with no incoming edges as a start node (ready)", () => {
    expect(resolveReadiness([])).toBe("ready");
  });

  it("is ready only when every edge is satisfied", () => {
    expect(resolveReadiness(["satisfied", "satisfied"])).toBe("ready");
    expect(resolveReadiness(["satisfied", "pending"])).toBe("waiting");
    expect(resolveReadiness(["pending"])).toBe("waiting");
  });

  it("is skipped when every edge is unsatisfiable", () => {
    expect(resolveReadiness(["unsatisfiable", "unsatisfiable"])).toBe(
      "skipped",
    );
  });

  it("is unsatisfiable on a mix of unsatisfiable and other edges", () => {
    expect(resolveReadiness(["satisfied", "unsatisfiable"])).toBe(
      "unsatisfiable",
    );
    expect(resolveReadiness(["pending", "unsatisfiable"])).toBe(
      "unsatisfiable",
    );
  });
});

// ---------------------------------------------------------------------------
// startWorkflowRun
// ---------------------------------------------------------------------------

describe("startWorkflowRun", () => {
  it("fails when the workflow does not exist", async () => {
    mockGetWorkflow.mockResolvedValue(undefined);
    const result = await startWorkflowRun(WORKFLOW_ID, {
      triggerType: WorkflowTriggerType.MANUAL,
    });
    expect(result).toEqual({
      success: false,
      output: `Workflow ${WORKFLOW_ID} not found`,
    });
    expect(runsStore).toHaveLength(0);
  });

  it("fails when the workflow has no nodes", async () => {
    setGraph([]);
    const result = await startWorkflowRun(WORKFLOW_ID, {
      triggerType: WorkflowTriggerType.MANUAL,
    });
    expect(result.success).toBe(false);
    expect(result.output).toBe("Workflow has no nodes");
  });

  it("fails on a fully cyclic graph (no start node)", async () => {
    setGraph(
      [
        { id: 1, eventId: 101 },
        { id: 2, eventId: 102 },
      ],
      [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          connectionType: ConnectionType.ALWAYS,
        },
        {
          sourceNodeId: 2,
          targetNodeId: 1,
          connectionType: ConnectionType.ALWAYS,
        },
      ],
    );
    const result = await startWorkflowRun(WORKFLOW_ID, {
      triggerType: WorkflowTriggerType.MANUAL,
    });
    expect(result.success).toBe(false);
    expect(result.output).toBe(
      "Workflow has no starting nodes (fully cyclic graph)",
    );
  });

  it("fails closed when the capability check rejects", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    mockAssert.mockRejectedValue(new Error("forbidden"));
    const result = await startWorkflowRun(WORKFLOW_ID, {
      triggerType: WorkflowTriggerType.MANUAL,
    });
    expect(result).toEqual({ success: false, output: "forbidden" });
    expect(stepsStore).toHaveLength(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("creates the run + step rows and dispatches the start node with the trigger input", async () => {
    setGraph(
      [
        { id: 1, eventId: 101 },
        { id: 2, eventId: 102 },
      ],
      [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          connectionType: ConnectionType.ON_SUCCESS,
        },
      ],
    );

    const result = await startWorkflowRun(WORKFLOW_ID, {
      triggerType: WorkflowTriggerType.WEBHOOK,
      input: { greeting: "hi" },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("RUNNING");
    const run = runRow(result.executionId!);
    // Defaults to the workflow owner when no user is passed
    expect(run.userId).toBe("owner-1");
    expect(mockAssert).toHaveBeenCalledWith(WORKFLOW_ID, "owner-1", "execute");

    const steps = stepsStore.filter((s) => s.workflowExecutionId === run.id);
    expect(steps).toHaveLength(2);
    const stepA = steps.find((s) => s.nodeId === 1)!;
    const stepB = steps.find((s) => s.nodeId === 2)!;

    // Start node claimed and dispatched; downstream still waiting
    expect(stepA.status).toBe(WorkflowStepStatus.DISPATCHED);
    expect(stepA.jobId).not.toBeNull();
    expect(stepB.status).toBe(WorkflowStepStatus.PENDING);

    // A start node is triggered by the run itself, not a connection: its
    // telemetry row records no connection type.
    expect(mockCreateExecEvent).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 1, connectionType: null }),
    );

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const [event, opts] = mockDispatch.mock.calls[0]!;
    expect(event.id).toBe(101);
    expect(opts).toMatchObject({
      triggeredBy: "workflow",
      input: { greeting: "hi" },
      workflowId: WORKFLOW_ID,
      workflowExecutionId: run.id,
      workflowStepRunId: stepA.id,
      actor: `workflow-engine:${run.id}`,
      authorizedUserId: "owner-1",
    });

    // Run stays RUNNING while the step is in flight
    expect(run.status).toBe(LogStatus.RUNNING);
    expect(mockCreateLog).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: WORKFLOW_ID,
        message: expect.stringContaining("started"),
      }),
    );
  });

  it("prefers the explicit userId over the workflow owner, and shrugs off a failed start log", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    // The "started" workflow log is best-effort; its failure must not abort
    mockCreateLog.mockRejectedValue(new Error("log db down"));
    const result = await startWorkflowRun(WORKFLOW_ID, {
      triggerType: WorkflowTriggerType.MANUAL,
      userId: "runner-9",
    });
    expect(result.success).toBe(true);
    expect(mockAssert).toHaveBeenCalledWith(WORKFLOW_ID, "runner-9", "execute");
    expect(mockCreateExecution).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "runner-9" }),
    );
  });
});

// ---------------------------------------------------------------------------
// advanceWorkflowRun — settling, branching, finalization
// ---------------------------------------------------------------------------

describe("advanceWorkflowRun", () => {
  it("is a no-op for a run that does not exist", async () => {
    await expect(advanceWorkflowRun(99_999)).resolves.toBeUndefined();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns early on an already-terminal run without touching steps", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    const run = seedRun({ status: LogStatus.SUCCESS });
    const step = seedStep(run.id); // would be dispatched if processed
    await advanceWorkflowRun(run.id);
    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.PENDING);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("settles a completed job into SUCCEEDED and dispatches the ON_SUCCESS successor with its output", async () => {
    setGraph(
      [
        { id: 1, eventId: 101 },
        { id: 2, eventId: 102 },
      ],
      [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          connectionType: ConnectionType.ON_SUCCESS,
        },
      ],
    );
    const run = seedRun();
    seedJob({
      id: "j1",
      eventId: 101,
      status: JobStatus.COMPLETED,
      result: { scriptOutput: { foo: "bar" }, condition: true },
    });
    const stepA = seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(Date.now() - 1000),
      executionEventId: 777,
    });
    const stepB = seedStep(run.id, { nodeId: 2, eventId: 102 });

    await advanceWorkflowRun(run.id);

    const a = stepRow(stepA.id);
    expect(a.status).toBe(WorkflowStepStatus.SUCCEEDED);
    expect(a.output).toEqual({ foo: "bar" });
    expect(a.condition).toBe(true);
    expect(a.completedAt).toBeInstanceOf(Date);

    // Telemetry dual-write for the settled step
    expect(mockUpdateExecEvent).toHaveBeenCalledWith(
      777,
      expect.objectContaining({ status: LogStatus.SUCCESS }),
    );

    const b = stepRow(stepB.id);
    expect(b.status).toBe(WorkflowStepStatus.DISPATCHED);
    expect(b.jobId).not.toBeNull();
    expect(b.executionEventId).not.toBeNull(); // telemetry row recorded
    // The telemetry row records the REAL triggering edge, not a hardcoded
    // ALWAYS
    expect(mockCreateExecEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 2,
        connectionType: ConnectionType.ON_SUCCESS,
      }),
    );

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const [event, opts] = mockDispatch.mock.calls[0]!;
    expect(event.id).toBe(102);
    // Predecessor object output passes through as the successor's input
    expect(opts.input).toEqual({ foo: "bar" });
    expect(opts.workflowStepRunId).toBe(stepB.id);
    expect(opts.authorizedUserId).toBe(run.userId);

    // Run still in flight
    expect(runRow(run.id).status).toBe(LogStatus.RUNNING);
  });

  it.each([
    [JobStatus.FAILED, "boom", "boom"],
    [JobStatus.FAILED, null, "Job failed"],
    [JobStatus.TIMED_OUT, null, "Job timed out"],
    [JobStatus.CANCELLED, null, "Job cancelled"],
  ])(
    "settles a %s job (lastError=%s) into FAILED with error %p and finalizes the run as FAILURE",
    async (jobStatus, lastError, expectedError) => {
      setGraph([{ id: 1, eventId: 101 }]);
      const run = seedRun();
      seedJob({ id: "j1", eventId: 101, status: jobStatus, lastError });
      const step = seedStep(run.id, {
        nodeId: 1,
        eventId: 101,
        status: WorkflowStepStatus.DISPATCHED,
        jobId: "j1",
        startedAt: new Date(),
      });

      await advanceWorkflowRun(run.id);

      expect(stepRow(step.id).status).toBe(WorkflowStepStatus.FAILED);
      expect(stepRow(step.id).error).toBe(expectedError);
      const run2 = runRow(run.id);
      expect(run2.status).toBe(LogStatus.FAILURE);
      expect(run2.failedEvents).toBe(1);
      expect(run2.successfulEvents).toBe(0);
    },
  );

  it("fails a step whose job row disappeared mid-run", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    const run = seedRun();
    const step = seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "ghost-job",
      startedAt: new Date(),
    });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.FAILED);
    expect(stepRow(step.id).error).toBe("Job record disappeared");
    expect(runRow(run.id).status).toBe(LogStatus.FAILURE);
  });

  it("leaves an in-flight job untouched and keeps the run RUNNING", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    const run = seedRun();
    seedJob({ id: "j1", eventId: 101, status: JobStatus.RUNNING });
    const step = seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
    });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.DISPATCHED);
    expect(runRow(run.id).status).toBe(LogStatus.RUNNING);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("skips the untaken branch and cascades the skip downstream in one advance", async () => {
    // 1 --ON_SUCCESS--> 2 ; 1 --ON_FAILURE--> 3 ; 3 --ALWAYS--> 4
    setGraph(
      [
        { id: 1, eventId: 101 },
        { id: 2, eventId: 102 },
        { id: 3, eventId: 103 },
        { id: 4, eventId: 104 },
      ],
      [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          connectionType: ConnectionType.ON_SUCCESS,
        },
        {
          sourceNodeId: 1,
          targetNodeId: 3,
          connectionType: ConnectionType.ON_FAILURE,
        },
        {
          sourceNodeId: 3,
          targetNodeId: 4,
          connectionType: ConnectionType.ALWAYS,
        },
      ],
    );
    const run = seedRun();
    seedJob({
      id: "j1",
      eventId: 101,
      status: JobStatus.COMPLETED,
      result: {},
    });
    seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
    });
    const step2 = seedStep(run.id, { nodeId: 2, eventId: 102 });
    const step3 = seedStep(run.id, { nodeId: 3, eventId: 103 });
    const step4 = seedStep(run.id, { nodeId: 4, eventId: 104 });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step2.id).status).toBe(WorkflowStepStatus.DISPATCHED);
    expect(stepRow(step3.id).status).toBe(WorkflowStepStatus.SKIPPED);
    expect(stepRow(step3.id).error).toBe(
      "Branch not taken (no incoming connection satisfied)",
    );
    // Fixpoint: the skip propagated through the ALWAYS edge in the same pass
    expect(stepRow(step4.id).status).toBe(WorkflowStepStatus.SKIPPED);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("marks conflicting incoming edges UNSATISFIABLE and finalizes the run as FAILURE", async () => {
    // Node 2 requires node 1 to both succeed and fail — impossible.
    setGraph(
      [
        { id: 1, eventId: 101 },
        { id: 2, eventId: 102 },
      ],
      [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          connectionType: ConnectionType.ON_SUCCESS,
        },
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          connectionType: ConnectionType.ON_FAILURE,
        },
      ],
    );
    const run = seedRun();
    seedJob({
      id: "j1",
      eventId: 101,
      status: JobStatus.COMPLETED,
      result: {},
    });
    seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
    });
    const step2 = seedStep(run.id, { nodeId: 2, eventId: 102 });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step2.id).status).toBe(WorkflowStepStatus.UNSATISFIABLE);
    expect(stepRow(step2.id).error).toBe(
      "Prerequisite connections can never all be satisfied",
    );
    // UNSATISFIABLE = conflicting edges = graph misconfiguration: the run
    // did NOT fully succeed, so it finalizes as FAILURE (a mere SKIPPED
    // branch would still be SUCCESS).
    const finalRun = runRow(run.id);
    expect(finalRun.status).toBe(LogStatus.FAILURE);
    expect(finalRun.successfulEvents).toBe(1);
    expect(finalRun.failedEvents).toBe(0);
    expect(mockCreateLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "1 succeeded, 0 failed, 0 skipped, 1 unsatisfiable",
        ),
      }),
    );
  });

  it.each([
    [true, WorkflowStepStatus.DISPATCHED],
    [false, WorkflowStepStatus.SKIPPED],
  ])(
    "ON_CONDITION with condition=%s leaves the target %s",
    async (condition, expectedStatus) => {
      setGraph(
        [
          { id: 1, eventId: 101 },
          { id: 2, eventId: 102 },
        ],
        [
          {
            sourceNodeId: 1,
            targetNodeId: 2,
            connectionType: ConnectionType.ON_CONDITION,
          },
        ],
      );
      const run = seedRun();
      seedJob({
        id: "j1",
        eventId: 101,
        status: JobStatus.COMPLETED,
        result: { condition },
      });
      seedStep(run.id, {
        nodeId: 1,
        eventId: 101,
        status: WorkflowStepStatus.DISPATCHED,
        jobId: "j1",
        startedAt: new Date(),
      });
      const step2 = seedStep(run.id, { nodeId: 2, eventId: 102 });

      await advanceWorkflowRun(run.id);

      expect(stepRow(step2.id).status).toBe(expectedStatus);
    },
  );

  it("fans out to every satisfied successor", async () => {
    setGraph(
      [
        { id: 1, eventId: 101 },
        { id: 2, eventId: 102 },
        { id: 3, eventId: 103 },
      ],
      [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          connectionType: ConnectionType.ON_SUCCESS,
        },
        {
          sourceNodeId: 1,
          targetNodeId: 3,
          connectionType: ConnectionType.ALWAYS,
        },
      ],
    );
    const run = seedRun();
    seedJob({
      id: "j1",
      eventId: 101,
      status: JobStatus.COMPLETED,
      result: {},
    });
    seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
    });
    const step2 = seedStep(run.id, { nodeId: 2, eventId: 102 });
    const step3 = seedStep(run.id, { nodeId: 3, eventId: 103 });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step2.id).status).toBe(WorkflowStepStatus.DISPATCHED);
    expect(stepRow(step3.id).status).toBe(WorkflowStepStatus.DISPATCHED);
    expect(mockDispatch).toHaveBeenCalledTimes(2);
    const eventIds = mockDispatch.mock.calls.map((c) => c[0].id).sort();
    expect(eventIds).toEqual([102, 103]);
  });

  it("skips a step whose only incoming edge dangles from a nonexistent node", async () => {
    setGraph(
      [{ id: 2, eventId: 102 }],
      [
        {
          sourceNodeId: 99, // no step row exists for this source
          targetNodeId: 2,
          connectionType: ConnectionType.ALWAYS,
        },
      ],
    );
    const run = seedRun();
    const step2 = seedStep(run.id, { nodeId: 2, eventId: 102 });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step2.id).status).toBe(WorkflowStepStatus.SKIPPED);
    expect(runRow(run.id).status).toBe(LogStatus.SUCCESS);
  });

  it("fails a ready step whose node was removed from the workflow", async () => {
    setGraph([{ id: 1, eventId: 101 }]); // node 99 no longer exists
    const run = seedRun();
    seedJob({
      id: "j1",
      eventId: 101,
      status: JobStatus.COMPLETED,
      result: {},
    });
    seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
    });
    const orphan = seedStep(run.id, { nodeId: 99, eventId: 199 });

    await advanceWorkflowRun(run.id);

    expect(stepRow(orphan.id).status).toBe(WorkflowStepStatus.FAILED);
    expect(stepRow(orphan.id).error).toBe(
      "Node 99 no longer exists in the workflow",
    );
    expect(runRow(run.id).status).toBe(LogStatus.FAILURE);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("finalizes an all-successful run with counts, duration and a workflow log", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    const startedAt = new Date(Date.now() - 60_000);
    const run = seedRun({ startedAt });
    seedJob({
      id: "j1",
      eventId: 101,
      status: JobStatus.COMPLETED,
      result: { scriptOutput: "done" },
    });
    seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
    });

    await advanceWorkflowRun(run.id);

    const finalRun = runRow(run.id);
    expect(finalRun.status).toBe(LogStatus.SUCCESS);
    expect(finalRun.completedAt).toBeInstanceOf(Date);
    expect(finalRun.totalDuration).toBeGreaterThanOrEqual(60_000);
    expect(finalRun.totalEvents).toBe(1);
    expect(finalRun.successfulEvents).toBe(1);
    expect(finalRun.failedEvents).toBe(0);
    expect(mockCreateLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: LogStatus.SUCCESS,
        message: expect.stringContaining("finished: 1 succeeded, 0 failed"),
      }),
    );
  });

  it("survives workflow-log and telemetry write failures (best-effort paths)", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    mockCreateLog.mockRejectedValue(new Error("log db down"));
    mockUpdateExecEvent.mockRejectedValue(new Error("telemetry down"));
    const run = seedRun();
    seedJob({
      id: "j1",
      eventId: 101,
      status: JobStatus.COMPLETED,
      result: {},
    });
    seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
      executionEventId: 555,
    });

    await expect(advanceWorkflowRun(run.id)).resolves.toBeUndefined();
    expect(runRow(run.id).status).toBe(LogStatus.SUCCESS);
  });
});

// ---------------------------------------------------------------------------
// advanceWorkflowRun — idempotency / replay
// ---------------------------------------------------------------------------

describe("advanceWorkflowRun — idempotency", () => {
  it("processing the same job-completed notification twice never double-dispatches", async () => {
    setGraph(
      [
        { id: 1, eventId: 101 },
        { id: 2, eventId: 102 },
      ],
      [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          connectionType: ConnectionType.ON_SUCCESS,
        },
      ],
    );
    const run = seedRun();
    seedJob({
      id: "j1",
      eventId: 101,
      status: JobStatus.COMPLETED,
      result: { scriptOutput: { n: 1 } },
    });
    seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
    });
    const stepB = seedStep(run.id, { nodeId: 2, eventId: 102 });

    await advanceWorkflowRun(run.id);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const jobIdAfterFirst = stepRow(stepB.id).jobId;

    // Replay: same notification arrives again
    await advanceWorkflowRun(run.id);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(stepRow(stepB.id).jobId).toBe(jobIdAfterFirst);
    expect(stepRow(stepB.id).status).toBe(WorkflowStepStatus.DISPATCHED);

    // B's job completes → run finalizes
    const jobB = jobsStore.find(
      (j) => j.metadata?.workflowStepRunId === stepB.id,
    )!;
    jobB.status = JobStatus.COMPLETED;
    jobB.result = {};
    await advanceWorkflowRun(run.id);
    expect(runRow(run.id).status).toBe(LogStatus.SUCCESS);

    // Advancing a terminal run again changes nothing
    const snapshot = JSON.stringify([runsStore, stepsStore]);
    await advanceWorkflowRun(run.id);
    expect(JSON.stringify([runsStore, stepsStore])).toBe(snapshot);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// advanceWorkflowRun — a run that timed out with steps open. The real database
// behaviour is in tests/storage/workflow-timeout.test.ts.
// ---------------------------------------------------------------------------

describe("advanceWorkflowRun — a timed-out run", () => {
  const timedOutAt = new Date(Date.now() - 60_000);

  function seedRunningTelemetry(
    runId: number,
    nodeId: number,
    overrides: Row = {},
  ): Row {
    const row: Row = {
      id: idSeq++,
      workflowExecutionId: runId,
      nodeId,
      eventId: 101,
      status: LogStatus.RUNNING,
      startedAt: new Date(timedOutAt.getTime() - 5_000),
      completedAt: null,
      duration: null,
      output: null,
      errorMessage: null,
      ...overrides,
    };
    telemetryStore.push(row);
    return row;
  }

  function seedTimedOutRun(): Row {
    return seedRun({ status: LogStatus.TIMEOUT, completedAt: timedOutAt });
  }

  beforeEach(() => {
    telemetryStore.length = 0;
    setGraph([{ id: 1, eventId: 101 }]);
  });

  it("gives a finished job's step its result and closes the rest, dispatching nothing", async () => {
    const run = seedTimedOutRun();
    const done = seedJob({
      status: JobStatus.COMPLETED,
      result: { scriptOutput: { rows: 1 }, condition: true },
    });
    const failed = seedJob({ status: JobStatus.FAILED, lastError: "exit 3" });
    const finishedStep = seedStep(run.id, {
      nodeId: 1,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: done.id,
    });
    const failedStep = seedStep(run.id, {
      nodeId: 2,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: failed.id,
    });
    const noJobStep = seedStep(run.id, {
      nodeId: 3,
      status: WorkflowStepStatus.DISPATCHED,
    });
    const neverStarted = seedStep(run.id, { nodeId: 4 });
    const telemetry = seedRunningTelemetry(run.id, 1);

    await advanceWorkflowRun(run.id);

    expect(stepRow(finishedStep.id)).toMatchObject({
      status: WorkflowStepStatus.SUCCEEDED,
      output: { rows: 1 },
      condition: true,
      completedAt: timedOutAt,
    });
    expect(stepRow(failedStep.id)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      error: "exit 3",
    });
    expect(stepRow(noJobStep.id)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      error: "Workflow run timed out before this step's job was created",
    });
    expect(stepRow(neverStarted.id)).toMatchObject({
      status: WorkflowStepStatus.SKIPPED,
      error: "Workflow run timed out before this step started",
    });
    expect(telemetry).toMatchObject({
      status: LogStatus.SUCCESS,
      completedAt: timedOutAt,
      duration: 5_000,
      output: JSON.stringify({ rows: 1 }),
      errorMessage: null,
    });
    expect(runRow(run.id)).toMatchObject({
      status: LogStatus.TIMEOUT,
      successfulEvents: 1,
      failedEvents: 2,
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("re-attaches an orphaned job and follows it", async () => {
    const run = seedTimedOutRun();
    const step = seedStep(run.id, { status: WorkflowStepStatus.DISPATCHED });
    const orphan = seedJob({
      status: JobStatus.TIMED_OUT,
      lastError: "Workflow run timed out",
      metadata: { workflowStepRunId: step.id },
    });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      jobId: orphan.id,
      error: "Workflow run timed out",
    });
  });

  it("holds a step and its telemetry open while the job is in flight", async () => {
    const run = seedTimedOutRun();
    const job = seedJob({ status: JobStatus.QUEUED });
    const step = seedStep(run.id, {
      status: WorkflowStepStatus.DISPATCHED,
      jobId: job.id,
    });
    const telemetry = seedRunningTelemetry(run.id, 1);

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.DISPATCHED);
    expect(telemetry.status).toBe(LogStatus.RUNNING);
  });

  it("closes a telemetry row that has no step", async () => {
    const run = seedTimedOutRun();
    const telemetry = seedRunningTelemetry(run.id, 99);

    await advanceWorkflowRun(run.id);

    expect(telemetry).toMatchObject({
      status: LogStatus.FAILURE,
      errorMessage: "Workflow run timed out",
    });
  });

  it("reports no negative duration when clocks disagree", async () => {
    const run = seedTimedOutRun();
    seedStep(run.id, {
      status: WorkflowStepStatus.FAILED,
      completedAt: timedOutAt,
    });
    const telemetry = seedRunningTelemetry(run.id, 1, {
      startedAt: new Date(timedOutAt.getTime() + 5_000),
    });

    await advanceWorkflowRun(run.id);

    expect(telemetry.duration).toBe(0);
  });

  it("caps a duration at what the column can hold", async () => {
    const run = seedTimedOutRun();
    seedStep(run.id, {
      status: WorkflowStepStatus.FAILED,
      completedAt: timedOutAt,
    });
    const telemetry = seedRunningTelemetry(run.id, 1, {
      startedAt: new Date(timedOutAt.getTime() - 30 * 86_400_000),
    });

    await advanceWorkflowRun(run.id);

    expect(telemetry.duration).toBe(MAX_DURATION_MS);
  });

  it("corrects stale counts even when no step is open", async () => {
    const run = seedTimedOutRun();
    seedStep(run.id, { nodeId: 1, status: WorkflowStepStatus.SUCCEEDED });
    seedStep(run.id, { nodeId: 2, status: WorkflowStepStatus.FAILED });

    await advanceWorkflowRun(run.id);

    expect(runRow(run.id)).toMatchObject({
      successfulEvents: 1,
      failedEvents: 1,
    });
  });

  it("writes nothing to the run when its counts already agree", async () => {
    const run = seedTimedOutRun();
    run.failedEvents = 1;
    seedStep(run.id, { status: WorkflowStepStatus.FAILED });
    const before = JSON.stringify(runRow(run.id));

    await advanceWorkflowRun(run.id);

    expect(JSON.stringify(runRow(run.id))).toBe(before);
  });

  it("settleTimedOutRunSteps does the same, and only for a timed-out run", async () => {
    const running = seedRun();
    const runningStep = seedStep(running.id);
    const timedOut = seedTimedOutRun();
    const timedOutStep = seedStep(timedOut.id);

    await settleTimedOutRunSteps(running.id);
    await settleTimedOutRunSteps(timedOut.id);
    await settleTimedOutRunSteps(99_999);

    expect(stepRow(runningStep.id).status).toBe(WorkflowStepStatus.PENDING);
    expect(stepRow(timedOutStep.id).status).toBe(WorkflowStepStatus.SKIPPED);
  });

  it("dispatches nothing when the timeout lands after the claim", async () => {
    const run = seedRun();
    const step = seedStep(run.id);
    mockAssert.mockImplementationOnce(() => {
      runRow(run.id).status = LogStatus.TIMEOUT;
      runRow(run.id).completedAt = timedOutAt;
      return Promise.resolve();
    });

    await advanceWorkflowRun(run.id);

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(stepRow(step.id)).toMatchObject({
      status: WorkflowStepStatus.FAILED,
      error: "Workflow run timed out before this step's job was created",
    });
  });

  it("settles the run again when the timeout lands during dispatch", async () => {
    const run = seedRun();
    seedStep(run.id);
    mockDispatch.mockImplementationOnce(() => {
      runRow(run.id).status = LogStatus.TIMEOUT;
      return Promise.resolve({ job: { id: "job-late" }, logId: 1 });
    });

    await advanceWorkflowRun(run.id);

    expect(mockSettleTimedOutRun).toHaveBeenCalledWith(run.id);
  });

  it("does not fail a dispatched step when that settling fails", async () => {
    const run = seedRun();
    const step = seedStep(run.id);
    mockDispatch.mockImplementationOnce(() => {
      runRow(run.id).status = LogStatus.TIMEOUT;
      return Promise.resolve({ job: { id: "job-late" }, logId: 1 });
    });
    mockSettleTimedOutRun.mockRejectedValueOnce(new Error("lost"));

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id)).toMatchObject({
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "job-late",
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(`run ${run.id} for a timeout`),
      "lost",
    );
  });

  it("does not settle anything when the run is still going after dispatch", async () => {
    const run = seedRun();
    seedStep(run.id);
    mockDispatch.mockResolvedValueOnce({ job: { id: "job-ok" }, logId: 1 });

    await advanceWorkflowRun(run.id);

    expect(mockSettleTimedOutRun).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// advanceWorkflowRun — crash recovery (Phase A2)
// ---------------------------------------------------------------------------

describe("advanceWorkflowRun — dispatch-crash recovery", () => {
  it("re-attaches an orphaned job via its metadata step id and converges on later advances", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    const run = seedRun();
    const step = seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: null, // crashed between claim and jobId write
      startedAt: new Date(Date.now() - 3 * 60_000),
    });
    // Decoy for the same event but a different step must not match
    seedJob({
      id: "decoy",
      eventId: 101,
      status: JobStatus.QUEUED,
      metadata: { workflowStepRunId: 424242 },
    });
    const orphan = seedJob({
      id: "orphan-1",
      eventId: 101,
      status: JobStatus.QUEUED,
      metadata: { workflowStepRunId: step.id },
    });

    await advanceWorkflowRun(run.id);
    expect(stepRow(step.id).jobId).toBe(orphan.id);
    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.DISPATCHED);
    expect(runRow(run.id).status).toBe(LogStatus.RUNNING);

    // The recovered job later completes; the next advance settles it
    orphan.status = JobStatus.COMPLETED;
    orphan.result = { scriptOutput: "recovered" };
    await advanceWorkflowRun(run.id);
    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.SUCCEEDED);
    expect(runRow(run.id).status).toBe(LogStatus.SUCCESS);
  });

  it("fails a stalled claim loudly when no orphan job exists", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    const run = seedRun();
    const step = seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: null,
      startedAt: new Date(Date.now() - 3 * 60_000),
    });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.FAILED);
    expect(stepRow(step.id).error).toBe(
      "Dispatch was interrupted before a job was created",
    );
    expect(runRow(run.id).status).toBe(LogStatus.FAILURE);
  });

  it("leaves a recently-claimed step alone until the stall window passes", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    const run = seedRun();
    const step = seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: null,
      startedAt: new Date(Date.now() - 30_000), // < 2 min stall threshold
    });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.DISPATCHED);
    expect(stepRow(step.id).jobId).toBeNull();
    expect(runRow(run.id).status).toBe(LogStatus.RUNNING);
  });
});

// ---------------------------------------------------------------------------
// advanceWorkflowRun — post-commit dispatch failure paths (Phase C)
// ---------------------------------------------------------------------------

describe("advanceWorkflowRun — dispatch failure paths", () => {
  function seedReadyStartNode() {
    setGraph([{ id: 1, eventId: 101 }]);
    const run = seedRun();
    const step = seedStep(run.id, { nodeId: 1, eventId: 101 });
    return { run, step };
  }

  it("fails claimed steps when authorization is revoked between claim and dispatch", async () => {
    const { run, step } = seedReadyStartNode();
    mockAssert.mockRejectedValue(new Error("revoked"));

    await advanceWorkflowRun(run.id);

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.FAILED);
    expect(stepRow(step.id).error).toBe(
      "Workflow authorization changed before dispatch: revoked",
    );
    // failClaimedStep re-advances, which finalizes the run
    expect(runRow(run.id).status).toBe(LogStatus.FAILURE);
  });

  it("fails the step when its event no longer exists", async () => {
    const { run, step } = seedReadyStartNode();
    mockGetEvent.mockResolvedValue(undefined);

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.FAILED);
    expect(stepRow(step.id).error).toBe("Event 101 no longer exists");
    expect(runRow(run.id).status).toBe(LogStatus.FAILURE);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("fails the step when dispatch reports a skip (overlap policy)", async () => {
    const { run, step } = seedReadyStartNode();
    mockDispatch.mockResolvedValue({
      job: null,
      logId: null,
      skipped: "overlap",
    });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.FAILED);
    expect(stepRow(step.id).error).toBe("Run skipped (overlap)");
    // The telemetry row id created before dispatch is preserved on the step
    // AND the row itself is finalized — no step may render RUNNING forever.
    const skipTelemetryId = stepRow(step.id).executionEventId;
    expect(skipTelemetryId).not.toBeNull();
    expect(mockUpdateExecEvent).toHaveBeenCalledWith(
      skipTelemetryId,
      expect.objectContaining({
        status: LogStatus.FAILURE,
        errorMessage: "Run skipped (overlap)",
        completedAt: expect.any(Date),
      }),
    );
    expect(runRow(run.id).status).toBe(LogStatus.FAILURE);
  });

  it("fails the step with the reason when the event has no servers", async () => {
    const { run, step } = seedReadyStartNode();
    mockDispatch.mockResolvedValue({
      job: null,
      logId: null,
      skipped: "no_servers",
    });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.FAILED);
    expect(stepRow(step.id).error).toBe(
      "This event runs only on servers and has none. Choose a server, or set it to run locally.",
    );
    expect(runRow(run.id).status).toBe(LogStatus.FAILURE);
  });

  it("fails the step when dispatch throws", async () => {
    const { run, step } = seedReadyStartNode();
    mockDispatch.mockRejectedValue(new Error("db down"));

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.FAILED);
    expect(stepRow(step.id).error).toBe("Dispatch failed: db down");
    expect(runRow(run.id).status).toBe(LogStatus.FAILURE);
    // The telemetry row created before the dispatch attempt is finalized too
    // (it used to be orphaned RUNNING when dispatch threw).
    const throwTelemetryId = stepRow(step.id).executionEventId;
    expect(throwTelemetryId).not.toBeNull();
    expect(mockUpdateExecEvent).toHaveBeenCalledWith(
      throwTelemetryId,
      expect.objectContaining({
        status: LogStatus.FAILURE,
        errorMessage: "Dispatch failed: db down",
        completedAt: expect.any(Date),
      }),
    );
  });

  it("still dispatches when the telemetry insert fails (telemetry is best-effort)", async () => {
    const { run, step } = seedReadyStartNode();
    mockCreateExecEvent.mockRejectedValue(new Error("telemetry down"));

    await advanceWorkflowRun(run.id);

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const settled = stepRow(step.id);
    expect(settled.status).toBe(WorkflowStepStatus.DISPATCHED);
    expect(settled.jobId).not.toBeNull();
    expect(settled.executionEventId).toBeNull();
    expect(runRow(run.id).status).toBe(LogStatus.RUNNING);
  });
});

// ---------------------------------------------------------------------------
// Input resolution semantics on dispatch
// ---------------------------------------------------------------------------

describe("advanceWorkflowRun — input resolution", () => {
  it("gives the start node the trigger input from executionData", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    const run = seedRun({ executionData: { inputData: { seed: 7 } } });
    seedStep(run.id, { nodeId: 1, eventId: 101 });

    await advanceWorkflowRun(run.id);

    expect(mockDispatch.mock.calls[0]![1].input).toEqual({ seed: 7 });
  });

  it("defaults the start-node input to {} when executionData is null", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    const run = seedRun({ executionData: null });
    seedStep(run.id, { nodeId: 1, eventId: 101 });

    await advanceWorkflowRun(run.id);

    expect(mockDispatch.mock.calls[0]![1].input).toEqual({});
  });

  it("wraps a scalar predecessor output as { value }", async () => {
    setGraph(
      [
        { id: 1, eventId: 101 },
        { id: 2, eventId: 102 },
      ],
      [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          connectionType: ConnectionType.ON_SUCCESS,
        },
      ],
    );
    const run = seedRun();
    seedJob({
      id: "j1",
      eventId: 101,
      status: JobStatus.COMPLETED,
      result: { scriptOutput: "done" },
    });
    seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
    });
    seedStep(run.id, { nodeId: 2, eventId: 102 });

    await advanceWorkflowRun(run.id);

    expect(mockDispatch.mock.calls[0]![1].input).toEqual({ value: "done" });
  });

  it("gives a failure-branch node an empty input, never the trigger input", async () => {
    setGraph(
      [
        { id: 1, eventId: 101 },
        { id: 2, eventId: 102 },
      ],
      [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          connectionType: ConnectionType.ON_FAILURE,
        },
      ],
    );
    const run = seedRun({
      executionData: { inputData: { secret: "trigger" } },
    });
    seedJob({ id: "j1", eventId: 101, status: JobStatus.FAILED });
    seedStep(run.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
    });
    const step2 = seedStep(run.id, { nodeId: 2, eventId: 102 });

    await advanceWorkflowRun(run.id);

    expect(stepRow(step2.id).status).toBe(WorkflowStepStatus.DISPATCHED);
    expect(mockDispatch.mock.calls[0]![1].input).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// advanceRunsForJob / reconcileWorkflowRuns
// ---------------------------------------------------------------------------

describe("advanceRunsForJob", () => {
  it("advances every run holding a step for the job", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    seedJob({
      id: "shared-j",
      eventId: 101,
      status: JobStatus.COMPLETED,
      result: {},
    });
    const runA = seedRun();
    const runB = seedRun();
    seedStep(runA.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "shared-j",
      startedAt: new Date(),
    });
    seedStep(runB.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "shared-j",
      startedAt: new Date(),
    });

    await advanceRunsForJob("shared-j");

    expect(runRow(runA.id).status).toBe(LogStatus.SUCCESS);
    expect(runRow(runB.id).status).toBe(LogStatus.SUCCESS);
  });

  it("does nothing for a job no step references", async () => {
    await expect(advanceRunsForJob("nobody")).resolves.toBeUndefined();
  });

  it("keeps advancing later runs when one advance throws", async () => {
    setGraph([{ id: 1, eventId: 101 }]);
    seedJob({
      id: "j1",
      eventId: 101,
      status: JobStatus.COMPLETED,
      result: {},
    });
    const runA = seedRun();
    const runB = seedRun();
    seedStep(runA.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
    });
    seedStep(runB.id, {
      nodeId: 1,
      eventId: 101,
      status: WorkflowStepStatus.DISPATCHED,
      jobId: "j1",
      startedAt: new Date(),
    });
    // First advance blows up inside the transaction
    mockNodes.mockRejectedValueOnce(new Error("nodes query failed"));

    await expect(advanceRunsForJob("j1")).resolves.toBeUndefined();

    expect(runRow(runA.id).status).toBe(LogStatus.RUNNING); // errored advance
    expect(runRow(runB.id).status).toBe(LogStatus.SUCCESS);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("advance failed for run"),
      "nodes query failed",
    );
  });
});

describe("reconcileWorkflowRuns", () => {
  it("advances RUNNING runs up to the limit and skips terminal ones", async () => {
    setGraph([], []); // zero-node runs finalize immediately as SUCCESS
    const r1 = seedRun();
    const r2 = seedRun();
    const r3 = seedRun();
    const done = seedRun({ status: LogStatus.SUCCESS });

    const count = await reconcileWorkflowRuns(2);

    expect(count).toBe(2);
    expect(runRow(r1.id).status).toBe(LogStatus.SUCCESS);
    expect(runRow(r2.id).status).toBe(LogStatus.SUCCESS);
    expect(runRow(r3.id).status).toBe(LogStatus.RUNNING); // beyond the limit
    expect(runRow(done.id).status).toBe(LogStatus.SUCCESS);
  });

  it("continues past a run whose advance throws", async () => {
    setGraph([], []);
    const r1 = seedRun();
    const r2 = seedRun();
    mockNodes.mockRejectedValueOnce(new Error("boom"));

    const count = await reconcileWorkflowRuns();

    expect(count).toBe(2);
    expect(runRow(r1.id).status).toBe(LogStatus.RUNNING);
    expect(runRow(r2.id).status).toBe(LogStatus.SUCCESS);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("reconcile failed for run"),
      "boom",
    );
  });
});
