/**
 * Retention against real Postgres. The FK constraints, row locks and timestamp
 * encoding are the point: a missing dependent delete surfaces as a genuine
 * 23503, and a shifted cutoff as a row on the wrong side of the boundary.
 *
 * Each test turns on only the windows it is about (see `pass`), so a row can only
 * disappear because of the purge under test.
 */
import { count, eq, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db, pool } from "@/server/db";
import {
  runRetention,
  type RetentionOptions,
  type RetentionWindows,
} from "@/lib/scheduling/retention";
import {
  events,
  executions,
  jobs,
  jobTransitions,
  logs,
  scheduleIncidents,
  servers,
  toolActionLogs,
  users,
  webhookDeliveries,
  webhookEvents,
  webhookLogs,
  webhooks,
  workflowExecutionEvents,
  workflowExecutions,
  workflowNodes,
  workflows,
  workflowStepRuns,
  JobStatus,
  LogStatus,
  ScheduleIncidentKind,
  WorkflowStepStatus,
} from "@/shared/schema";
import { resetDatabase, closePool } from "./helpers/db-reset";
import {
  seedEvent,
  seedExecution,
  seedFullGraph,
  seedJob,
  seedUser,
} from "./helpers/seed";

const DAY_MS = 86_400_000;
const NOW = new Date();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const ALL_OFF: RetentionWindows = {
  jobs: 0,
  logs: 0,
  workflowExecutions: 0,
  scheduleIncidents: 0,
  toolActionLogs: 0,
  webhooks: 0,
};

/** One retention pass with only the named windows on. */
function pass(
  windows: Partial<RetentionWindows>,
  options: Partial<RetentionOptions> = {},
) {
  return runRetention({
    now: NOW,
    windows: { ...ALL_OFF, ...windows },
    ...options,
  });
}

async function countRows(table: PgTable, where?: SQL): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(where);
  return row!.value;
}

async function seedOwner(): Promise<{ userId: string; eventId: number }> {
  const userId = await seedUser();
  return { userId, eventId: await seedEvent(userId) };
}

async function seedLog(
  eventId: number,
  values: Partial<typeof logs.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(logs)
    .values({ eventId, status: LogStatus.SUCCESS, ...values })
    .returning({ id: logs.id });
  return row!.id;
}

async function logExists(id: number): Promise<boolean> {
  return (await countRows(logs, eq(logs.id, id))) === 1;
}

async function jobExists(id: string): Promise<boolean> {
  return (await countRows(jobs, eq(jobs.id, id))) === 1;
}

async function seedWorkflow(userId: string): Promise<number> {
  const [row] = await db
    .insert(workflows)
    .values({ userId, name: "wf" })
    .returning({ id: workflows.id });
  return row!.id;
}

/** A workflow run with one telemetry row and one step row. */
async function seedRun(
  workflowId: number,
  userId: string,
  eventId: number,
  values: Partial<typeof workflowExecutions.$inferInsert> = {},
): Promise<number> {
  const [run] = await db
    .insert(workflowExecutions)
    .values({
      workflowId,
      userId,
      triggerType: "MANUAL",
      status: LogStatus.SUCCESS,
      ...values,
    })
    .returning({ id: workflowExecutions.id });
  await db.insert(workflowExecutionEvents).values({
    workflowExecutionId: run!.id,
    eventId,
    nodeId: 1,
    sequenceOrder: 1,
  });
  await db.insert(workflowStepRuns).values({
    workflowExecutionId: run!.id,
    nodeId: 1,
    eventId,
    status: WorkflowStepStatus.SUCCEEDED,
  });
  return run!.id;
}

async function runRowCounts(runId: number) {
  return {
    runs: await countRows(workflowExecutions, eq(workflowExecutions.id, runId)),
    events: await countRows(
      workflowExecutionEvents,
      eq(workflowExecutionEvents.workflowExecutionId, runId),
    ),
    steps: await countRows(
      workflowStepRuns,
      eq(workflowStepRuns.workflowExecutionId, runId),
    ),
  };
}

const RUN_GONE = { runs: 0, events: 0, steps: 0 };
const RUN_INTACT = { runs: 1, events: 1, steps: 1 };

async function seedWebhook(userId: string): Promise<number> {
  const [row] = await db
    .insert(webhooks)
    .values({
      userId,
      name: "hook",
      url: "https://example.test/hook",
      key: `key-${Math.random()}`,
      secret: "secret",
    })
    .returning({ id: webhooks.id });
  return row!.id;
}

