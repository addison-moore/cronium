/**
 * Test script for real Slack and Discord tool actions
 * This script will:
 * 1. Check for configured Slack/Discord tools
 * 2. Create test events for each
 * 3. Execute them and verify results
 */

import { db } from "@/server/db";
import { toolCredentials, events, toolActionLogs } from "@/shared/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  EventType,
  EventStatus,
  EventTriggerType,
  ToolType,
} from "@/shared/schema";
import { executeToolAction } from "@/lib/scheduler/tool-action-executor";

// Test configurations
const TEST_CONFIGS = {
  slack: {
    actionId: "slack.send-message",
    parameters: {
      channel: "#general", // Change to your test channel
      message:
        "🚀 Test message from Cronium Tool Actions - Testing Slack integration",
      username: "Cronium Bot",
    },
  },
  discord: {
    actionId: "discord.send-message",
    parameters: {
      content:
        "🚀 Test message from Cronium Tool Actions - Testing Discord integration",
    },
  },
};

async function testRealTools() {
  console.log("=== Testing Real Tool Actions ===\n");

  try {
    // 1. Find configured Slack and Discord tools
    console.log("1. Looking for configured tools...");

    const tools = await db
      .select()
      .from(toolCredentials)
      .where(
        and(
          eq(toolCredentials.isActive, true),
          // Look for Slack or Discord tools
          eq(toolCredentials.type, ToolType.SLACK),
        ),
      );

    const discordTools = await db
      .select()
      .from(toolCredentials)
      .where(
        and(
          eq(toolCredentials.isActive, true),
          eq(toolCredentials.type, ToolType.DISCORD),
        ),
      );

    const allTools = [...tools, ...discordTools];

    if (allTools.length === 0) {
      console.error("❌ No active Slack or Discord tools found.");
      console.log("\nPlease configure at least one tool:");
      console.log("1. Go to Dashboard > Settings > Tools");
      console.log("2. Add a Slack webhook URL or Discord webhook URL");
      console.log("3. Make sure the tool is set to Active");
      return;
    }

    console.log(`✅ Found ${allTools.length} configured tools:`);
    allTools.forEach((tool) => {
      console.log(`   - ${tool.name} (${tool.type})`);
    });

    // 2. Test each tool
    for (const tool of allTools) {
      console.log(`\n2. Testing ${tool.name} (${tool.type})...`);

      const config =
        TEST_CONFIGS[tool.type.toLowerCase() as keyof typeof TEST_CONFIGS];
      if (!config) {
        console.log(`   ⚠️  No test config for ${tool.type}`);
        continue;
      }

      // Create a test event
      const toolActionConfig = {
        toolType: tool.type,
        toolId: tool.id,
        actionId: config.actionId,
        parameters: config.parameters,
      };

      const testEventResult = await db
        .insert(events)
        .values({
          userId: tool.userId,
          name: `Test ${tool.type} Action - ${new Date().toISOString()}`,
          description: `Automated test of ${tool.type} tool action`,
          type: EventType.TOOL_ACTION,
          status: EventStatus.ACTIVE,
          triggerType: EventTriggerType.MANUAL,
          runLocation: "LOCAL",
          schedule: "{}",
          timeoutValue: 30,
          timeoutUnit: "SECONDS",
          retries: 0,
          maxExecutions: 1,
          executionCount: 0,
          envVars: "[]",
          conditionalEvents: "[]",
          tags: ["test", "tool-action"],
          code: "",
          toolActionConfig: JSON.stringify(toolActionConfig),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      const testEvent = testEventResult[0];
      if (!testEvent) {
        console.error("   ❌ Failed to create test event");
        continue;
      }
      
      console.log(`   ✅ Created test event: ${testEvent.name}`);

      // 3. Execute the event
      console.log(`   🚀 Executing tool action...`);
      const startTime = Date.now();

      try {
        const result = await executeToolAction(testEvent);
        const executionTime = Date.now() - startTime;

        console.log(`   ✅ Execution completed in ${executionTime}ms`);
        console.log(`   Exit code: ${result.exitCode}`);

        if (result.stdout) {
          console.log(`   Output:`);
          const output = JSON.parse(result.stdout);
          console.log(`   - Action: ${output.actionName}`);
          console.log(`   - Execution Time: ${output.executionTime}ms`);
          console.log(`   - Result:`, output.result);
        }

        if (result.stderr) {
          console.log(`   ⚠️  Errors: ${result.stderr}`);
        }

        // 4. Check the logs
        const logs = await db
          .select()
          .from(toolActionLogs)
          .where(eq(toolActionLogs.eventId, testEvent.id))
          .orderBy(desc(toolActionLogs.createdAt))
          .limit(1);

        if (logs.length > 0) {
          const log = logs[0];
          if (log) {
            console.log(`   📝 Log entry created:`);
            console.log(`   - Status: ${log.status}`);
            console.log(`   - Execution Time: ${log.executionTime}ms`);
          }
        }

        // 5. Clean up - set event to inactive
        await db
          .update(events)
          .set({ status: EventStatus.DRAFT })
          .where(eq(events.id, testEvent.id));
      } catch (error) {
        console.error(`   ❌ Execution failed:`, error);
      }
    }

    console.log("\n✅ Tool action testing completed!");
    console.log("\n📊 Summary:");
    console.log("- Check your Slack/Discord channels for the test messages");
    console.log(
      "- View execution logs at: /dashboard/tools (Execution History tab)",
    );
    console.log(
      "- Check tool health at: /dashboard/tools (Health Overview tab)",
    );
  } catch (error) {
    console.error("\n❌ Test failed with error:");
    console.error(error);
  }
}

// Add helper to wait for user input
async function waitForUserConfirmation() {
  console.log(
    "\n⚠️  WARNING: This will send real messages to your Slack/Discord channels!",
  );
  console.log("Make sure you have:");
  console.log("1. Configured valid webhook URLs in your tools");
  console.log("2. Access to the channels to verify messages");
  console.log("\nPress ENTER to continue or Ctrl+C to cancel...");

  return new Promise((resolve) => {
    process.stdin.once("data", () => {
      resolve(true);
    });
  });
}

// Main execution
async function main() {
  console.log("=== Cronium Tool Actions - Real Tool Testing ===\n");

  await waitForUserConfirmation();
  await testRealTools();

  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
