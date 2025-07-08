/**
 * Test script for verifying tool action execution flow
 */

import { executeToolAction } from "@/lib/scheduler/tool-action-executor";
import {
  Event,
  EventType,
  EventStatus,
  EventTriggerType,
  ToolType,
} from "@/shared/schema";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import { eq } from "drizzle-orm";

async function testToolActionExecution() {
  console.log("=== Testing Tool Action Execution ===\n");

  try {
    // 1. First, check if we have any tools configured
    console.log("1. Checking for configured tools...");
    const tools = await db.select().from(toolCredentials).limit(5);

    if (tools.length === 0) {
      console.error(
        "❌ No tools configured. Please configure at least one tool first.",
      );
      return;
    }

    console.log(`✅ Found ${tools.length} configured tools:`);
    tools.forEach((tool) => {
      console.log(`   - ${tool.name} (${tool.type}) - ID: ${tool.id}`);
    });

    // 2. Use the first active tool for testing
    const testTool = tools.find((t) => t.isActive) || tools[0];
    if (!testTool) {
      console.error("❌ No tool available for testing");
      return;
    }
    console.log(`\n2. Using tool: ${testTool.name} (${testTool.type})`);

    // 3. Create a mock event with tool action configuration
    const mockEvent: Event = {
      id: 99999,
      userId: testTool.userId,
      name: "Test Tool Action Event",
      description: "Testing tool action execution",
      type: EventType.TOOL_ACTION,
      schedule: "{}",
      status: EventStatus.ACTIVE,
      triggerType: EventTriggerType.MANUAL,
      runLocation: "LOCAL" as any,
      serverId: null,
      timeoutValue: 30,
      timeoutUnit: "SECONDS" as any,
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
      toolActionConfig: null, // Will be set based on tool type
    } as Event;

    // 4. Configure based on tool type
    let toolActionConfig: any = {
      toolType: testTool.type,
      toolId: testTool.id,
      actionId: "",
      parameters: {},
    };

    switch (testTool.type) {
      case ToolType.SLACK:
        toolActionConfig.actionId = "slack.send-message";
        toolActionConfig.parameters = {
          channel: "#test",
          message: "Test message from Cronium Tool Action test script",
        };
        break;

      case ToolType.DISCORD:
        toolActionConfig.actionId = "discord.send-message";
        toolActionConfig.parameters = {
          content: "Test message from Cronium Tool Action test script",
        };
        break;

      case ToolType.EMAIL:
        toolActionConfig.actionId = "email.send";
        toolActionConfig.parameters = {
          to: "test@example.com",
          subject: "Test from Cronium",
          body: "This is a test email from the Tool Action test script",
        };
        break;

      default:
        console.error(`❌ Unsupported tool type for testing: ${testTool.type}`);
        return;
    }

    mockEvent.toolActionConfig = JSON.stringify(toolActionConfig);
    console.log("\n3. Tool action configuration:");
    console.log(JSON.stringify(toolActionConfig, null, 2));

    // 5. Execute the tool action
    console.log("\n4. Executing tool action...\n");
    const result = await executeToolAction(mockEvent);

    // 6. Display results
    console.log("\n5. Execution Results:");
    console.log("   Exit Code:", result.exitCode);
    console.log("   Success:", result.exitCode === 0 ? "✅ Yes" : "❌ No");

    if (result.stdout) {
      console.log("\n   Output:");
      console.log("   " + result.stdout.split("\n").join("\n   "));
    }

    if (result.stderr) {
      console.log("\n   Errors:");
      console.log("   " + result.stderr.split("\n").join("\n   "));
    }

    if (result.data) {
      console.log("\n   Data:");
      console.log(JSON.stringify(result.data, null, 2));
    }

    if (result.healthStatus) {
      console.log("\n   Health Status:");
      console.log(`   - Status: ${result.healthStatus.status}`);
      console.log(`   - Latency: ${result.healthStatus.latency}ms`);
    }

    console.log("\n✅ Tool action execution test completed!");
  } catch (error) {
    console.error("\n❌ Test failed with error:");
    console.error(error);
  } finally {
    process.exit(0);
  }
}

// Run the test
console.log("Starting tool action test...\n");
testToolActionExecution().catch(console.error);
