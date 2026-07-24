/**
 * Workflow event-log persistence — exercises the tables the Phase 1 event-
 * sourced engine relies on (workflow_executions, workflow_execution_events,
 * workflow_step_runs) through their real storage/db write paths, and pins the
 * ON DELETE CASCADE behavior that deleteWorkflow depends on.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { storage } from "@/server/storage";
import {
  workflows,
  workflowExecutions,
  workflowExecutionEvents,
  workflowStepRuns,
  LogStatus,
  WorkflowStepStatus,
} from "@/shared/schema";
import { resetDatabase, closePool } from "./helpers/db-reset";
import { seedUser, seedEvent } from "./helpers/seed";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

async function createWorkflowWithEvent() {
  const userId = await seedUser();
  const eventId = await seedEvent(userId);
  const workflow = await storage.createWorkflow({ userId, name: "wf" });
  const node = await storage.createWorkflowNode({
    workflowId: workflow.id,
    eventId,
  });
  return { userId, eventId, workflowId: workflow.id, nodeId: node.id };
}

describe("workflow execution persistence", () => {
  it("persists a workflow execution and its execution-events with correct FKs", async () => {
    const { userId, eventId, workflowId, nodeId } =
      await createWorkflowWithEvent();

    const execution = await storage.createWorkflowExecution({
      workflowId,
      userId,
      triggerType: "MANUAL",
      status: LogStatus.RUNNING,
    });
    expect(execution.id).toBeGreaterThan(0);
    expect(execution.workflowId).toBe(workflowId);

    const evt = await storage.createWorkflowExecutionEvent({
      workflowExecutionId: execution.id,
      eventId,
      nodeId,
      sequenceOrder: 1,
      status: LogStatus.SUCCESS,
    });
    expect(evt.workflowExecutionId).toBe(execution.id);

    // Reads back through the join-returning storage method.
    const events = await storage.getWorkflowExecutionEvents(execution.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventId).toBe(eventId);
    expect(events[0]!.status).toBe(LogStatus.SUCCESS);
  });

  it("persists engine step-runs (source-of-truth rows) via the db write path", async () => {
    const { userId, eventId, workflowId, nodeId } =
      await createWorkflowWithEvent();
    const execution = await storage.createWorkflowExecution({
      workflowId,
      userId,
      triggerType: "MANUAL",
    });

    await db.insert(workflowStepRuns).values({
      workflowExecutionId: execution.id,
      nodeId,
      eventId,
      status: WorkflowStepStatus.SUCCEEDED,
      output: { result: 42 },
      condition: true,
    });

    const [row] = await db
      .select()
      .from(workflowStepRuns)
      .where(eq(workflowStepRuns.workflowExecutionId, execution.id));
    expect(row!.status).toBe(WorkflowStepStatus.SUCCEEDED);
    expect(row!.output).toEqual({ result: 42 });
    expect(row!.condition).toBe(true);
  });
});

describe("deleteWorkflow cascade matches the FK-delete suite's assertions", () => {
  it("removes executions, execution-events and step-runs when the workflow is deleted", async () => {
    const { userId, eventId, workflowId, nodeId } =
      await createWorkflowWithEvent();
    const execution = await storage.createWorkflowExecution({
      workflowId,
      userId,
      triggerType: "MANUAL",
    });
    await storage.createWorkflowExecutionEvent({
      workflowExecutionId: execution.id,
      eventId,
      nodeId,
      sequenceOrder: 1,
    });
    await db.insert(workflowStepRuns).values({
      workflowExecutionId: execution.id,
      nodeId,
      eventId,
      status: WorkflowStepStatus.SUCCEEDED,
    });

    await storage.deleteWorkflow(workflowId);

    expect(
      (await db.select().from(workflows).where(eq(workflows.id, workflowId)))
        .length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(workflowExecutions)
          .where(eq(workflowExecutions.workflowId, workflowId))
      ).length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(workflowExecutionEvents)
          .where(eq(workflowExecutionEvents.workflowExecutionId, execution.id))
      ).length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(workflowStepRuns)
          .where(eq(workflowStepRuns.workflowExecutionId, execution.id))
      ).length,
    ).toBe(0);
  });
});