async function seedWebhookEvent(createdAt: Date): Promise<number> {
  const [row] = await db
    .insert(webhookEvents)
    .values({ event: "ping", payload: {}, createdAt })
    .returning({ id: webhookEvents.id });
  return row!.id;
}

async function seedDelivery(
  webhookId: number,
  webhookEventId: number,
  attemptedAt: Date,
): Promise<number> {
  const [row] = await db
    .insert(webhookDeliveries)
    .values({
      webhookId,
      webhookEventId,
      deliveryId: `dlv-${Math.random()}`,
      status: "success",
      attemptedAt,
    })
    .returning({ id: webhookDeliveries.id });
  return row!.id;
}

beforeEach(async () => {
  await resetDatabase();
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await closePool();
});

describe("jobs", () => {
  it("removes a finished job with its executions and transitions, and detaches its logs", async () => {
    const { userId, eventId } = await seedOwner();
    const jobId = await seedJob(eventId, userId, {
      status: JobStatus.COMPLETED,
      completedAt: daysAgo(31),
    });
    const executionId = await seedExecution(jobId);
    await db
      .insert(jobTransitions)
      .values({ jobId, toStatus: JobStatus.COMPLETED, actor: "app" });
    const logId = await seedLog(eventId, {
      jobId,
      executionId,
      createdAt: daysAgo(31),
    });

    const result = await pass({ jobs: 30 });

    expect(result.deleted.jobs).toBe(1);
    expect(result.failed).toEqual([]);
    expect(await jobExists(jobId)).toBe(false);
    expect(await countRows(executions)).toBe(0);
    expect(await countRows(jobTransitions)).toBe(0);
    const [log] = await db.select().from(logs).where(eq(logs.id, logId));
    expect(log).toMatchObject({ jobId: null, executionId: null });
  });

  it("clears a log that references the execution but not the job", async () => {
    const { userId, eventId } = await seedOwner();
    const jobId = await seedJob(eventId, userId, {
      status: JobStatus.COMPLETED,
      completedAt: daysAgo(31),
    });
    const executionId = await seedExecution(jobId);
    const logId = await seedLog(eventId, { executionId });

    const result = await pass({ jobs: 30 });

    expect(result.failed).toEqual([]);
    expect(await jobExists(jobId)).toBe(false);
    const [log] = await db.select().from(logs).where(eq(logs.id, logId));
    expect(log?.executionId).toBeNull();
  });

  it.each([
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.TIMED_OUT,
    JobStatus.CANCELLED,
  ])(
    "purges a %s job past the window and keeps a recent one",
    async (status) => {
      const { userId, eventId } = await seedOwner();
      const old = await seedJob(eventId, userId, {
        status,
        completedAt: daysAgo(31),
      });
      const recent = await seedJob(eventId, userId, {
        status,
        completedAt: daysAgo(29),
      });

      await pass({ jobs: 30 });

      expect(await jobExists(old)).toBe(false);
      expect(await jobExists(recent)).toBe(true);
    },
  );

  it.each([JobStatus.QUEUED, JobStatus.CLAIMED, JobStatus.RUNNING])(
    "never purges a %s job, however old",
    async (status) => {
      const { userId, eventId } = await seedOwner();
      const jobId = await seedJob(eventId, userId, {
        status,
        completedAt: daysAgo(400),
        createdAt: daysAgo(400),
        updatedAt: daysAgo(400),
      });

      await pass({ jobs: 30 });

      expect(await jobExists(jobId)).toBe(true);
    },
  );

  describe("a finished job with no completed_at", () => {
    it("ages from updated_at", async () => {
      const { userId, eventId } = await seedOwner();
      const old = await seedJob(eventId, userId, {
        status: JobStatus.FAILED,
        completedAt: null,
        createdAt: daysAgo(40),
        updatedAt: daysAgo(31),
      });
      const recentlyTouched = await seedJob(eventId, userId, {
        status: JobStatus.FAILED,
        completedAt: null,
        createdAt: daysAgo(40),
        updatedAt: daysAgo(29),
      });

      const result = await pass({ jobs: 30 });

      expect(result.deleted.jobs).toBe(1);
      expect(await jobExists(old)).toBe(false);
      expect(await jobExists(recentlyTouched)).toBe(true);
    });
  });

  it("ages from completed_at when it has one, even if the row was touched later", async () => {
    const { userId, eventId } = await seedOwner();
    const jobId = await seedJob(eventId, userId, {
      status: JobStatus.COMPLETED,
      completedAt: daysAgo(31),
      updatedAt: daysAgo(1),
    });

    await pass({ jobs: 30 });

    expect(await jobExists(jobId)).toBe(false);
  });
});

