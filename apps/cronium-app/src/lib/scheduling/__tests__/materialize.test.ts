/**
 * @jest-environment node
 */
/**
 * Unit tests for next_run_at materialization (materialize.ts). The db module
 * is factory-mocked with a small chainable stub; schedule-math runs for real
 * under a fixed fake clock so the computed instants are deterministic.
 */

jest.mock("@/server/db", () => ({
  db: {
    select: jest.fn(),
    update: jest.fn(),
    execute: jest.fn(),
  },
}));

import { db } from "@/server/db";
import {
  notifyScheduleChanged,
  refreshEventSchedule,
  refreshWorkflowSchedule,
} from "../materialize";
import {
  EventStatus,
  EventTriggerType,
  WorkflowTriggerType,
  ScheduleKind,
  TimeUnit,
} from "@/shared/schema";

const mockDb = db as unknown as {
  select: jest.Mock;
  update: jest.Mock;
  execute: jest.Mock;
};

const NOW = new Date("2026-07-20T10:00:00.000Z");

/** Rows returned by successive db.select() calls (one queue per test). */
let selectRows: unknown[][] = [];
/** The values passed to db.update(...).set(...) in call order. */
let updateSets: Array<Record<string, unknown>> = [];

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
  selectRows = [];
  updateSets = [];
  mockDb.select.mockReset().mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(selectRows.shift() ?? []),
      }),
    }),
  }));
  mockDb.update.mockReset().mockImplementation(() => ({
    set: (values: Record<string, unknown>) => {
      updateSets.push(values);
      return { where: () => Promise.resolve() };
    },
  }));
  mockDb.execute.mockReset().mockResolvedValue(undefined);
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  warnSpy.mockRestore();
});

const baseEvent = {
  id: 42,
  status: EventStatus.ACTIVE,
  triggerType: EventTriggerType.SCHEDULE,
  scheduleKind: ScheduleKind.INTERVAL,
  scheduleNumber: 5,
  scheduleUnit: TimeUnit.MINUTES,
  customSchedule: null,
  timezone: "UTC",
  startTime: null,
};

const baseWorkflow = {
  id: 7,
  status: EventStatus.ACTIVE,
  triggerType: WorkflowTriggerType.SCHEDULE,
  scheduleNumber: 10,
  scheduleUnit: TimeUnit.MINUTES,
  customSchedule: null,
};

