/**
 * @jest-environment node
 */

/**
 * Unit tests for the single enqueue path (dispatch.ts): payload/metadata
 * construction, trigger-source mapping, overlap (unique-violation) handling,
 * max-executions auto-pause, authorization fail-closed behavior, and
 * execution bookkeeping.
 */

const state = {
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
};

jest.mock("@/server/db", () => ({
  db: {
    insert: jest.fn((table: unknown) => ({
      values: jest.fn((values: Record<string, unknown>) => {
        state.inserts.push({ table, values });
        return Promise.resolve(undefined);
      }),
    })),
  },
}));

jest.mock("@/server/storage", () => ({
  storage: {
    createLog: jest.fn(),
    updateLog: jest.fn(),
    updateScript: jest.fn(),
    recordEventDispatch: jest.fn(),
  },
}));

jest.mock("@/lib/services/job-service", () => ({
  jobService: { createJob: jest.fn() },
}));

jest.mock("@/lib/scheduler/job-payload-builder", () => ({
  buildJobPayload: jest.fn(),
}));

jest.mock("@/lib/scheduler/event-timeout", () => ({
  eventTimeoutMs: jest.fn(() => 120000),
}));

jest.mock("../job-transition", () => ({
  recordJobCreated: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock("@/server/security/resource-access", () => ({
  assertEventRelations: jest.fn(() => Promise.resolve(undefined)),
}));

jest.mock("@/server/security/authorization", () => ({
  getAuthorizedPrincipal: jest.fn(),
  assertRoleCapability: jest.fn(),
}));

// Dynamic import target inside checkMaxExecutions.
jest.mock("@/lib/scheduler", () => ({
  scheduler: { deleteScript: jest.fn(() => Promise.resolve(undefined)) },
}));

import { dispatchEventJob } from "../dispatch";
import { storage, type EventWithRelations } from "@/server/storage";
import { jobService } from "@/lib/services/job-service";
import { buildJobPayload } from "@/lib/scheduler/job-payload-builder";
import { recordJobCreated } from "../job-transition";
import {
  assertRoleCapability,
  getAuthorizedPrincipal,
} from "@/server/security/authorization";
import { assertEventRelations } from "@/server/security/resource-access";
import { scheduler } from "@/lib/scheduler";
import {
  EventStatus,
  JobPriority,
  JobSource,
  JobType,
  LeaseLossPolicy,
  LogStatus,
  OverlapPolicy,
  ScheduleIncidentKind,
  scheduleIncidents,
  type Job,
} from "@/shared/schema";

const mockCreateLog = storage.createLog as jest.Mock;
const mockUpdateLog = storage.updateLog as jest.Mock;
const mockUpdateScript = storage.updateScript as jest.Mock;
const mockRecordDispatch = storage.recordEventDispatch as jest.Mock;
const mockCreateJob = jobService.createJob as jest.Mock;
const mockBuildPayload = buildJobPayload as jest.Mock;
const mockRecordCreated = recordJobCreated as jest.Mock;
const mockGetPrincipal = getAuthorizedPrincipal as jest.Mock;
const mockAssertRole = assertRoleCapability as jest.Mock;
const mockAssertRelations = assertEventRelations as jest.Mock;
const mockDeleteScript = scheduler.deleteScript as jest.Mock;

function makeEvent(
  overrides: Record<string, unknown> = {},
): EventWithRelations {
  return {
    id: 7,
    userId: 3,
    name: "Nightly backup",
    type: "BASH",
    priority: JobPriority.HIGH,
    retries: 2,
    maxExecutions: null,
    executionCount: 0,
    overlapPolicy: OverlapPolicy.ALLOW,
    leaseLossPolicy: null,
    ...overrides,
  } as unknown as EventWithRelations;
}

const createdJob = { id: "job-1" } as Job;

const incidentInserts = () =>
  state.inserts.filter((i) => i.table === scheduleIncidents);

beforeEach(() => {
  state.inserts = [];
  mockCreateLog.mockReset().mockResolvedValue({ id: 42 });
  mockUpdateLog.mockReset().mockResolvedValue(undefined);
  mockUpdateScript.mockReset().mockResolvedValue(undefined);
  mockRecordDispatch.mockReset().mockResolvedValue(undefined);
  mockCreateJob.mockReset().mockResolvedValue(createdJob);
  mockBuildPayload.mockReset().mockReturnValue({ executionLogId: 42 });
  mockRecordCreated.mockReset().mockResolvedValue(undefined);
  mockGetPrincipal.mockReset().mockResolvedValue({ id: "3", role: "ADMIN" });
  mockAssertRole.mockReset();
  mockAssertRelations.mockReset().mockResolvedValue(undefined);
  mockDeleteScript.mockReset().mockResolvedValue(undefined);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("dispatchEventJob — happy path", () => {
  it("creates the pending log, the job, links them, records the birth, and books execution", async () => {
    const event = makeEvent();

    const result = await dispatchEventJob(event, { triggeredBy: "schedule" });

    expect(result).toEqual({ job: createdJob, logId: 42 });

    expect(mockCreateLog).toHaveBeenCalledWith({
      eventId: 7,
      workflowId: undefined,
      status: LogStatus.PENDING,
      startTime: expect.any(Date),
      eventName: "Nightly backup",
      eventType: "BASH",
      userId: "3",
    });

    expect(mockBuildPayload).toHaveBeenCalledWith(event, 42, undefined);
    expect(mockCreateJob).toHaveBeenCalledWith({
      eventId: 7,
      userId: "3",
      type: JobType.SCRIPT,
      priority: JobPriority.HIGH,
      payload: { executionLogId: 42 },
      source: JobSource.EVENT,
      timeoutMs: 120000,
      maxAttempts: 2,
      leaseLossPolicy: LeaseLossPolicy.RETRY,
      scheduledMiss: false,
      metadata: {
        eventName: "Nightly backup",
        triggeredBy: "schedule",
        logId: 42,
      },
    });

    // Log is linked back to the job.
    expect(mockUpdateLog).toHaveBeenCalledWith(42, {
      jobId: "job-1",
      status: LogStatus.PENDING,
    });

    // Birth audit row through the state machine.
    expect(mockRecordCreated).toHaveBeenCalledWith("job-1", "schedule", {
      eventId: 7,
      triggeredBy: "schedule",
      logId: 42,
    });

    // Scheduled dispatches count against maxExecutions and stamp lastRunAt.
    expect(mockRecordDispatch).toHaveBeenCalledWith(7);

    expect(incidentInserts()).toHaveLength(0);
  });

  it("re-authorizes the principal and event relations before dispatch", async () => {
    await dispatchEventJob(makeEvent(), { triggeredBy: "schedule" });

    expect(mockGetPrincipal).toHaveBeenCalledWith("3");
    expect(mockAssertRole).toHaveBeenCalledWith("ADMIN", "execute");
    expect(mockAssertRelations).toHaveBeenCalledWith(7, "3", "execute");
  });

  it("honors an explicit authorizedUserId over the event owner", async () => {
    await dispatchEventJob(makeEvent(), {
      triggeredBy: "manual",
      authorizedUserId: "u-9",
    });

    expect(mockGetPrincipal).toHaveBeenCalledWith("u-9");
    expect(mockAssertRelations).toHaveBeenCalledWith(7, "u-9", "execute");
    expect(mockCreateLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-9" }),
    );
    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-9" }),
    );
  });

  it("uses the actor override for the birth audit row", async () => {
    await dispatchEventJob(makeEvent(), {
      triggeredBy: "manual",
      actor: "user:u-1",
    });

    expect(mockRecordCreated).toHaveBeenCalledWith(
      "job-1",
      "user:u-1",
      expect.objectContaining({ triggeredBy: "manual" }),
    );
  });

  it("falls back to Unknown event name and NORMAL priority", async () => {
    await dispatchEventJob(makeEvent({ name: null, priority: null }), {
      triggeredBy: "schedule",
    });

    expect(mockCreateLog).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "Unknown" }),
    );
    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ priority: JobPriority.NORMAL }),
    );
  });

  it("propagates scheduledMiss and input", async () => {
    const event = makeEvent();
    await dispatchEventJob(event, {
      triggeredBy: "schedule",
      scheduledMiss: true,
      input: { key: "value" },
    });

    expect(mockBuildPayload).toHaveBeenCalledWith(event, 42, { key: "value" });
    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ scheduledMiss: true }),
    );
  });
});

