/**
 * The move_misfiled_timeout_logs migration, against lines in the shape the cleanup
 * service used to write. The harness pushes the schema instead of running
 * migrations, so these tests run the migration's own file.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { db, pool } from "@/server/db";
import { storage } from "@/server/storage";
import { WorkflowCleanupService } from "@/lib/services/workflow-cleanup-service";
import {
  workflowExecutions,
  workflowLogs,
  workflows,
  LogStatus,
  WorkflowLogLevel,
} from "@/shared/schema";
import { resetDatabase, closePool } from "./helpers/db-reset";
import { seedUser } from "./helpers/seed";

const DRIZZLE_DIR = join(__dirname, "../../apps/cronium-app/drizzle");
// By suffix, because its number changes if another migration lands first.
const migrationFile = readdirSync(DRIZZLE_DIR).find((name) =>
  name.endsWith("_move_misfiled_timeout_logs.sql"),
);
const migration = readFileSync(join(DRIZZLE_DIR, migrationFile!), "utf8");

const MAX_AGE_MS = 30 * 60 * 1000;
const MESSAGE = "Workflow execution timed out after 1800s";

async function applyMigration(): Promise<number> {
  const result = await pool.query(migration);
  return result.rowCount ?? 0;
}

async function seedWorkflow(userId: string): Promise<number> {
  const [row] = await db
    .insert(workflows)
    .values({ userId, name: `wf-${userId}` })
    .returning({ id: workflows.id });
  return row!.id;
}

async function seedRun(
  workflowId: number,
  userId: string,
  values: Partial<typeof workflowExecutions.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(workflowExecutions)
    .values({
      workflowId,
      userId,
      triggerType: "MANUAL",
      status: LogStatus.RUNNING,
      ...values,
    })
    .returning({ id: workflowExecutions.id });
  return row!.id;
}

/** One line, with the run's id as workflow_id and no owner, as the old code wrote. */
async function seedOldLine(
  runId: number,
  now: Date,
  values: Partial<typeof workflowLogs.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(workflowLogs)
    .values({
      workflowId: runId,
      status: LogStatus.TIMEOUT,
      startTime: now,
      level: WorkflowLogLevel.ERROR,
      message: MESSAGE,
      timestamp: now,
      ...values,
    })
    .returning({ id: workflowLogs.id });
  return row!.id;
}

/** What the old code did to time out a run: one `now` for the run and its line. */
async function timeOutTheOldWay(
  runId: number,
  now: Date = new Date(),
): Promise<number> {
  await db
    .update(workflowExecutions)
    .set({
      status: LogStatus.TIMEOUT,
      completedAt: now,
      totalDuration: MAX_AGE_MS,
    })
    .where(eq(workflowExecutions.id, runId));
  return seedOldLine(runId, now);
}

async function lineById(id: number) {
  const [row] = await db
    .select()
    .from(workflowLogs)
    .where(eq(workflowLogs.id, id));
  return row!;
}

/** The rows an owner reads for this workflow. */
async function logsOf(workflowId: number) {
  const { logs } = await storage.getWorkflowLogs(workflowId, 50);
  return logs;
}

/** Workflows 1 and 2 for two users, and run 2 on the first user's workflow, so
 * the run's line lands on the second user's workflow. */
