/**
 * @jest-environment node
 */

/**
 * The retention window configuration, which needs no database. What each window
 * actually deletes is covered against real Postgres in
 * tests/storage/retention.test.ts.
 */

jest.mock("@/server/db", () => ({
  db: { transaction: jest.fn() },
}));

import { db } from "@/server/db";
import { retentionWindows, runRetention } from "../retention";
import { systemSettingsSchema } from "@/shared/schemas/admin";

const mockTransaction = db.transaction as jest.Mock;

const DEFAULTS = {
  jobs: 30,
  logs: 90,
  workflowExecutions: 90,
  scheduleIncidents: 90,
  toolActionLogs: 90,
  toolAuditLogs: 0,
  webhooks: 30,
};

const ALL_ZERO = {
  CRONIUM_JOB_RETENTION_DAYS: "0",
  CRONIUM_LOG_RETENTION_DAYS: "0",
  CRONIUM_WORKFLOW_RETENTION_DAYS: "0",
  CRONIUM_INCIDENT_RETENTION_DAYS: "0",
  CRONIUM_TOOL_ACTION_LOG_RETENTION_DAYS: "0",
  CRONIUM_TOOL_AUDIT_LOG_RETENTION_DAYS: "0",
  CRONIUM_WEBHOOK_RETENTION_DAYS: "0",
};

describe("retentionWindows", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("defaults to a longer window for user-visible history", () => {
    expect(retentionWindows({})).toEqual(DEFAULTS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads each window from its own variable", () => {
    expect(
      retentionWindows({
        CRONIUM_JOB_RETENTION_DAYS: "1",
        CRONIUM_LOG_RETENTION_DAYS: "2",
        CRONIUM_WORKFLOW_RETENTION_DAYS: "3",
        CRONIUM_INCIDENT_RETENTION_DAYS: "4",
        CRONIUM_TOOL_ACTION_LOG_RETENTION_DAYS: "5",
        CRONIUM_TOOL_AUDIT_LOG_RETENTION_DAYS: "7",
        CRONIUM_WEBHOOK_RETENTION_DAYS: "6",
      }),
    ).toEqual({
      jobs: 1,
      logs: 2,
      workflowExecutions: 3,
      scheduleIncidents: 4,
      toolActionLogs: 5,
      toolAuditLogs: 7,
      webhooks: 6,
    });
  });

  it.each([undefined, "", "   ", "0"])(
    "keeps the tool audit log forever when its variable is %j",
    (value) => {
      expect(
        retentionWindows({ CRONIUM_TOOL_AUDIT_LOG_RETENTION_DAYS: value })
          .toolAuditLogs,
      ).toBe(0);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("takes 0 to mean keep forever, for jobs too", () => {
    expect(retentionWindows({ CRONIUM_JOB_RETENTION_DAYS: "0" }).jobs).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("treats %j as unset", (value) => {
    expect(retentionWindows({ CRONIUM_LOG_RETENTION_DAYS: value }).logs).toBe(
      DEFAULTS.logs,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts a fraction of a day and surrounding whitespace", () => {
    const windows = retentionWindows({
      CRONIUM_JOB_RETENTION_DAYS: "0.5",
      CRONIUM_LOG_RETENTION_DAYS: " 14 ",
    });
    expect(windows.jobs).toBe(0.5);
    expect(windows.logs).toBe(14);
  });

  it.each(["never", "30d", "-1", "NaN", "Infinity", "36501", "1e12"])(
    "keeps data forever and warns on the unreadable value %j",
    (value) => {
      expect(retentionWindows({ CRONIUM_LOG_RETENTION_DAYS: value }).logs).toBe(
        0,
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("CRONIUM_LOG_RETENTION_DAYS"),
      );
    },
  );
});

describe("runRetention", () => {
  const environment = process.env;

  afterEach(() => {
    process.env = environment;
    mockTransaction.mockReset();
  });

  it("touches no table when every window is 0", async () => {
    process.env = { ...environment, ...ALL_ZERO };

    const result = await runRetention();

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(result.backlog).toBe(false);
    expect(result.failed).toEqual([]);
  });

  it("touches no table for a window that isn't a positive number", async () => {
    const result = await runRetention({
      windows: {
        jobs: Number.NaN,
        logs: -1,
        workflowExecutions: 0,
        scheduleIncidents: 0,
        toolActionLogs: 0,
        toolAuditLogs: 0,
        webhooks: 0,
      },
    });

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(result.failed).toEqual([]);
  });
});

describe("the removed logRetentionDays admin setting", () => {
  // The admin page sends the whole settings object back on every save, so a tab
  // left open across the upgrade must not be able to store the key again.
  it("is stripped from a settings update", () => {
    expect(
      systemSettingsSchema.parse({ logRetentionDays: 30 }),
    ).not.toHaveProperty("logRetentionDays");
  });
});