describe("dispatchEventJob — trigger source and job type mapping", () => {
  it.each([
    ["manual", JobSource.MANUAL],
    ["workflow", JobSource.WORKFLOW_STEP],
    ["webhook", JobSource.WEBHOOK],
  ] as const)("maps %s to job source %s", async (triggeredBy, source) => {
    await dispatchEventJob(makeEvent(), { triggeredBy });

    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ source }),
    );
  });

  it.each([
    ["HTTP_REQUEST", JobType.HTTP_REQUEST],
    ["TOOL_ACTION", JobType.TOOL_ACTION],
  ] as const)(
    "%s events run in-process with a single attempt regardless of retries",
    async (eventType, jobType) => {
      await dispatchEventJob(makeEvent({ type: eventType, retries: 5 }), {
        triggeredBy: "schedule",
      });

      expect(mockCreateJob).toHaveBeenCalledWith(
        expect.objectContaining({ type: jobType, maxAttempts: 0 }),
      );
    },
  );

  it("defaults unknown event types to SCRIPT with the event's retry budget", async () => {
    await dispatchEventJob(makeEvent({ type: "PYTHON", retries: 3 }), {
      triggeredBy: "schedule",
    });

    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: JobType.SCRIPT, maxAttempts: 3 }),
    );
  });

  it("stamps workflow context into payload and metadata", async () => {
    await dispatchEventJob(makeEvent(), {
      triggeredBy: "workflow",
      workflowId: 11,
      workflowExecutionId: 22,
      workflowStepRunId: 33,
    });

    expect(mockCreateLog).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 11 }),
    );
    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          executionLogId: 42,
          workflowId: 11,
          workflowExecutionId: 22,
        },
        metadata: expect.objectContaining({
          workflowId: 11,
          workflowExecutionId: 22,
          workflowStepRunId: 33,
        }),
      }),
    );
  });
});

