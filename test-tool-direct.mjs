// Direct test of tool action execution
import { executeToolAction } from "./src/lib/scheduler/tool-action-executor.js";

const mockEvent = {
  id: 99999,
  userId: "test-user",
  name: "Test Tool Action",
  type: "TOOL_ACTION",
  toolActionConfig: JSON.stringify({
    toolType: "slack",
    toolId: 1,
    actionId: "slack.send-message",
    parameters: {
      channel: "#test",
      message: "Direct test of tool action execution",
    },
  }),
  // Other required fields
  schedule: "{}",
  status: "ACTIVE",
  triggerType: "MANUAL",
  runLocation: "LOCAL",
  serverId: null,
  timeoutValue: 30,
  timeoutUnit: "SECONDS",
  retries: 0,
  maxExecutions: 1,
  executionCount: 0,
  envVars: "[]",
  conditionalEvents: "[]",
  tags: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  code: "",
  httpMethod: null,
  httpUrl: null,
  httpHeaders: null,
  httpBody: null,
  pythonVersion: null,
  selectedServerIds: [],
  resetCounterOnActive: false,
};

console.log("Testing tool action execution...");
console.log("Event:", mockEvent);

try {
  const result = await executeToolAction(mockEvent);
  console.log("\nResult:", result);
} catch (error) {
  console.error("\nError:", error);
}