describe("logs", () => {
  it("purges logs past the window and keeps recent ones", async () => {
    const { eventId } = await seedOwner();
    const old = await seedLog(eventId, {
      createdAt: daysAgo(91),
      endTime: daysAgo(91),
    });
    const recent = await seedLog(eventId, {
      createdAt: daysAgo(89),
      endTime: daysAgo(89),
    });

    const result = await pass({ logs: 90 });

    expect(result.deleted.logs).toBe(1);
    expect(await logExists(old)).toBe(false);
    expect(await logExists(recent)).toBe(true);
  });

  it("ages a long run from when it ended", async () => {
    const { eventId } = await seedOwner();
    const logId = await seedLog(eventId, {
      createdAt: daysAgo(100),
      endTime: daysAgo(89),
    });

    await pass({ logs: 90 });

    expect(await logExists(logId)).toBe(true);
  });

  it("keeps an old log while its job is still active", async () => {
    const { userId, eventId } = await seedOwner();
    const jobId = await seedJob(eventId, userId, {
      status: JobStatus.RUNNING,
    });
    const logId = await seedLog(eventId, {
      jobId,
      status: LogStatus.RUNNING,
      createdAt: daysAgo(400),
    });

    await pass({ logs: 90 });

    expect(await logExists(logId)).toBe(true);
  });

  it("purges a log left RUNNING once its job has finished", async () => {
    const { userId, eventId } = await seedOwner();
    const jobId = await seedJob(eventId, userId, {
      status: JobStatus.FAILED,
      completedAt: daysAgo(100),
    });
    const logId = await seedLog(eventId, {
      jobId,
      status: LogStatus.RUNNING,
      createdAt: daysAgo(100),
    });

    await pass({ logs: 90 });

    expect(await logExists(logId)).toBe(false);
    expect(await jobExists(jobId)).toBe(true);
  });

  it("purges a log left RUNNING whose job is already gone", async () => {
    const { eventId } = await seedOwner();
    const logId = await seedLog(eventId, {
      jobId: null,
      status: LogStatus.RUNNING,
      createdAt: daysAgo(100),
    });

    await pass({ logs: 90 });

    expect(await logExists(logId)).toBe(false);
  });

  it("purges a log before its job when the log window is the shorter one", async () => {
    const { userId, eventId } = await seedOwner();
    const jobId = await seedJob(eventId, userId, {
      status: JobStatus.COMPLETED,
      completedAt: daysAgo(10),
    });
    const logId = await seedLog(eventId, {
      jobId,
      createdAt: daysAgo(10),
      endTime: daysAgo(10),
    });

    const result = await pass({ logs: 7, jobs: 30 });

    expect(result.failed).toEqual([]);
    expect(await logExists(logId)).toBe(false);
    expect(await jobExists(jobId)).toBe(true);
  });
});

describe("schedule_incidents", () => {
  it("purges event and workflow incidents past the window and keeps recent ones", async () => {
    const { userId, eventId } = await seedOwner();
    const workflowId = await seedWorkflow(userId);
    await db.insert(scheduleIncidents).values([
      {
        eventId,
        kind: ScheduleIncidentKind.MISSED,
        createdAt: daysAgo(91),
      },
      {
        workflowId,
        kind: ScheduleIncidentKind.MISSED,
        createdAt: daysAgo(91),
      },
      {
        eventId,
        kind: ScheduleIncidentKind.MISSED,
        createdAt: daysAgo(89),
      },
    ]);

    const result = await pass({ scheduleIncidents: 90 });

    expect(result.deleted.schedule_incidents).toBe(2);
    expect(await countRows(scheduleIncidents)).toBe(1);
  });
});

