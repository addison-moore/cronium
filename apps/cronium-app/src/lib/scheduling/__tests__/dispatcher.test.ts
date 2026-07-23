/**
 * @jest-environment node
 */

/**
 * Unit tests for the dispatch tick (dispatcher.ts): due-row selection and
 * next_run_at advancement, materialization of missing schedules, overlap
 * policies at tick time, error isolation (one bad event must not stall the
 * batch), and scheduled workflow starts.
 *
 * The db mock resolves selects from per-table FIFO queues so each query in
 * the tick can be scripted independently; inserts and updates are captured
 * for behavioral assertions.
 */

const state = {
  selectQueues: new Map<unknown, unknown[][]>(),
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
  insertShouldReject: false,
};

jest.mock("@/server/db", () => {
  const makeSelectChain = () => {
    let table: unknown;
    const chain: Record<string, unknown> = {};
    chain.from = jest.fn((t: unknown) => {
      table = t;
      return chain;
    });
    chain.where = jest.fn(() => chain);
    chain.orderBy = jest.fn(() => chain);
    chain.limit = jest.fn(() => chain);
    chain.for = jest.fn(() => chain);
    chain.then = (
      resolve: (rows: unknown) => unknown,
      reject: (err: unknown) => unknown,
    ) => {
      const queue = state.selectQueues.get(table);
      const rows = queue && queue.length > 0 ? queue.shift() : [];
      return Promise.resolve(rows).then(resolve, reject);
    };
    return chain;
  };

  const db: Record<string, unknown> = {
    select: jest.fn(() => makeSelectChain()),
    update: jest.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.set = jest.fn((set: Record<string, unknown>) => {
        state.updates.push({ table, set });
        return chain;
      });
      chain.where = jest.fn(() => chain);
      chain.then = (
        resolve: (v: unknown) => unknown,
        reject: (err: unknown) => unknown,
      ) => Promise.resolve(undefined).then(resolve, reject);
      return chain;
    }),
    insert: jest.fn((table: unknown) => ({
      values: jest.fn((values: Record<string, unknown>) => {
        state.inserts.push({ table, values });
        return state.insertShouldReject
          ? Promise.reject(new Error("incident insert failed"))
          : Promise.resolve(undefined);
      }),
    })),
  };
  db.transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(db),
  );
  return { db };
});

jest.mock("@/server/storage", () => ({
  storage: { getEventWithRelations: jest.fn() },
}));

jest.mock("../plan-ticks", () => ({
  planTicks: jest.fn(),
}));

jest.mock("../schedule-math", () => ({
  specFromEvent: jest.fn(),
  specFromWorkflow: jest.fn(),
}));

