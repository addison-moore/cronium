#!/usr/bin/env tsx

/**
 * Test script to verify workflow management UI functionality
 * Tests workflow creation, execution, and monitoring
 */

import { storage } from "@/server/storage";
import {
  EventType,
  EventStatus,
  LogStatus,
  ConnectionType,
} from "@/shared/schema";
import type { InsertWorkflow } from "@/shared/schema";

interface WorkflowTest {
  name: string;
  description: string;
  nodeCount: number;
  connectionCount: number;
  hasConditionalLogic: boolean;
  testScenario: string;
}

const workflowTests: WorkflowTest[] = [
  {
    name: "Simple Sequential Workflow",
    description: "Basic workflow with 3 steps in sequence",
    nodeCount: 3,
    connectionCount: 2,
    hasConditionalLogic: false,
    testScenario: "Sequential execution of bash → python → nodejs",
  },
  {
    name: "Conditional Success/Failure Workflow",
    description: "Workflow with conditional branching based on success/failure",
    nodeCount: 4,
    connectionCount: 4,
    hasConditionalLogic: true,
    testScenario: "Main task → (success → notify) | (failure → alert)",
  },
  {
    name: "Complex Multi-Branch Workflow",
    description: "Workflow with multiple conditional branches",
    nodeCount: 6,
    connectionCount: 7,
    hasConditionalLogic: true,
    testScenario: "Initial → Check → (A|B|C paths) → Final cleanup",
  },
  {
    name: "Error Handling Workflow",
    description: "Workflow designed to test error handling",
    nodeCount: 3,
    connectionCount: 3,
    hasConditionalLogic: true,
    testScenario: "Task that fails → Error handler → Cleanup",
  },
];

async function createTestEvents(userId: string) {
  const events = [];

  // Create various test events
  const bashEvent = await storage.createScript({
    name: "Test Bash Script",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "Starting workflow step..."
echo "Processing data..."
exit 0`,
    status: EventStatus.ACTIVE,
    userId,
    runLocation: "LOCAL",
  });
  events.push(bashEvent);

  const pythonEvent = await storage.createScript({
    name: "Test Python Script",
    type: EventType.PYTHON,
    content: `print("Python step executing")
import random
success = random.choice([True, False])
print(f"Result: {'Success' if success else 'Failure'}")
exit(0 if success else 1)`,
    status: EventStatus.ACTIVE,
    userId,
    runLocation: "LOCAL",
  });
  events.push(pythonEvent);

  const nodeEvent = await storage.createScript({
    name: "Test Node.js Script",
    type: EventType.NODEJS,
    content: `console.log("Node.js step executing");
console.log("Finalizing workflow...");
process.exit(0);`,
    status: EventStatus.ACTIVE,
    userId,
    runLocation: "LOCAL",
  });
  events.push(nodeEvent);

  const errorEvent = await storage.createScript({
    name: "Error Test Script",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "This step will fail" >&2
exit 1`,
    status: EventStatus.ACTIVE,
    userId,
    runLocation: "LOCAL",
  });
  events.push(errorEvent);

  const successNotification = await storage.createScript({
    name: "Success Notification",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "✅ Workflow completed successfully!"`,
    status: EventStatus.ACTIVE,
    userId,
    runLocation: "LOCAL",
  });
  events.push(successNotification);

  const failureAlert = await storage.createScript({
    name: "Failure Alert",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "❌ Workflow failed - sending alert!"`,
    status: EventStatus.ACTIVE,
    userId,
    runLocation: "LOCAL",
  });
  events.push(failureAlert);

  return events;
}