describe("tool_action_logs", () => {
  it("purges rows past the window and keeps recent ones", async () => {
    const { eventId } = await seedOwner();
    const row = {
      eventId,
      toolType: "slack",
      actionType: "send_message",
      actionId: "act-1",
      status: "success",
    };
    await db.insert(toolActionLogs).values([
      { ...row, createdAt: daysAgo(91) },
      { ...row, createdAt: daysAgo(89) },
    ]);

    const result = await pass({ toolActionLogs: 90 });

    expect(result.deleted.tool_action_logs).toBe(1);
    expect(await countRows(toolActionLogs)).toBe(1);
  });
});

describe("workflow_executions", () => {
  it("removes a finished run with its step rows and leaves the workflow and recent runs", async () => {
    const { userId, eventId } = await seedOwner();
    const workflowId = await seedWorkflow(userId);
    const old = await seedRun(workflowId, userId, eventId, {
      completedAt: daysAgo(91),
    });
    const recent = await seedRun(workflowId, userId, eventId, {
      completedAt: daysAgo(89),
    });

    const result = await pass({ workflowExecutions: 90 });

    expect(result.deleted.workflow_executions).toBe(1);
    expect(await runRowCounts(old)).toEqual(RUN_GONE);
    expect(await runRowCounts(recent)).toEqual(RUN_INTACT);
    expect(await countRows(workflows)).toBe(1);
  });

  it.each([
    LogStatus.SUCCESS,
    LogStatus.FAILURE,
    LogStatus.TIMEOUT,
    LogStatus.PARTIAL,
  ])("purges a %s run past the window", async (status) => {
    const { userId, eventId } = await seedOwner();
    const workflowId = await seedWorkflow(userId);
    const runId = await seedRun(workflowId, userId, eventId, {
      status,
      completedAt: daysAgo(91),
    });

    await pass({ workflowExecutions: 90 });

    expect(await runRowCounts(runId)).toEqual(RUN_GONE);
  });

  it.each([LogStatus.RUNNING, LogStatus.PENDING])(
    "never purges a %s run, however old",
    async (status) => {
      const { userId, eventId } = await seedOwner();
      const workflowId = await seedWorkflow(userId);
      const runId = await seedRun(workflowId, userId, eventId, {
        status,
        startedAt: daysAgo(400),
        createdAt: daysAgo(400),
        updatedAt: daysAgo(400),
      });

      await pass({ workflowExecutions: 90 });

      expect(await runRowCounts(runId)).toEqual(RUN_INTACT);
    },
  );

  it("ages a finished run with no completed_at from updated_at", async () => {
    const { userId, eventId } = await seedOwner();
    const workflowId = await seedWorkflow(userId);
    const old = await seedRun(workflowId, userId, eventId, {
      completedAt: null,
      createdAt: daysAgo(100),
      updatedAt: daysAgo(91),
    });
    const recentlyTouched = await seedRun(workflowId, userId, eventId, {
      completedAt: null,
      createdAt: daysAgo(100),
      updatedAt: daysAgo(89),
    });

    await pass({ workflowExecutions: 90 });

    expect(await runRowCounts(old)).toEqual(RUN_GONE);
    expect(await runRowCounts(recentlyTouched)).toEqual(RUN_INTACT);
  });
});

describe("webhook delivery tables", () => {
  it("purges deliveries, logs and events past the window and keeps the webhook", async () => {
    const userId = await seedUser();
    const webhookId = await seedWebhook(userId);
    const oldEvent = await seedWebhookEvent(daysAgo(31));
    await seedDelivery(webhookId, oldEvent, daysAgo(31));
    const recentEvent = await seedWebhookEvent(daysAgo(29));
    await seedDelivery(webhookId, recentEvent, daysAgo(29));
    await db.insert(webhookLogs).values([
      { webhookId, success: true, createdAt: daysAgo(31) },
      { webhookId, success: true, createdAt: daysAgo(29) },
    ]);

    const result = await pass({ webhooks: 30 });

    expect(result.failed).toEqual([]);
    expect(result.deleted).toMatchObject({
      webhook_deliveries: 1,
      webhook_logs: 1,
      webhook_events: 1,
    });
    expect(await countRows(webhookEvents)).toBe(1);
    expect(await countRows(webhookDeliveries)).toBe(1);
    expect(await countRows(webhookLogs)).toBe(1);
    expect(await countRows(webhooks)).toBe(1);
  });

  it("keeps an old event that still has a recent delivery, and that delivery", async () => {
    const userId = await seedUser();
    const webhookId = await seedWebhook(userId);
    const eventId = await seedWebhookEvent(daysAgo(60));
    const oldDelivery = await seedDelivery(webhookId, eventId, daysAgo(60));
    const retried = await seedDelivery(webhookId, eventId, daysAgo(1));

    const result = await pass({ webhooks: 30 });

    expect(result.deleted.webhook_events).toBe(0);
    expect(await countRows(webhookEvents)).toBe(1);
    const remaining = await db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries);
    expect(remaining.map((row) => row.id)).toEqual([retried]);
    expect(remaining.map((row) => row.id)).not.toContain(oldDelivery);
  });

  it("purges an old event that never had a delivery", async () => {
    await seedWebhookEvent(daysAgo(31));

    await pass({ webhooks: 30 });

    expect(await countRows(webhookEvents)).toBe(0);
  });
});