jest.mock("../materialize", () => ({
  refreshEventSchedule: jest.fn(() => Promise.resolve(undefined)),
  refreshWorkflowSchedule: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock("../dispatch", () => ({
  dispatchEventJob: jest.fn(),
}));

// Dynamic import target for scheduled workflow starts.
jest.mock("../workflow-engine", () => ({
  startWorkflowRun: jest.fn(),
}));

import { runDispatchTick } from "../dispatcher";
import { storage } from "@/server/storage";
import { planTicks, type TickPlan } from "../plan-ticks";
import { specFromEvent, specFromWorkflow } from "../schedule-math";
import { refreshEventSchedule, refreshWorkflowSchedule } from "../materialize";
import { dispatchEventJob } from "../dispatch";
import { startWorkflowRun } from "../workflow-engine";
import {
  events,
  jobs,
  scheduleIncidents,
  workflows,
  CatchupPolicy,
  EventStatus,
  OverlapPolicy,
  ScheduleIncidentKind,
} from "@/shared/schema";

const mockGetEvent = storage.getEventWithRelations as jest.Mock;
const mockPlanTicks = planTicks as jest.Mock;
const mockSpecFromEvent = specFromEvent as jest.Mock;
const mockSpecFromWorkflow = specFromWorkflow as jest.Mock;
const mockRefreshEvent = refreshEventSchedule as jest.Mock;
const mockRefreshWorkflow = refreshWorkflowSchedule as jest.Mock;
const mockDispatch = dispatchEventJob as jest.Mock;
const mockStartWorkflow = startWorkflowRun as jest.Mock;

const NOW = new Date("2026-07-22T12:00:00.000Z");
const DUE_AT = new Date("2026-07-22T11:59:00.000Z");
const NEXT_AT = new Date("2026-07-22T12:05:00.000Z");

function enqueueSelect(table: unknown, rows: unknown[]): void {
  const queue = state.selectQueues.get(table) ?? [];
  queue.push(rows);
  state.selectQueues.set(table, queue);
}

function dueEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    status: EventStatus.ACTIVE,
    nextRunAt: DUE_AT,
    overlapPolicy: OverlapPolicy.ALLOW,
    catchupPolicy: CatchupPolicy.SKIP,
    misfireGraceS: 60,
    ...overrides,
  };
}

function singleTickPlan(overrides: Partial<TickPlan> = {}): TickPlan {
  return {
    ticks: [{ at: DUE_AT, miss: false }],
    incidents: [],
    nextRunAt: NEXT_AT,
    ...overrides,
  };
}

const activeEvent = { id: 7, status: EventStatus.ACTIVE };

const incidentInserts = () =>
  state.inserts.filter((i) => i.table === scheduleIncidents);
const eventUpdates = () => state.updates.filter((u) => u.table === events);
const jobUpdates = () => state.updates.filter((u) => u.table === jobs);

beforeEach(() => {
  state.selectQueues = new Map();
  state.inserts = [];
  state.updates = [];
  state.insertShouldReject = false;
  mockGetEvent.mockReset().mockResolvedValue(activeEvent);
  mockPlanTicks.mockReset().mockReturnValue(singleTickPlan());
  mockSpecFromEvent.mockReset().mockReturnValue({ kind: "INTERVAL" });
  mockSpecFromWorkflow.mockReset().mockReturnValue({ kind: "INTERVAL" });
  mockRefreshEvent.mockReset().mockResolvedValue(undefined);
  mockRefreshWorkflow.mockReset().mockResolvedValue(undefined);
  mockDispatch
    .mockReset()
    .mockResolvedValue({ job: { id: "job-1" }, logId: 1 });
  mockStartWorkflow.mockReset().mockResolvedValue({ success: true });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("runDispatchTick — empty tick", () => {
  it("does nothing when nothing is due", async () => {
    const result = await runDispatchTick(NOW);

    expect(result).toEqual({
      dueEvents: 0,
      dispatched: 0,
      incidents: 0,
      workflowRunsStarted: 0,
    });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockRefreshEvent).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });
});

describe("runDispatchTick — materialization", () => {
  it("materializes missing next_run_at for events and workflows", async () => {
    enqueueSelect(events, [{ id: 1 }, { id: 2 }]); // materializeMissing
    enqueueSelect(workflows, [{ id: 9 }]); // materializeMissingWorkflows

    await runDispatchTick(NOW);

    expect(mockRefreshEvent).toHaveBeenCalledTimes(2);
    expect(mockRefreshEvent).toHaveBeenCalledWith(1);
    expect(mockRefreshEvent).toHaveBeenCalledWith(2);
    expect(mockRefreshWorkflow).toHaveBeenCalledWith(9);
  });
});

describe("runDispatchTick — due events", () => {
  it("plans, advances next_run_at, and dispatches through the single enqueue path", async () => {
    enqueueSelect(events, []); // materializeMissing
    enqueueSelect(events, [dueEventRow()]); // claimDuePlans

    const result = await runDispatchTick(NOW);

    expect(mockPlanTicks).toHaveBeenCalledWith({
      spec: { kind: "INTERVAL" },
      dueAt: DUE_AT,
      now: NOW,
      catchupPolicy: CatchupPolicy.SKIP,
      misfireGraceS: 60,
    });

    // The claim transaction consumes the tick by advancing next_run_at.
    expect(eventUpdates()).toHaveLength(1);
    expect(eventUpdates()[0]!.set).toEqual({
      nextRunAt: NEXT_AT,
      updatedAt: NOW,
    });

    expect(mockGetEvent).toHaveBeenCalledWith(7);
    expect(mockDispatch).toHaveBeenCalledWith(activeEvent, {
      triggeredBy: "schedule",
      scheduledMiss: false,
    });

    expect(result).toEqual({
      dueEvents: 1,
      dispatched: 1,
      incidents: 0,
      workflowRunsStarted: 0,
    });
  });

  it("marks late ticks as scheduled misses", async () => {
    enqueueSelect(events, []);
    enqueueSelect(events, [dueEventRow()]);
    mockPlanTicks.mockReturnValue(
      singleTickPlan({ ticks: [{ at: DUE_AT, miss: true }] }),
    );

    await runDispatchTick(NOW);

    expect(mockDispatch).toHaveBeenCalledWith(
      activeEvent,
      expect.objectContaining({ scheduledMiss: true }),
    );
  });

  it("stops polling an unschedulable event and records a MISSED incident", async () => {
    enqueueSelect(events, []);
    enqueueSelect(events, [dueEventRow()]);
    mockSpecFromEvent.mockReturnValue(null);

    const result = await runDispatchTick(NOW);

    expect(eventUpdates()[0]!.set).toEqual({ nextRunAt: null, updatedAt: NOW });
    const incidents = incidentInserts();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.values).toEqual({
      eventId: 7,
      kind: ScheduleIncidentKind.MISSED,
      details: {
        scheduledFor: DUE_AT.toISOString(),
        reason: "unschedulable: invalid or missing schedule expression",
      },
    });
    expect(mockPlanTicks).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(result.dueEvents).toBe(0);
  });

  it("skips locked rows whose next_run_at is already null", async () => {
    enqueueSelect(events, []);
    enqueueSelect(events, [dueEventRow({ nextRunAt: null })]);

    const result = await runDispatchTick(NOW);

    expect(result.dueEvents).toBe(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("records incidents planned by the tick planner", async () => {
    enqueueSelect(events, []);
    enqueueSelect(events, [dueEventRow()]);
    mockPlanTicks.mockReturnValue(
      singleTickPlan({
        ticks: [],
        incidents: [
          {
            kind: ScheduleIncidentKind.CATCHUP_OVERFLOW,
            details: { dropped: 3 },
          },
        ],
      }),
    );

    const result = await runDispatchTick(NOW);

    expect(incidentInserts()[0]!.values).toEqual({
      eventId: 7,
      kind: ScheduleIncidentKind.CATCHUP_OVERFLOW,
      details: { dropped: 3 },
    });
    expect(result.incidents).toBe(1);
    expect(result.dispatched).toBe(0);
  });

  it("drops remaining ticks when the event vanished or was paused after claiming", async () => {
    enqueueSelect(events, []);
    enqueueSelect(events, [dueEventRow()]);
    mockPlanTicks.mockReturnValue(
      singleTickPlan({
        ticks: [
          { at: DUE_AT, miss: false },
          { at: NOW, miss: false },
        ],
      }),
    );
    mockGetEvent.mockResolvedValue({ id: 7, status: EventStatus.PAUSED });

    const result = await runDispatchTick(NOW);

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(0);
    // break: the second tick never re-fetched the event.
    expect(mockGetEvent).toHaveBeenCalledTimes(1);
  });

  it("stops dispatching after a max_executions auto-pause", async () => {
    enqueueSelect(events, []);
    enqueueSelect(events, [dueEventRow()]);
    mockPlanTicks.mockReturnValue(
      singleTickPlan({
        ticks: [
          { at: DUE_AT, miss: false },
          { at: NOW, miss: false },
        ],
      }),
    );
    mockDispatch.mockResolvedValue({
      job: null,
      logId: null,
      skipped: "max_executions",
    });

    const result = await runDispatchTick(NOW);

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(result.dispatched).toBe(0);
  });

  it("does not count overlap skips as dispatches but keeps going", async () => {
    enqueueSelect(events, []);
    enqueueSelect(events, [dueEventRow()]);
    mockPlanTicks.mockReturnValue(
      singleTickPlan({
        ticks: [
          { at: DUE_AT, miss: false },
          { at: NOW, miss: false },
        ],
      }),
    );
    mockDispatch
      .mockResolvedValueOnce({ job: null, logId: null, skipped: "overlap" })
      .mockResolvedValueOnce({ job: { id: "job-2" }, logId: 2 });

    const result = await runDispatchTick(NOW);

    expect(mockDispatch).toHaveBeenCalledTimes(2);
    expect(result.dispatched).toBe(1);
  });
});

describe("runDispatchTick — overlap policies at tick time", () => {
  it("QUEUE: folds a tick into an already-queued job, dispatches otherwise", async () => {
    enqueueSelect(events, []);
    enqueueSelect(events, [
      dueEventRow({ overlapPolicy: OverlapPolicy.QUEUE }),
    ]);
    mockPlanTicks.mockReturnValue(
      singleTickPlan({
        ticks: [
          { at: DUE_AT, miss: false },
          { at: NOW, miss: false },
        ],
      }),
    );
    enqueueSelect(jobs, [{ id: "queued-job" }]); // first tick: queued job exists
    enqueueSelect(jobs, []); // second tick: coast is clear

    const result = await runDispatchTick(NOW);

    const incidents = incidentInserts();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.values).toEqual({
      eventId: 7,
      kind: ScheduleIncidentKind.SKIPPED_OVERLAP,
      details: {
        scheduledFor: DUE_AT.toISOString(),
        foldedIntoQueuedJob: true,
      },
    });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ dispatched: 1, incidents: 1 });
  });

  it("CANCEL_PREVIOUS: requests cancellation of live jobs before dispatching", async () => {
    enqueueSelect(events, []);
    enqueueSelect(events, [
      dueEventRow({ overlapPolicy: OverlapPolicy.CANCEL_PREVIOUS }),
    ]);

    await runDispatchTick(NOW);

    expect(jobUpdates()).toHaveLength(1);
    expect(jobUpdates()[0]!.set).toMatchObject({ cancelRequested: true });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });
});

describe("runDispatchTick — error isolation", () => {
  it("one failing event records a MISSED incident and does not stall the batch", async () => {
    enqueueSelect(events, []);
    enqueueSelect(events, [dueEventRow({ id: 7 }), dueEventRow({ id: 8 })]);
    const eventSeven = { id: 7, status: EventStatus.ACTIVE };
    const eventEight = { id: 8, status: EventStatus.ACTIVE };
    mockGetEvent.mockImplementation((id: number) =>
      Promise.resolve(id === 7 ? eventSeven : eventEight),
    );
    mockDispatch
      .mockRejectedValueOnce(new Error("payload build exploded"))
      .mockResolvedValueOnce({ job: { id: "job-8" }, logId: 8 });

    const result = await runDispatchTick(NOW);

    expect(result).toMatchObject({
      dueEvents: 2,
      dispatched: 1,
      incidents: 1,
    });
    const incidents = incidentInserts();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.values).toEqual({
      eventId: 7,
      kind: ScheduleIncidentKind.MISSED,
      details: {
        scheduledFor: DUE_AT.toISOString(),
        reason: "dispatch failed: payload build exploded",
      },
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      eventEight,
      expect.objectContaining({ triggeredBy: "schedule" }),
    );
  });

  it("survives even the failure-incident insert failing", async () => {
    state.insertShouldReject = true;
    enqueueSelect(events, []);
    enqueueSelect(events, [dueEventRow()]);
    mockDispatch.mockRejectedValue(new Error("payload build exploded"));

    const result = await runDispatchTick(NOW);

    expect(result).toMatchObject({ dispatched: 0, incidents: 1 });
  });
});

describe("runDispatchTick — scheduled workflows", () => {
  function enqueueDueWorkflow(overrides: Record<string, unknown> = {}) {
    enqueueSelect(workflows, []); // materializeMissingWorkflows
    enqueueSelect(workflows, [
      { id: 3, status: EventStatus.ACTIVE, nextRunAt: DUE_AT, ...overrides },
    ]); // claimDueWorkflowPlans
  }

  it("starts due workflows with default SKIP catch-up and 60s grace", async () => {
    enqueueDueWorkflow();

    const result = await runDispatchTick(NOW);

    expect(mockPlanTicks).toHaveBeenCalledWith({
      spec: { kind: "INTERVAL" },
      dueAt: DUE_AT,
      now: NOW,
      catchupPolicy: CatchupPolicy.SKIP,
      misfireGraceS: 60,
    });
    const wfUpdates = state.updates.filter((u) => u.table === workflows);
    expect(wfUpdates).toHaveLength(1);
    expect(wfUpdates[0]!.set).toEqual({ nextRunAt: NEXT_AT, updatedAt: NOW });
    expect(mockStartWorkflow).toHaveBeenCalledWith(3, {
      triggerType: "SCHEDULE",
    });
    expect(result.workflowRunsStarted).toBe(1);
  });

  it("records a MISSED incident when the workflow start reports failure", async () => {
    enqueueDueWorkflow();
    mockStartWorkflow.mockResolvedValue({ success: false, output: "boom" });

    const result = await runDispatchTick(NOW);

    expect(result.workflowRunsStarted).toBe(0);
    expect(result.incidents).toBe(1);
    expect(incidentInserts()[0]!.values).toEqual({
      workflowId: 3,
      kind: ScheduleIncidentKind.MISSED,
      details: {
        scheduledFor: DUE_AT.toISOString(),
        reason: "start failed: boom",
      },
    });
  });

  it("survives a workflow start that throws", async () => {
    enqueueDueWorkflow();
    mockStartWorkflow.mockRejectedValue(new Error("engine offline"));

    const result = await runDispatchTick(NOW);

    expect(result.workflowRunsStarted).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it("stops polling an unschedulable workflow with a MISSED incident", async () => {
    enqueueDueWorkflow();
    mockSpecFromWorkflow.mockReturnValue(null);

    const result = await runDispatchTick(NOW);

    const wfUpdates = state.updates.filter((u) => u.table === workflows);
    expect(wfUpdates[0]!.set).toEqual({ nextRunAt: null, updatedAt: NOW });
    expect(incidentInserts()[0]!.values).toMatchObject({
      workflowId: 3,
      kind: ScheduleIncidentKind.MISSED,
    });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
    expect(result.workflowRunsStarted).toBe(0);
  });

  it("records planner incidents for workflows and skips null nextRunAt rows", async () => {
    enqueueSelect(workflows, []);
    enqueueSelect(workflows, [
      { id: 3, status: EventStatus.ACTIVE, nextRunAt: null },
      { id: 4, status: EventStatus.ACTIVE, nextRunAt: DUE_AT },
    ]);
    mockPlanTicks.mockReturnValue(
      singleTickPlan({
        ticks: [],
        incidents: [
          { kind: ScheduleIncidentKind.MISSED, details: { skipped: 2 } },
        ],
      }),
    );

    const result = await runDispatchTick(NOW);

    expect(mockPlanTicks).toHaveBeenCalledTimes(1);
    expect(incidentInserts()[0]!.values).toEqual({
      workflowId: 4,
      kind: ScheduleIncidentKind.MISSED,
      details: { skipped: 2 },
    });
    expect(result.incidents).toBe(1);
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });
});