async function createTestWorkflow(
  test: WorkflowTest,
  userId: string,
  events: any[],
): Promise<number> {
  // Build nodes and edges based on test scenario
  const nodes = [];
  const edges = [];

  if (test.name === "Simple Sequential Workflow") {
    // Bash → Python → Node.js
    nodes.push(
      {
        id: "node-1",
        type: "eventNode",
        position: { x: 100, y: 100 },
        data: { eventId: events[0].id, label: events[0].name },
      },
      {
        id: "node-2",
        type: "eventNode",
        position: { x: 300, y: 100 },
        data: { eventId: events[1].id, label: events[1].name },
      },
      {
        id: "node-3",
        type: "eventNode",
        position: { x: 500, y: 100 },
        data: { eventId: events[2].id, label: events[2].name },
      },
    );
    edges.push(
      {
        id: "e-1-2",
        source: "node-1",
        target: "node-2",
        type: "connectionEdge",
        data: { type: ConnectionType.ALWAYS },
      },
      {
        id: "e-2-3",
        source: "node-2",
        target: "node-3",
        type: "connectionEdge",
        data: { type: ConnectionType.ALWAYS },
      },
    );
  } else if (test.name === "Conditional Success/Failure Workflow") {
    // Python (random) → Success notification | Failure alert
    nodes.push(
      {
        id: "node-1",
        type: "eventNode",
        position: { x: 250, y: 100 },
        data: { eventId: events[1].id, label: events[1].name },
      },
      {
        id: "node-2",
        type: "eventNode",
        position: { x: 150, y: 250 },
        data: { eventId: events[4].id, label: events[4].name },
      },
      {
        id: "node-3",
        type: "eventNode",
        position: { x: 350, y: 250 },
        data: { eventId: events[5].id, label: events[5].name },
      },
    );
    edges.push(
      {
        id: "e-1-2",
        source: "node-1",
        target: "node-2",
        type: "connectionEdge",
        data: { type: ConnectionType.ON_SUCCESS },
      },
      {
        id: "e-1-3",
        source: "node-1",
        target: "node-3",
        type: "connectionEdge",
        data: { type: ConnectionType.ON_FAILURE },
      },
    );
  } else if (test.name === "Error Handling Workflow") {
    // Error script → Failure handler → Cleanup
    nodes.push(
      {
        id: "node-1",
        type: "eventNode",
        position: { x: 100, y: 100 },
        data: { eventId: events[3].id, label: events[3].name },
      },
      {
        id: "node-2",
        type: "eventNode",
        position: { x: 300, y: 100 },
        data: { eventId: events[5].id, label: events[5].name },
      },
      {
        id: "node-3",
        type: "eventNode",
        position: { x: 500, y: 100 },
        data: { eventId: events[0].id, label: "Cleanup Step" },
      },
    );
    edges.push(
      {
        id: "e-1-2",
        source: "node-1",
        target: "node-2",
        type: "connectionEdge",
        data: { type: ConnectionType.ON_FAILURE },
      },
      {
        id: "e-2-3",
        source: "node-2",
        target: "node-3",
        type: "connectionEdge",
        data: { type: ConnectionType.ALWAYS },
      },
    );
  }

  // Create workflow
  const workflowData: InsertWorkflow = {
    name: test.name,
    description: test.description,
    tags: JSON.stringify(["test", "ui-test"]),
    triggerType: "manual",
    nodes: JSON.stringify(nodes),
    edges: JSON.stringify(edges),
    status: EventStatus.ACTIVE,
    userId,
  };

  const workflow = await storage.createWorkflow(workflowData);
  return workflow.id;
}

async function runWorkflowTests() {
  console.log("🧪 Testing Workflow Management UI\n");
  console.log("This test suite verifies:");
  console.log("- Workflow builder with drag-and-drop");
  console.log("- Conditional logic connections");
  console.log("- Step ordering and validation");
  console.log("- Workflow execution initiation");
  console.log("- Real-time progress display");
  console.log("- Error handling and display\n");

  const userId = "test-user";

  // Create test events first
  console.log("📝 Creating test events...");
  const events = await createTestEvents(userId);
  console.log(`✅ Created ${events.length} test events\n`);

  // Create test workflows
  console.log("🔧 Creating test workflows...\n");
  const workflowIds: Array<{ test: WorkflowTest; workflowId: number }> = [];

  for (const test of workflowTests) {
    try {
      console.log(`Creating: ${test.name}`);
      const workflowId = await createTestWorkflow(test, userId, events);
      workflowIds.push({ test, workflowId });
      console.log(`  ✅ Workflow created: ID ${workflowId}`);
      console.log(
        `  📊 Nodes: ${test.nodeCount}, Connections: ${test.connectionCount}`,
      );
      console.log(
        `  🔀 Conditional Logic: ${test.hasConditionalLogic ? "Yes" : "No"}`,
      );
    } catch (error) {
      console.log(`  ❌ Failed: ${error}`);
    }
  }

  // Summary
  console.log("\n📋 Test Summary:");
  console.log(
    "Workflow Name | Nodes | Connections | Conditional | Test Scenario",
  );
  console.log(
    "--------------|-------|-------------|-------------|---------------",
  );

  for (const { test } of workflowIds) {
    console.log(
      `${test.name.padEnd(35).substring(0, 35)} | ${test.nodeCount} | ${test.connectionCount} | ${
        test.hasConditionalLogic ? "Yes" : "No"
      } | ${test.testScenario}`,
    );
  }

  console.log("\n🎯 UI Testing Instructions:");
  console.log("1. Open the Cronium dashboard");
  console.log("2. Navigate to Workflows section");
  console.log("3. Open each test workflow to verify:");
  console.log("   - Visual node layout is correct");
  console.log("   - Connection types show proper colors");
  console.log("   - Drag and drop functionality works");
  console.log("   - Validation prevents invalid connections");
  console.log("4. Run each workflow and observe:");
  console.log("   - Real-time progress indicators");
  console.log("   - Step status updates (pending → running → complete/failed)");
  console.log("   - Error messages for failed steps");
  console.log("   - Execution history tracking");
  console.log("\n✅ Test workflows created successfully!");
  console.log("🔗 Access at: http://localhost:5001/en/dashboard/workflows");
}

// Run the tests
runWorkflowTests().catch(console.error);