/** One expired row in every purged table, ten years old. */
async function seedExpiredEverywhere() {
  const { userId, eventId } = await seedOwner();
  const workflowId = await seedWorkflow(userId);
  const webhookId = await seedWebhook(userId);
  const old = daysAgo(3650);

  await seedJob(eventId, userId, {
    status: JobStatus.COMPLETED,
    completedAt: old,
  });
  await seedLog(eventId, { createdAt: old, endTime: old });
  await seedRun(workflowId, userId, eventId, { completedAt: old });
  await db.insert(scheduleIncidents).values({
    eventId,
    kind: ScheduleIncidentKind.MISSED,
    createdAt: old,
  });
  await db.insert(toolActionLogs).values({
    eventId,
    toolType: "slack",
    actionType: "send_message",
    actionId: "act-1",
    status: "success",
    createdAt: old,
  });
  const webhookEventId = await seedWebhookEvent(old);
  await seedDelivery(webhookId, webhookEventId, old);
  await db
    .insert(webhookLogs)
    .values({ webhookId, success: true, createdAt: old });
}

const NOTHING_DELETED = {
  logs: 0,
  jobs: 0,
  workflow_executions: 0,
  schedule_incidents: 0,
  tool_action_logs: 0,
  webhook_deliveries: 0,
  webhook_logs: 0,
  webhook_events: 0,
};