describe("notifyScheduleChanged", () => {
  it("sends pg_notify for the event", async () => {
    await notifyScheduleChanged(42);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it("swallows pg_notify failures (accelerant only) with a warning", async () => {
    mockDb.execute.mockRejectedValue(new Error("connection reset"));
    await expect(notifyScheduleChanged(42)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("pg_notify failed for event 42"),
      "connection reset",
    );
  });
});

describe("refreshEventSchedule", () => {
  it("materializes next_run_at for an ACTIVE interval schedule", async () => {
    selectRows.push([baseEvent]);

    const next = await refreshEventSchedule(42);

    expect(next?.toISOString()).toBe("2026-07-20T10:05:00.000Z");
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).toMatchObject({ nextRunAt: next });
    expect(updateSets[0]!.updatedAt).toBeInstanceOf(Date);
    // Worker is notified so the change takes effect before the next poll.
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it("materializes next_run_at for an ACTIVE cron schedule in its timezone", async () => {
    selectRows.push([
      {
        ...baseEvent,
        scheduleKind: ScheduleKind.CRON,
        customSchedule: "0 9 * * *",
        timezone: "America/New_York",
      },
    ]);

    const next = await refreshEventSchedule(42);

    // From 10:00Z, 9am New York (EDT) is still ahead today at 13:00 UTC.
    expect(next?.toISOString()).toBe("2026-07-20T13:00:00.000Z");
    expect(updateSets[0]).toMatchObject({ nextRunAt: next });
  });

  it("uses a future start time as the first tick (one-shot floor)", async () => {
    selectRows.push([
      { ...baseEvent, startTime: new Date("2026-08-01T09:00:00.000Z") },
    ]);

    const next = await refreshEventSchedule(42);

    expect(next?.toISOString()).toBe("2026-08-01T09:00:00.000Z");
  });

  it("clears next_run_at for a paused event", async () => {
    selectRows.push([{ ...baseEvent, status: EventStatus.PAUSED }]);

    const next = await refreshEventSchedule(42);

    expect(next).toBeNull();
    expect(updateSets[0]).toMatchObject({ nextRunAt: null });
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it("clears next_run_at for a manually triggered event even when ACTIVE", async () => {
    selectRows.push([{ ...baseEvent, triggerType: EventTriggerType.MANUAL }]);

    const next = await refreshEventSchedule(42);

    expect(next).toBeNull();
    expect(updateSets[0]).toMatchObject({ nextRunAt: null });
    // No warning: this is a normal clear, not an invalid schedule.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("is a graceful no-op for a missing (deleted) event", async () => {
    selectRows.push([]);

    const next = await refreshEventSchedule(999);

    expect(next).toBeNull();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("clears next_run_at and warns for an ACTIVE event with an invalid cron", async () => {
    selectRows.push([
      {
        ...baseEvent,
        scheduleKind: ScheduleKind.CRON,
        customSchedule: "not a cron",
      },
    ]);

    const next = await refreshEventSchedule(42);

    expect(next).toBeNull();
    expect(updateSets[0]).toMatchObject({ nextRunAt: null });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("no computable next run"),
    );
  });

  it("clears next_run_at and warns for a CRON kind without an expression (null spec)", async () => {
    selectRows.push([
      { ...baseEvent, scheduleKind: ScheduleKind.CRON, customSchedule: null },
    ]);

    const next = await refreshEventSchedule(42);

    expect(next).toBeNull();
    expect(updateSets[0]).toMatchObject({ nextRunAt: null });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("clears next_run_at for a sub-floor interval (invalid schedule input)", async () => {
    selectRows.push([
      { ...baseEvent, scheduleNumber: 5, scheduleUnit: TimeUnit.SECONDS },
    ]);

    const next = await refreshEventSchedule(42);

    expect(next).toBeNull();
    expect(updateSets[0]).toMatchObject({ nextRunAt: null });
  });

  it("still persists and returns next when pg_notify fails", async () => {
    selectRows.push([baseEvent]);
    mockDb.execute.mockRejectedValue(new Error("notify down"));

    const next = await refreshEventSchedule(42);

    expect(next?.toISOString()).toBe("2026-07-20T10:05:00.000Z");
    expect(updateSets[0]).toMatchObject({ nextRunAt: next });
  });
});

describe("refreshWorkflowSchedule", () => {
  it("materializes next_run_at for an ACTIVE scheduled interval workflow", async () => {
    selectRows.push([baseWorkflow]);

    const next = await refreshWorkflowSchedule(7);

    expect(next?.toISOString()).toBe("2026-07-20T10:10:00.000Z");
    expect(updateSets[0]).toMatchObject({ nextRunAt: next });
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it("materializes next_run_at for a cron workflow (UTC)", async () => {
    selectRows.push([{ ...baseWorkflow, customSchedule: "0 12 * * *" }]);

    const next = await refreshWorkflowSchedule(7);

    expect(next?.toISOString()).toBe("2026-07-20T12:00:00.000Z");
  });

  it("clears next_run_at for a non-ACTIVE workflow", async () => {
    selectRows.push([{ ...baseWorkflow, status: EventStatus.DRAFT }]);

    const next = await refreshWorkflowSchedule(7);

    expect(next).toBeNull();
    expect(updateSets[0]).toMatchObject({ nextRunAt: null });
  });

  it("clears next_run_at for a webhook-triggered workflow", async () => {
    selectRows.push([
      { ...baseWorkflow, triggerType: WorkflowTriggerType.WEBHOOK },
    ]);

    const next = await refreshWorkflowSchedule(7);

    expect(next).toBeNull();
  });

  it("is a graceful no-op for a missing workflow", async () => {
    selectRows.push([]);

    const next = await refreshWorkflowSchedule(999);

    expect(next).toBeNull();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("warns and clears when an ACTIVE scheduled workflow has an invalid cron", async () => {
    selectRows.push([{ ...baseWorkflow, customSchedule: "banana" }]);

    const next = await refreshWorkflowSchedule(7);

    expect(next).toBeNull();
    expect(updateSets[0]).toMatchObject({ nextRunAt: null });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Workflow 7"));
  });

  it("swallows pg_notify failures on the workflow path", async () => {
    selectRows.push([baseWorkflow]);
    mockDb.execute.mockRejectedValue(new Error("notify down"));

    const next = await refreshWorkflowSchedule(7);

    expect(next?.toISOString()).toBe("2026-07-20T10:10:00.000Z");
  });
});