describe("dispatchEventJob — overlap policy", () => {
  it("passes activeKey only for SKIP overlap policy", async () => {
    await dispatchEventJob(makeEvent({ overlapPolicy: OverlapPolicy.SKIP }), {
      triggeredBy: "schedule",
    });

    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ activeKey: "7" }),
    );

    mockCreateJob.mockClear();
    await dispatchEventJob(makeEvent({ overlapPolicy: OverlapPolicy.QUEUE }), {
      triggeredBy: "schedule",
    });
    const input = mockCreateJob.mock.calls[0]![0] as Record<string, unknown>;
    expect("activeKey" in input).toBe(false);
  });

  it("records a SKIPPED_OVERLAP incident and finalizes the log on unique violation", async () => {
    mockCreateJob.mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505" }),
    );

    const result = await dispatchEventJob(
      makeEvent({ overlapPolicy: OverlapPolicy.SKIP }),
      { triggeredBy: "schedule" },
    );

    expect(result).toEqual({ job: null, logId: null, skipped: "overlap" });

    const incidents = incidentInserts();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.values).toEqual({
      eventId: 7,
      kind: ScheduleIncidentKind.SKIPPED_OVERLAP,
      details: { logId: 42, triggeredBy: "schedule" },
    });

    expect(mockUpdateLog).toHaveBeenCalledWith(42, {
      status: LogStatus.FAILURE,
      endTime: expect.any(Date),
      error: expect.stringContaining("overlap policy: SKIP"),
    });

    // The skip is not a dispatch: no birth row, no bookkeeping.
    expect(mockRecordCreated).not.toHaveBeenCalled();
    expect(mockRecordDispatch).not.toHaveBeenCalled();
  });

  it("rethrows non-unique-violation errors from job creation", async () => {
    mockCreateJob.mockRejectedValue(new Error("connection refused"));

    await expect(
      dispatchEventJob(makeEvent(), { triggeredBy: "schedule" }),
    ).rejects.toThrow("connection refused");

    expect(incidentInserts()).toHaveLength(0);
    expect(mockRecordCreated).not.toHaveBeenCalled();
  });
});