describe("windows", () => {
  it.each([
    ["jobs", { jobs: 1 }],
    ["logs", { logs: 1 }],
    ["workflowExecutions", { workflow_executions: 1 }],
    ["scheduleIncidents", { schedule_incidents: 1 }],
    ["toolActionLogs", { tool_action_logs: 1 }],
    ["webhooks", { webhook_deliveries: 1, webhook_logs: 1, webhook_events: 1 }],
  ] as const)(
    "the %s window only purges its own tables",
    async (name, expected) => {
      await seedExpiredEverywhere();

      const result = await pass({ [name]: 30 });

      expect(result.deleted).toEqual({ ...NOTHING_DELETED, ...expected });
    },
  );

  describe("from the environment", () => {
    const VARIABLES = [
      "CRONIUM_JOB_RETENTION_DAYS",
      "CRONIUM_LOG_RETENTION_DAYS",
      "CRONIUM_WORKFLOW_RETENTION_DAYS",
      "CRONIUM_INCIDENT_RETENTION_DAYS",
      "CRONIUM_TOOL_ACTION_LOG_RETENTION_DAYS",
      "CRONIUM_WEBHOOK_RETENTION_DAYS",
    ];
    const saved = new Map<string, string | undefined>();

    beforeEach(() => {
      for (const name of VARIABLES) {
        saved.set(name, process.env[name]);
        delete process.env[name];
      }
    });

    afterEach(() => {
      for (const name of VARIABLES) {
        const value = saved.get(name);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    it("keeps user-visible history for 90 days and queue and webhook rows for 30 by default", async () => {
      const { userId, eventId } = await seedOwner();
      const workflowId = await seedWorkflow(userId);
      const webhookId = await seedWebhook(userId);
      const toolLog = {
        eventId,
        toolType: "slack",
        actionType: "send_message",
        actionId: "act-1",
        status: "success",
      };

      // One row just past each default window...
      await seedLog(eventId, { createdAt: daysAgo(91) });
      await seedJob(eventId, userId, {
        status: JobStatus.COMPLETED,
        completedAt: daysAgo(31),
      });
      await seedRun(workflowId, userId, eventId, { completedAt: daysAgo(91) });
      await db.insert(scheduleIncidents).values({
        eventId,
        kind: ScheduleIncidentKind.MISSED,
        createdAt: daysAgo(91),
      });
      await db
        .insert(toolActionLogs)
        .values({ ...toolLog, createdAt: daysAgo(91) });
      const oldWebhookEvent = await seedWebhookEvent(daysAgo(31));
      await seedDelivery(webhookId, oldWebhookEvent, daysAgo(31));
      await db
        .insert(webhookLogs)
        .values({ webhookId, success: true, createdAt: daysAgo(31) });

      // ...and one just inside it, which must survive.
      await seedLog(eventId, { createdAt: daysAgo(89) });
      await seedJob(eventId, userId, {
        status: JobStatus.COMPLETED,
        completedAt: daysAgo(29),
      });
      await seedRun(workflowId, userId, eventId, { completedAt: daysAgo(89) });
      await db.insert(scheduleIncidents).values({
        eventId,
        kind: ScheduleIncidentKind.MISSED,
        createdAt: daysAgo(89),
      });
      await db
        .insert(toolActionLogs)
        .values({ ...toolLog, createdAt: daysAgo(89) });
      const recentWebhookEvent = await seedWebhookEvent(daysAgo(29));
      await seedDelivery(webhookId, recentWebhookEvent, daysAgo(29));
      await db
        .insert(webhookLogs)
        .values({ webhookId, success: true, createdAt: daysAgo(29) });

      const result = await runRetention({ now: NOW });

      expect(result.failed).toEqual([]);
      expect(result.deleted).toEqual({
        logs: 1,
        jobs: 1,
        workflow_executions: 1,
        schedule_incidents: 1,
        tool_action_logs: 1,
        webhook_deliveries: 1,
        webhook_logs: 1,
        webhook_events: 1,
      });
      for (const table of [
        logs,
        jobs,
        workflowExecutions,
        scheduleIncidents,
        toolActionLogs,
        webhookEvents,
        webhookDeliveries,
        webhookLogs,
      ]) {
        expect(await countRows(table)).toBe(1);
      }
    });

    it("keeps every table forever when its window is 0", async () => {
      for (const name of VARIABLES) process.env[name] = "0";
      await seedExpiredEverywhere();

      const result = await runRetention({ now: NOW });

      expect(result.deleted).toEqual(NOTHING_DELETED);
    });

    it("gives each table its own variable", async () => {
      process.env.CRONIUM_LOG_RETENTION_DAYS = "0";
      await seedExpiredEverywhere();

      const result = await runRetention({ now: NOW });

      expect(result.deleted).toMatchObject({ logs: 0, jobs: 1 });
    });

    it("treats an empty variable as unset, not as keep forever", async () => {
      process.env.CRONIUM_LOG_RETENTION_DAYS = "";
      const { eventId } = await seedOwner();
      const old = await seedLog(eventId, { createdAt: daysAgo(91) });
      const recent = await seedLog(eventId, { createdAt: daysAgo(89) });

      await runRetention({ now: NOW });

      expect(await logExists(old)).toBe(false);
      expect(await logExists(recent)).toBe(true);
    });

    it("deletes nothing from a table whose variable it cannot read", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      process.env.CRONIUM_LOG_RETENTION_DAYS = "never";
      await seedExpiredEverywhere();

      const result = await runRetention({ now: NOW });

      expect(result.deleted).toMatchObject({ logs: 0, jobs: 1 });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("CRONIUM_LOG_RETENTION_DAYS"),
      );
    });
  });

  /**
   * These columns have no time zone and hold UTC, so a cutoff formatted in local
   * time lands hours off. Rows an hour either side of the cutoff catch that on
   * any non-UTC host, for both the column-bound and the COALESCE comparisons.
   */
  it("applies the cutoff to the hour", async () => {
    const { userId, eventId } = await seedOwner();
    const workflowId = await seedWorkflow(userId);
    const hours = (count: number) => count * 3_600_000;
    const pastCutoff = new Date(daysAgo(30).getTime() - hours(1));
    const insideCutoff = new Date(daysAgo(30).getTime() + hours(1));

    const oldLog = await seedLog(eventId, { createdAt: pastCutoff });
    const newLog = await seedLog(eventId, { createdAt: insideCutoff });
    const oldJob = await seedJob(eventId, userId, {
      status: JobStatus.COMPLETED,
      completedAt: pastCutoff,
    });
    const newJob = await seedJob(eventId, userId, {
      status: JobStatus.COMPLETED,
      completedAt: insideCutoff,
    });
    const oldRun = await seedRun(workflowId, userId, eventId, {
      completedAt: pastCutoff,
    });
    const newRun = await seedRun(workflowId, userId, eventId, {
      completedAt: insideCutoff,
    });

    await pass({ logs: 30, jobs: 30, workflowExecutions: 30 });

    expect(await logExists(oldLog)).toBe(false);
    expect(await logExists(newLog)).toBe(true);
    expect(await jobExists(oldJob)).toBe(false);
    expect(await jobExists(newJob)).toBe(true);
    expect(await runRowCounts(oldRun)).toEqual(RUN_GONE);
    expect(await runRowCounts(newRun)).toEqual(RUN_INTACT);
  });
});

describe("batching", () => {
  it("works through more rows than fit in one batch", async () => {
    const { userId, eventId } = await seedOwner();
    const workflowId = await seedWorkflow(userId);
    for (let i = 0; i < 5; i++) {
      await seedLog(eventId, { createdAt: daysAgo(31) });
      await seedJob(eventId, userId, {
        status: JobStatus.COMPLETED,
        completedAt: daysAgo(31),
      });
      await seedRun(workflowId, userId, eventId, { completedAt: daysAgo(31) });
    }

    const result = await pass(
      { logs: 30, jobs: 30, workflowExecutions: 30 },
      { batchSize: 2 },
    );

    expect(result.deleted).toMatchObject({
      logs: 5,
      jobs: 5,
      workflow_executions: 5,
    });
    expect(result.backlog).toBe(false);
    expect(await countRows(workflowStepRuns)).toBe(0);
    expect(await countRows(workflowExecutionEvents)).toBe(0);
  });

  it("stops at the cap, reports the backlog, and the next pass carries on", async () => {
    const { eventId } = await seedOwner();
    for (let i = 0; i < 5; i++) {
      await seedLog(eventId, { createdAt: daysAgo(31) });
    }
    const options = { batchSize: 2, maxBatches: 2 };

    const first = await pass({ logs: 30 }, options);
    expect(first.deleted.logs).toBe(4);
    expect(first.backlog).toBe(true);

    const second = await pass({ logs: 30 }, options);
    expect(second.deleted.logs).toBe(1);
    expect(second.backlog).toBe(false);
    expect(await countRows(logs)).toBe(0);
  });

  it("caps each table separately, so a large one cannot starve the rest", async () => {
    const { eventId } = await seedOwner();
    for (let i = 0; i < 5; i++) {
      await seedLog(eventId, { createdAt: daysAgo(31) });
    }
    await db.insert(scheduleIncidents).values({
      eventId,
      kind: ScheduleIncidentKind.MISSED,
      createdAt: daysAgo(31),
    });

    const result = await pass(
      { logs: 30, scheduleIncidents: 30 },
      { batchSize: 2, maxBatches: 1 },
    );

    expect(result.deleted).toMatchObject({ logs: 2, schedule_incidents: 1 });
    expect(result.backlog).toBe(true);
  });
});

describe("running alongside other work", () => {
  it("lets two concurrent passes share the work with no row counted twice", async () => {
    const { eventId } = await seedOwner();
    for (let i = 0; i < 40; i++) {
      await seedLog(eventId, { createdAt: daysAgo(31) });
    }
    const options = { batchSize: 5 };

    const [a, b] = await Promise.all([
      pass({ logs: 30 }, options),
      pass({ logs: 30 }, options),
    ]);

    expect(a.failed).toEqual([]);
    expect(b.failed).toEqual([]);
    expect(a.deleted.logs + b.deleted.logs).toBe(40);
    expect(await countRows(logs)).toBe(0);
  });

  it("skips a locked row instead of waiting on it, and takes it on a later pass", async () => {
    const { eventId } = await seedOwner();
    const held = await seedLog(eventId, { createdAt: daysAgo(31) });
    const free = await seedLog(eventId, { createdAt: daysAgo(31) });
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM logs WHERE id = $1 FOR UPDATE", [
        held,
      ]);

      await pass({ logs: 30 });

      expect(await logExists(free)).toBe(false);
      expect(await logExists(held)).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    await pass({ logs: 30 });
    expect(await logExists(held)).toBe(false);
  });

  it("carries on with the other tables when one purge fails", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    await seedExpiredEverywhere();
    await pool.query(`
      CREATE FUNCTION retention_test_fail() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'purge failed on purpose'; END
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER retention_test_fail BEFORE DELETE ON schedule_incidents
      FOR EACH ROW EXECUTE FUNCTION retention_test_fail()
    `);

    try {
      const result = await pass({
        jobs: 30,
        logs: 30,
        workflowExecutions: 30,
        scheduleIncidents: 30,
        toolActionLogs: 30,
        webhooks: 30,
      });

      expect(result.failed).toEqual(["schedule_incidents"]);
      expect(result.deleted).toEqual({
        logs: 1,
        jobs: 1,
        workflow_executions: 1,
        schedule_incidents: 0,
        tool_action_logs: 1,
        webhook_deliveries: 1,
        webhook_logs: 1,
        webhook_events: 1,
      });
      expect(await countRows(scheduleIncidents)).toBe(1);
      // Logged with its cause: Drizzle's own message is only the failed SQL.
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("schedule_incidents"),
        expect.objectContaining({
          cause: expect.objectContaining({
            message: "purge failed on purpose",
          }),
        }),
      );
    } finally {
      await pool.query(
        "DROP TRIGGER retention_test_fail ON schedule_incidents",
      );
      await pool.query("DROP FUNCTION retention_test_fail()");
    }
  });
});

