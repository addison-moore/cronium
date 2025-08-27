/**
 * Simple test to verify parallel workflow execution
 */

import { db } from "@/server/db";
import { nanoid } from "nanoid";
import {
  workflows,
  workflowNodes,
  workflowConnections,
  events,
} from "@/shared/schema";
import {
  EventStatus,
  EventType,
  EventTriggerType,
  ConnectionType,
  TimeUnit,
  RunLocation,
} from "@/shared/schema";
import { WorkflowExecutor } from "@/lib/workflow-executor";

async function main() {
  try {
    console.log("Testing Simple Parallel Workflow Execution");
    console.log("=========================================\n");

    const userId = "test-user-" + nanoid(6);

    // Create simple test events
    const [event1] = await db
      .insert(events)
      .values({
        name: "Branch 1",
        userId,
        type: EventType.SCRIPT,
        status: EventStatus.ACTIVE,
        triggerType: EventTriggerType.MANUAL,
        content: "echo 'Branch 1 executing'; sleep 1; echo 'Branch 1 complete'",
        scriptType: "BASH",
        runLocation: RunLocation.LOCAL,
        timeoutValue: 30,
        timeoutUnit: TimeUnit.SECONDS,
        retries: 0,
        maxExecutions: 0,
        executionCount: 0,
        shared: false,
        scheduleNumber: 1,
        scheduleUnit: TimeUnit.MINUTES,
        tags: [],
        resetCounterOnActive: false,
        payloadVersion: 1,
        successCount: 0,
        failureCount: 0,
      })
      .returning();

    const [event2] = await db
      .insert(events)
      .values({
        name: "Branch 2",
        userId,
        type: EventType.SCRIPT,
        status: EventStatus.ACTIVE,
        triggerType: EventTriggerType.MANUAL,
        content: "echo 'Branch 2 executing'; sleep 1; echo 'Branch 2 complete'",
        scriptType: "BASH",
        runLocation: RunLocation.LOCAL,
        timeoutValue: 30,
        timeoutUnit: TimeUnit.SECONDS,
        retries: 0,
        maxExecutions: 0,
        executionCount: 0,
        shared: false,
        scheduleNumber: 1,
        scheduleUnit: TimeUnit.MINUTES,
        tags: [],
        resetCounterOnActive: false,
        payloadVersion: 1,
        successCount: 0,
        failureCount: 0,
      })
      .returning();

    console.log("Created events:", event1.id, event2.id);

    // Create workflow
    const [workflow] = await db
      .insert(workflows)
      .values({
        name: "Test Parallel",
        userId,
        description: "Test parallel branches",
        triggerType: "MANUAL",
        status: EventStatus.ACTIVE,
        executionCount: 0,
      })
      .returning();

    console.log("Created workflow:", workflow.id);

    // Create nodes
    const [node1] = await db
      .insert(workflowNodes)
      .values({
        workflowId: workflow.id,
        eventId: event1.id,
        position_x: 100,
        position_y: 100,
      })
      .returning();

    const [node2] = await db
      .insert(workflowNodes)
      .values({
        workflowId: workflow.id,
        eventId: event2.id,
        position_x: 100,
        position_y: 200,
      })
      .returning();

    console.log("Created nodes:", node1.id, node2.id);
    console.log("\nExecuting workflow...");

    const startTime = Date.now();

    // Execute workflow
    const executor = new WorkflowExecutor();
    const result = await executor.executeWorkflow(workflow.id, {}, userId);

    const duration = Date.now() - startTime;

    console.log("\nExecution result:", result);
    console.log("Total duration:", duration, "ms");

    // If branches ran in parallel, should be ~1 second
    // If sequential, would be ~2 seconds
    if (duration < 1500) {
      console.log("✅ SUCCESS: Branches executed in parallel!");
    } else {
      console.log("⚠️  WARNING: Branches may have executed sequentially");
    }

    // Cleanup
    await db.delete(workflowNodes).where({ workflowId: workflow.id });
    await db.delete(workflows).where({ id: workflow.id });
    await db.delete(events).where({ id: event1.id });
    await db.delete(events).where({ id: event2.id });

    console.log("\nCleanup complete");
    process.exit(0);
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

main();