async function seedCollision() {
  const userA = await seedUser();
  const userB = await seedUser();
  const workflowA = await seedWorkflow(userA);
  const workflowB = await seedWorkflow(userB);
  await seedRun(workflowA, userA, {
    status: LogStatus.SUCCESS,
    completedAt: new Date(),
  });
  const run = await seedRun(workflowA, userA);
  expect(run).toBe(workflowB);
  return { userA, userB, workflowA, workflowB, run };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe("lines it moves", () => {
  it("takes a line off another user's workflow and gives it to the run's owner", async () => {
    const { userA, workflowA, workflowB, run } = await seedCollision();
    const line = await timeOutTheOldWay(run);
    expect((await logsOf(workflowB)).map((row) => row.id)).toEqual([line]);

    expect(await applyMigration()).toBe(1);

    expect(await logsOf(workflowB)).toEqual([]);
    expect(await logsOf(workflowA)).toEqual([
      expect.objectContaining({
        id: line,
        workflowId: workflowA,
        userId: userA,
      }),
    ]);
  });

  it("changes nothing else on the line", async () => {
    const { userA, workflowA, run } = await seedCollision();
    const line = await timeOutTheOldWay(run);
    const before = await lineById(line);

    await applyMigration();

    expect(await lineById(line)).toEqual({
      ...before,
      workflowId: workflowA,
      userId: userA,
    });
  });

  it("fills in the owner when the line was already on the right workflow", async () => {
    const userId = await seedUser();
    const workflowId = await seedWorkflow(userId);
    const run = await seedRun(workflowId, userId);
    expect(run).toBe(workflowId);
    const line = await timeOutTheOldWay(run);

    expect(await applyMigration()).toBe(1);

    expect(await lineById(line)).toMatchObject({ workflowId, userId });
  });

  it("swaps two lines that each sit on the other run's workflow", async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const workflowA = await seedWorkflow(userA);
    const workflowB = await seedWorkflow(userB);
    const runOfB = await seedRun(workflowB, userB);
    const runOfA = await seedRun(workflowA, userA);
    expect([runOfB, runOfA]).toEqual([workflowA, workflowB]);
    const lineOfB = await timeOutTheOldWay(runOfB);
    const lineOfA = await timeOutTheOldWay(runOfA);

    expect(await applyMigration()).toBe(2);

    expect(await lineById(lineOfA)).toMatchObject({
      workflowId: workflowA,
      userId: userA,
    });
    expect(await lineById(lineOfB)).toMatchObject({
      workflowId: workflowB,
      userId: userB,
    });
  });

  it("does nothing the second time", async () => {
    const { run } = await seedCollision();
    const line = await timeOutTheOldWay(run);
    await applyMigration();
    const after = await lineById(line);

    expect(await applyMigration()).toBe(0);

    expect(await lineById(line)).toEqual(after);
  });
});

describe("lines it can't tie to a run", () => {
  it("leaves a line whose run has been deleted", async () => {
    const { workflowB, run } = await seedCollision();
    const line = await timeOutTheOldWay(run);
    await db.delete(workflowExecutions).where(eq(workflowExecutions.id, run));

    expect(await applyMigration()).toBe(0);

    expect(await lineById(line)).toMatchObject({
      workflowId: workflowB,
      userId: null,
    });
  });

  it("moves only the second line of a run timed out twice", async () => {
    const { userA, workflowA, workflowB, run } = await seedCollision();
    const first = await timeOutTheOldWay(run, new Date(Date.now() - 60_000));
    const second = await timeOutTheOldWay(run);

    expect(await applyMigration()).toBe(1);

    expect(await lineById(first)).toMatchObject({
      workflowId: workflowB,
      userId: null,
    });
    expect(await lineById(second)).toMatchObject({
      workflowId: workflowA,
      userId: userA,
    });
  });

  it("leaves a line when the run with that number didn't time out", async () => {
    const { userA, workflowA, workflowB } = await seedCollision();
    const now = new Date();
    await db
      .update(workflowExecutions)
      .set({ status: LogStatus.SUCCESS, completedAt: now })
      .where(eq(workflowExecutions.id, workflowB));
    const line = await seedOldLine(workflowB, now);
    await seedRun(workflowA, userA);

    expect(await applyMigration()).toBe(0);

    expect(await lineById(line)).toMatchObject({
      workflowId: workflowB,
      userId: null,
    });
  });

  it.each<[string, Partial<typeof workflowLogs.$inferInsert>]>([
    ["has an owner", { userId: "someone-else" }],
    ["has another status", { status: LogStatus.FAILURE }],
    ["has another level", { level: WorkflowLogLevel.WARNING }],
    [
      "has another message",
      { message: "Workflow execution 2 finished: 1 succeeded, 0 failed" },
    ],
    ["has another timestamp", { timestamp: new Date(1_000_000) }],
  ])("leaves a line that %s", async (_label, difference) => {
    const { workflowB, run } = await seedCollision();
    const now = new Date();
    await db
      .update(workflowExecutions)
      .set({ status: LogStatus.TIMEOUT, completedAt: now })
      .where(eq(workflowExecutions.id, run));
    const line = await seedOldLine(run, now, difference);
    const before = await lineById(line);
    expect(before.workflowId).toBe(workflowB);

    expect(await applyMigration()).toBe(0);

    expect(await lineById(line)).toEqual(before);
  });

  it("leaves a line the fixed service wrote", async () => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const { workflowA, run } = await seedCollision();
    const service = new WorkflowCleanupService({ maxWorkflowAge: MAX_AGE_MS });
    await expect(service.cleanupWorkflow(run)).resolves.toBe(true);
    const [before] = await logsOf(workflowA);

    expect(await applyMigration()).toBe(0);

    expect(await logsOf(workflowA)).toEqual([before]);
    jest.restoreAllMocks();
  });
});

it("is marked to run on legacy databases too", () => {
  // run-migrations.cjs stamps every migration on a database created by the old
  // push flow, and executes only the ones carrying this marker.
  expect(migration).toContain("-- cronium:custom-migration");
});