describe("a fully connected graph", () => {
  const LATER = new Date(NOW.getTime() + 400 * DAY_MS);

  async function seedFinishedGraph() {
    const graph = await seedFullGraph();
    await db
      .update(workflowExecutions)
      .set({ status: LogStatus.SUCCESS, completedAt: NOW })
      .where(eq(workflowExecutions.id, graph.workflowExecutionId));
    return graph;
  }

  it("clears all history with no FK violation and leaves every definition", async () => {
    await seedFinishedGraph();
    const definitions = [
      users,
      events,
      servers,
      workflows,
      workflowNodes,
      webhooks,
    ];
    const before = await Promise.all(definitions.map((t) => countRows(t)));

    const result = await runRetention({
      now: LATER,
      windows: {
        jobs: 30,
        logs: 30,
        workflowExecutions: 30,
        scheduleIncidents: 30,
        toolActionLogs: 30,
        webhooks: 30,
      },
    });

    expect(result.failed).toEqual([]);
    for (const table of [
      logs,
      jobs,
      executions,
      jobTransitions,
      workflowExecutions,
      workflowExecutionEvents,
      workflowStepRuns,
      scheduleIncidents,
      toolActionLogs,
      webhookEvents,
      webhookDeliveries,
      webhookLogs,
    ]) {
      expect(await countRows(table)).toBe(0);
    }
    expect(await Promise.all(definitions.map((t) => countRows(t)))).toEqual(
      before,
    );
    expect(before.every((rows) => rows > 0)).toBe(true);
  });

  it("detaches logs, with no FK violation, when only jobs age out", async () => {
    const graph = await seedFinishedGraph();
    const logsBefore = await countRows(logs);

    const result = await runRetention({
      now: LATER,
      windows: { ...ALL_OFF, jobs: 30 },
    });

    expect(result.failed).toEqual([]);
    expect(await jobExists(graph.jobId)).toBe(false);
    expect(await countRows(logs)).toBe(logsBefore);
    expect(await countRows(logs, eq(logs.jobId, graph.jobId))).toBe(0);
  });

  it("keeps a second user's recent graph when another's has aged out", async () => {
    const graph = await seedFinishedGraph();
    await db
      .update(jobs)
      .set({ completedAt: daysAgo(31) })
      .where(eq(jobs.id, graph.jobId));
    const bystander = await seedFinishedGraph();
    await db
      .update(jobs)
      .set({ completedAt: daysAgo(1) })
      .where(eq(jobs.id, bystander.jobId));

    await pass({ jobs: 30 });

    expect(await jobExists(graph.jobId)).toBe(false);
    expect(await jobExists(bystander.jobId)).toBe(true);
    expect(
      await countRows(executions, eq(executions.jobId, bystander.jobId)),
    ).toBe(1);
  });
});
