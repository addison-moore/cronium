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
  workflowExecutions,
  workflowStepRuns,
} from "@/shared/schema";
import { storage } from "@/server/storage";
import { assertWorkflowGraphCapability } from "@/server/security/resource-access";
import { dispatchEventJob } from "../dispatch";
import {
  advanceRunsForJob,
  advanceWorkflowRun,
  evaluateEdge,
  hasStaleRuns,
  reconcileWorkflowRuns,
  resolveReadiness,
  startWorkflowRun,
  type EdgeState,
} from "../workflow-engine";

// ---------------------------------------------------------------------------
// In-memory drizzle stand-in
// ---------------------------------------------------------------------------

const runsStore: Row[] = [];
const stepsStore: Row[] = [];
const jobsStore: Row[] = [];

const tableStores = new Map<unknown, Row[]>([
  [workflowExecutions, runsStore],
  [workflowStepRuns, stepsStore],
  [jobsTable, jobsStore],
]);

const columnKeys = new Map<unknown, string>();
for (const table of [workflowExecutions, workflowStepRuns, jobsTable]) {
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

  it("marks conflicting incoming edges UNSATISFIABLE and still finishes the run as SUCCESS", async () => {
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
    // Unsatisfiable is terminal but not a failure: the run completes SUCCESS
    const finalRun = runRow(run.id);
    expect(finalRun.status).toBe(LogStatus.SUCCESS);
    expect(finalRun.successfulEvents).toBe(1);
    expect(finalRun.failedEvents).toBe(0);
    expect(mockCreateLog).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("1 succeeded, 0 failed, 1 skipped"),
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
    expect(stepRow(step.id).executionEventId).not.toBeNull();
    expect(runRow(run.id).status).toBe(LogStatus.FAILURE);
  });

  it("fails the step when dispatch throws", async () => {
    const { run, step } = seedReadyStartNode();
    mockDispatch.mockRejectedValue(new Error("db down"));

    await advanceWorkflowRun(run.id);

    expect(stepRow(step.id).status).toBe(WorkflowStepStatus.FAILED);
    expect(stepRow(step.id).error).toBe("Dispatch failed: db down");
    expect(runRow(run.id).status).toBe(LogStatus.FAILURE);
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
// advanceRunsForJob / reconcileWorkflowRuns / hasStaleRuns
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

describe("hasStaleRuns", () => {
  it("is false with no RUNNING runs", async () => {
    seedRun({ status: LogStatus.SUCCESS, updatedAt: new Date(0) });
    await expect(hasStaleRuns()).resolves.toBe(false);
  });

  it("is false when every RUNNING run was touched inside the window", async () => {
    seedRun({ status: LogStatus.RUNNING, updatedAt: new Date() });
    await expect(hasStaleRuns()).resolves.toBe(false);
  });

  it("is true when a RUNNING run has gone quiet past the window", async () => {
    seedRun({
      status: LogStatus.RUNNING,
      updatedAt: new Date(Date.now() - 2 * 60_000),
    });
    await expect(hasStaleRuns()).resolves.toBe(true);
    // A tighter custom window flips a 30s-old run stale too
    runsStore[0]!.updatedAt = new Date(Date.now() - 30_000);
    await expect(hasStaleRuns(10_000)).resolves.toBe(true);
  });
});
