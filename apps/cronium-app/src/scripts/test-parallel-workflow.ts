/**
 * Test script to verify parallel workflow execution
 */

import { WorkflowExecutor } from "@/lib/workflow-executor";
import { storage } from "@/server/storage";
import { db, pool } from "@/server/db";
import {
  EventStatus,
  EventType,
  WorkflowTriggerType,
  ConnectionType,
  LogStatus,
} from "@/shared/schema";
import type {
  InsertWorkflow,
  InsertWorkflowNode,
  InsertWorkflowConnection,
  InsertEvent,
} from "@/shared/schema";

async function createTestWorkflow() {
  console.log("Creating test workflow with parallel branches...");

  // Create a test user if needed
  const userId = "test-parallel-user";

  // Create test events that log their execution
  const event1Data: InsertEvent = {
    name: "Parallel Branch 1 - Node 1",
    type: EventType.SCRIPT,
    userId,
    status: EventStatus.ACTIVE,
    triggerType: "MANUAL",
    content: `
      console.log("Branch 1 Node 1 started at", new Date().toISOString());
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log("Branch 1 Node 1 completed at", new Date().toISOString());
    `,
    scriptType: "NODEJS",
  };

  const event2Data: InsertEvent = {
    name: "Parallel Branch 2 - Node 1",
    type: EventType.SCRIPT,
    userId,
    status: EventStatus.ACTIVE,
    triggerType: "MANUAL",
    content: `
      console.log("Branch 2 Node 1 started at", new Date().toISOString());
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log("Branch 2 Node 1 completed at", new Date().toISOString());
    `,
    scriptType: "NODEJS",
  };

  const event3Data: InsertEvent = {
    name: "Converged Node",
    type: EventType.SCRIPT,
    userId,
    status: EventStatus.ACTIVE,
    triggerType: "MANUAL",
    content: `
      console.log("Converged Node started at", new Date().toISOString());
      console.log("Both branches have completed!");
    `,
    scriptType: "NODEJS",
  };

  // Create events
  const event1 = await storage.createScript(event1Data);
  const event2 = await storage.createScript(event2Data);
  const event3 = await storage.createScript(event3Data);

  console.log("Created events:", {
    event1: event1.id,
    event2: event2.id,
    event3: event3.id,
  });

  // Create workflow
  const workflowData: InsertWorkflow = {
    name: "Test Parallel Workflow",
    description: "Tests parallel branch execution",
    userId,
    triggerType: WorkflowTriggerType.MANUAL,
    status: EventStatus.ACTIVE,
  };

  const workflow = await storage.createWorkflow(workflowData);
  console.log("Created workflow:", workflow.id);

  // Create workflow nodes
  const node1Data: InsertWorkflowNode = {
    workflowId: workflow.id,
    eventId: event1.id,
    position_x: 100,
    position_y: 100,
  };

  const node2Data: InsertWorkflowNode = {
    workflowId: workflow.id,
    eventId: event2.id,
    position_x: 100,
    position_y: 200,
  };

  const node3Data: InsertWorkflowNode = {
    workflowId: workflow.id,
    eventId: event3.id,
    position_x: 300,
    position_y: 150,
  };

  const node1 = await storage.createWorkflowNode(node1Data);
  const node2 = await storage.createWorkflowNode(node2Data);
  const node3 = await storage.createWorkflowNode(node3Data);

  console.log("Created nodes:", {
    node1: node1.id,
    node2: node2.id,
    node3: node3.id,
  });

  // Create connections
  // Both node1 and node2 are starting nodes (no incoming connections)
  // Both connect to node3
  const conn1Data: InsertWorkflowConnection = {
    workflowId: workflow.id,
    sourceNodeId: node1.id,
    targetNodeId: node3.id,
    connectionType: ConnectionType.ALWAYS,
  };

  const conn2Data: InsertWorkflowConnection = {
    workflowId: workflow.id,
    sourceNodeId: node2.id,
    targetNodeId: node3.id,
    connectionType: ConnectionType.ALWAYS,
  };

  await storage.createWorkflowConnection(conn1Data);
  await storage.createWorkflowConnection(conn2Data);

  console.log("Created connections");

  return workflow.id;
}

async function executeAndMonitor(workflowId: number) {
  console.log("\n=== Starting workflow execution ===");
  const startTime = Date.now();

  const executor = new WorkflowExecutor();

  // Execute the workflow
  const result = await executor.executeWorkflow(workflowId, {}, "test-user");

  if (!result.success) {
    console.error("Workflow execution failed:", result.output);
    return;
  }

  console.log("Workflow started, execution ID:", result.executionId);

  // Monitor the execution
  let isComplete = false;
  while (!isComplete) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (result.executionId) {
      const execution = await storage.getWorkflowExecution(result.executionId);
      if (execution) {
        const status = execution.status;
        if (status === LogStatus.SUCCESS || status === LogStatus.FAILURE) {
          isComplete = true;
          const duration = Date.now() - startTime;
          console.log(`\nWorkflow completed with status: ${status}`);
          console.log(`Total execution time: ${duration}ms`);

          // Check if branches ran in parallel
          // If parallel, total time should be ~2 seconds (one branch duration)
          // If sequential, total time would be ~4 seconds (both branches)
          if (duration < 3000) {
            console.log("✅ SUCCESS: Branches executed in parallel!");
          } else {
            console.log("❌ WARNING: Branches may have executed sequentially");
          }
        }
      }
    }
  }

  // Get workflow logs
  const logs = await storage.getWorkflowLogs(workflowId);
  console.log("\n=== Workflow Logs ===");
  logs.forEach((log) => {
    console.log(`[${log.timestamp}] ${log.level}: ${log.message}`);
  });
}

async function cleanup(workflowId: number) {
  console.log("\n=== Cleaning up test data ===");

  // Get workflow to find nodes
  const nodes = await storage.getWorkflowNodes(workflowId);
  const eventIds = nodes.map((node) => node.eventId);

  // Delete workflow (cascades to nodes and connections)
  await storage.deleteWorkflow(workflowId);

  // Delete events
  for (const eventId of eventIds) {
    await storage.deleteScript(eventId);
  }

  console.log("Cleanup complete");
}

async function main() {
  try {
    console.log("Testing Parallel Workflow Execution");
    console.log("====================================\n");

    const workflowId = await createTestWorkflow();
    await executeAndMonitor(workflowId);
    await cleanup(workflowId);

    console.log("\n✅ Test completed successfully");
  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    await pool.end();
  }
}

// Run the test
main().catch(console.error);
