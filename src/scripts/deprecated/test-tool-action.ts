/**
 * Test script for verifying tool action execution flow
 */

import { executeToolAction } from "@/lib/scheduler/tool-action-executor";
import {
  events,
  EventType,
  EventStatus,
  EventTriggerType,
  ToolType,
  RunLocation,
  TimeUnit,
  toolCredentials,
} from "@/shared/schema";
import { db } from "@/server/db";
import { eq } from "drizzle-orm";

async function testToolActionExecution() {
  console.log("=== Testing Tool Action Execution ===\n");

  try {
    // 1. Find configured tools
    const tools = await db
      .select()
      .from(toolCredentials)
      .where(eq(toolCredentials.isActive, true));

    if (tools.length === 0) {
      console.error("❌ No active tools found. Please configure a tool first.");
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

    // 3. Configure based on tool type
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
          channel: "#general",
          text: `Test message from Cronium at ${new Date().toISOString()}`,
        };
        break;

      case ToolType.DISCORD:
        toolActionConfig.actionId = "discord.send-message";
        toolActionConfig.parameters = {
          content: `Test message from Cronium at ${new Date().toISOString()}`,
        };
        break;

      case ToolType.EMAIL:
        toolActionConfig.actionId = "email.send";
        toolActionConfig.parameters = {
          to: "test@example.com",
          subject: "Test Email from Cronium",
          body: `This is a test email sent at ${new Date().toISOString()}`,
        };
        break;

      case ToolType.WEBHOOK:
        toolActionConfig.actionId = "webhook.send";
        toolActionConfig.parameters = {
          method: "POST",
          body: JSON.stringify({ test: true, timestamp: new Date() }),
          headers: { "Content-Type": "application/json" },
        };
        break;

      default:
        console.error(`❌ Unsupported tool type for testing: ${testTool.type}`);
        return;
    }

    // 4. Create a test event in the database
    console.log("\n3. Creating test event...");

    const eventResult = await db
      .insert(events)
      .values({
        userId: testTool.userId,
        name: "Test Tool Action Event",
        description: "Testing tool action execution",
        type: EventType.TOOL_ACTION,
        status: EventStatus.DRAFT,
        triggerType: EventTriggerType.MANUAL,
        runLocation: RunLocation.LOCAL,
        scheduleNumber: 1,
        scheduleUnit: TimeUnit.MINUTES,
        timeoutValue: 30,
        timeoutUnit: TimeUnit.SECONDS,
        retries: 0,
        maxExecutions: 1,
        executionCount: 0,
        tags: ["test"],
        content: null,
        shared: false,
        toolActionConfig: toolActionConfig,
      })
      .returning();

    const mockEvent = eventResult[0];
    if (!mockEvent) {
      console.error("❌ Failed to create test event");
      return;
    }

    console.log("\n4. Tool action configuration:");
    console.log(JSON.stringify(toolActionConfig, null, 2));

    // 5. Execute the tool action
    console.log("\n5. Executing tool action...");
    const result = await executeToolAction(mockEvent);

    // 6. Display results
    console.log("\n6. Execution Results:");
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

    // 7. Clean up
    console.log("\n7. Cleaning up test event...");
    await db.delete(events).where(eq(events.id, mockEvent.id));
    console.log("   ✅ Test event deleted");

    console.log("\n🎉 Test completed successfully!");
  } catch (error) {
    console.error("\n❌ Test failed with error:", error);
  }
}

// Run the test
testToolActionExecution()
  .then(() => {
    console.log("\n✅ Script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
