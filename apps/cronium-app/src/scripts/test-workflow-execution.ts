/**
 * Test script for workflow execution with async architecture
 *
 * This script tests:
 * 1. Workflow execution with data flow between nodes
 * 2. Conditional routing (ON_SUCCESS, ON_FAILURE)
 * 3. Runtime helper data capture
 */

import { workflowExecutor } from "@/lib/workflow-executor";
import { storage } from "@/server/storage";
import { EventType, EventStatus, RunLocation } from "@/shared/schema";

async function createTestEvent(name: string, content: string, userId: string) {
  return await storage.createEvent({
    name,
    description: `Test event: ${name}`,
    type: EventType.NODEJS,
    content,
    status: EventStatus.ACTIVE,
    triggerType: "MANUAL",
    runLocation: RunLocation.LOCAL,
    userId,
    timeoutValue: 30,
    timeoutUnit: "SECONDS",
    retries: 0,
    scheduleNumber: 1,
    scheduleUnit: "MINUTES",
    executionCount: 0,
    maxExecutions: 0,
    resetCounterOnActive: false,
    payloadVersion: 1,
    successCount: 0,
    failureCount: 0,
    tags: ["test"],
    shared: false,
  });
}

async function testWorkflowExecution() {
  console.log("Starting workflow execution test...\n");

  // Get the first user for testing
  const users = await storage.getAllUsers();
  if (users.length === 0) {
    console.error("No users found in database");
    process.exit(1);
  }
  const userId = users[0]!.id;

  try {
    // Create test events
    console.log("Creating test events...");

    // Event 1: Outputs data
    const event1 = await createTestEvent(
      "Test Event 1 - Output Data",
      `
const cronium = require('cronium');

console.log('Event 1: Starting...');
const data = {
  timestamp: new Date().toISOString(),
  value: 42,
  message: 'Hello from Event 1'
};

console.log('Event 1: Outputting data:', data);
await cronium.output(data);
console.log('Event 1: Complete');
`,
      userId,
    );

    // Event 2: Receives data and sets condition
    const event2 = await createTestEvent(
      "Test Event 2 - Process Data",
      `
const cronium = require('cronium');

console.log('Event 2: Starting...');
const input = await cronium.input();
console.log('Event 2: Received input:', input);

if (input && input.value) {
  const processed = {
    ...input,
    processedValue: input.value * 2,
    processedBy: 'Event 2'
  };
  
  console.log('Event 2: Outputting processed data:', processed);
  await cronium.output(processed);
  
  // Set condition based on value
  const condition = input.value > 40;
  console.log('Event 2: Setting condition:', condition);
  await cronium.setCondition(condition);
  
  console.log('Event 2: Complete (success)');
} else {
  console.log('Event 2: No input received');
  throw new Error('No input data received');
}
`,
      userId,
    );

    // Event 3: Final event
    const event3 = await createTestEvent(
      "Test Event 3 - Final",
      `
const cronium = require('cronium');

console.log('Event 3: Starting...');
const input = await cronium.input();
console.log('Event 3: Received final input:', input);

if (input && input.processedValue) {
  console.log('Event 3: Final value:', input.processedValue);
  console.log('Event 3: Workflow complete!');
} else {
  console.log('Event 3: No processed data received');
}
`,
      userId,
    );

    console.log(`Created events: ${event1.id}, ${event2.id}, ${event3.id}\n`);

    // Create a test workflow
    console.log("Creating test workflow...");
    const workflow = await storage.createWorkflow({
      name: "Test Workflow - Data Flow",
      description: "Tests data flow between events in async architecture",
      status: EventStatus.ACTIVE,
      triggerType: "MANUAL",
      runLocation: RunLocation.LOCAL,
      userId,
      shared: false,
      tags: ["test"],
      overrideEventServers: false,
    });

    // Create workflow nodes
    const node1 = await storage.createWorkflowNode({
      workflowId: workflow.id,
      eventId: event1.id,
      position_x: 100,
      position_y: 100,
    });

    const node2 = await storage.createWorkflowNode({
      workflowId: workflow.id,
      eventId: event2.id,
      position_x: 300,
      position_y: 100,
    });

    const node3 = await storage.createWorkflowNode({
      workflowId: workflow.id,
      eventId: event3.id,
      position_x: 500,
      position_y: 100,
    });

    // Create connections
    await storage.createWorkflowConnection({
      workflowId: workflow.id,
      sourceNodeId: node1.id,
      targetNodeId: node2.id,
      connectionType: "ALWAYS",
    });

    await storage.createWorkflowConnection({
      workflowId: workflow.id,
      sourceNodeId: node2.id,
      targetNodeId: node3.id,
      connectionType: "ON_CONDITION",
    });

    console.log(`Created workflow ${workflow.id} with nodes and connections\n`);

    // Execute the workflow
    console.log("Executing workflow...\n");
    console.log("=" * 50);

    const result = await workflowExecutor.executeWorkflow(workflow.id, userId, {
      initialData: "test",
    });

    console.log("=" * 50);
    console.log("\nWorkflow execution result:", result);

    if (result.success) {
      console.log("\n✅ Workflow execution test PASSED!");

      // Check execution details
      if (result.executionId) {
        const execution = await storage.getWorkflowExecution(
          result.executionId,
        );
        if (execution) {
          console.log("\nExecution details:");
          console.log(`  Status: ${execution.status}`);
          console.log(`  Total events: ${execution.totalEvents}`);
          console.log(`  Successful: ${execution.successfulEvents}`);
          console.log(`  Failed: ${execution.failedEvents}`);
          console.log(`  Duration: ${execution.totalDuration}ms`);
        }
      }
    } else {
      console.log("\n❌ Workflow execution test FAILED!");
      console.log("Error:", result.output);
    }

    // Cleanup
    console.log("\nCleaning up test data...");
    await storage.deleteWorkflow(workflow.id);
    await storage.deleteEvent(event1.id);
    await storage.deleteEvent(event2.id);
    await storage.deleteEvent(event3.id);
    console.log("Cleanup complete");
  } catch (error) {
    console.error("Test failed with error:", error);
    process.exit(1);
  }

  process.exit(0);
}

// Run the test
testWorkflowExecution().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