describe("dispatchEventJob — max executions", () => {
  it("auto-pauses the event at the cap and skips without creating a log or job", async () => {
    const result = await dispatchEventJob(
      makeEvent({ maxExecutions: 5, executionCount: 5 }),
      { triggeredBy: "schedule" },
    );

    expect(result).toEqual({
      job: null,
      logId: null,
      skipped: "max_executions",
    });

    expect(mockUpdateScript).toHaveBeenCalledWith(7, {
      status: EventStatus.PAUSED,
      nextRunAt: null,
    });
    const incidents = incidentInserts();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.values).toEqual({
      eventId: 7,
      kind: ScheduleIncidentKind.AUTO_PAUSED,
      details: { maxExecutions: 5 },
    });
    expect(mockDeleteScript).toHaveBeenCalledWith(7);
    expect(mockCreateLog).not.toHaveBeenCalled();
    expect(mockCreateJob).not.toHaveBeenCalled();
  });

  it("still skips when cancelling the legacy timer fails", async () => {
    mockDeleteScript.mockRejectedValue(new Error("timer gone"));

    const result = await dispatchEventJob(
      makeEvent({ maxExecutions: 1, executionCount: 1 }),
      { triggeredBy: "schedule" },
    );

    expect(result.skipped).toBe("max_executions");
  });

  it("dispatches while under the cap and when no cap is set", async () => {
    const under = await dispatchEventJob(
      makeEvent({ maxExecutions: 5, executionCount: 4 }),
      { triggeredBy: "schedule" },
    );
    expect(under.job).toBe(createdJob);

    const uncapped = await dispatchEventJob(
      makeEvent({ maxExecutions: 0, executionCount: 99 }),
      { triggeredBy: "schedule" },
    );
    expect(uncapped.job).toBe(createdJob);
  });

  it("exempts manual runs from the cap", async () => {
    const result = await dispatchEventJob(
      makeEvent({ maxExecutions: 1, executionCount: 1 }),
      { triggeredBy: "manual" },
    );

    expect(result.job).toBe(createdJob);
    expect(incidentInserts()).toHaveLength(0);
  });
});

describe("dispatchEventJob — authorization fails closed", () => {
  it("rejects before any write when the principal lookup fails", async () => {
    mockGetPrincipal.mockRejectedValue(new Error("User account is disabled"));

    await expect(
      dispatchEventJob(makeEvent(), { triggeredBy: "schedule" }),
    ).rejects.toThrow("User account is disabled");

    expect(mockCreateLog).not.toHaveBeenCalled();
    expect(mockCreateJob).not.toHaveBeenCalled();
  });

  it("rejects when the role lost the execute capability", async () => {
    mockAssertRole.mockImplementation(() => {
      throw new Error("Role VIEWER cannot execute");
    });

    await expect(
      dispatchEventJob(makeEvent(), { triggeredBy: "schedule" }),
    ).rejects.toThrow("Role VIEWER cannot execute");

    expect(mockCreateLog).not.toHaveBeenCalled();
  });

  it("rejects when event relations no longer authorize execution", async () => {
    mockAssertRelations.mockRejectedValue(new Error("Server access revoked"));

    await expect(
      dispatchEventJob(makeEvent(), { triggeredBy: "schedule" }),
    ).rejects.toThrow("Server access revoked");

    expect(mockCreateJob).not.toHaveBeenCalled();
  });
});

describe("dispatchEventJob — execution bookkeeping", () => {
  it("does not count manual runs", async () => {
    await dispatchEventJob(makeEvent(), { triggeredBy: "manual" });

    expect(mockRecordDispatch).not.toHaveBeenCalled();
  });

  it("delegates the increment to the database rather than computing it", async () => {
    await dispatchEventJob(makeEvent({ executionCount: 41 }), {
      triggeredBy: "webhook",
    });

    // Only the event id is passed: the new count is `execution_count + 1`
    // evaluated by Postgres. Passing a caller-computed number here would
    // reintroduce the lost-update race below.
    expect(mockRecordDispatch).toHaveBeenCalledWith(7);
    expect(mockUpdateScript).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ executionCount: expect.anything() }),
    );
  });

  it("does not lose increments when dispatches race on the same event", async () => {
    // Both dispatches see the same pre-read count, as they would when a
    // schedule tick and a webhook land together.
    const stale = makeEvent({ executionCount: 41 });

    await Promise.all([
      dispatchEventJob(stale, { triggeredBy: "schedule" }),
      dispatchEventJob(stale, { triggeredBy: "webhook" }),
    ]);

    // Two dispatches must produce two increments. A read-modify-write would
    // have written executionCount: 42 twice and lost one.
    expect(mockRecordDispatch).toHaveBeenCalledTimes(2);
    for (const call of mockRecordDispatch.mock.calls) {
      expect(call).toEqual([7]);
    }
  });

  it("swallows bookkeeping failures — the job is already enqueued", async () => {
    mockRecordDispatch.mockRejectedValue(new Error("db down"));

    const result = await dispatchEventJob(makeEvent(), {
      triggeredBy: "schedule",
    });

    expect(result).toEqual({ job: createdJob, logId: 42 });
  });
});
