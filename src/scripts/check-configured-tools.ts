/**
 * Check if there are configured Slack/Discord tools in the database
 */

import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import { eq, and, or } from "drizzle-orm";
import { ToolType } from "@/shared/schema";

async function checkConfiguredTools() {
  console.log("=== Checking for Configured Tools ===\n");

  try {
    // Check for Slack and Discord tools
    const tools = await db
      .select()
      .from(toolCredentials)
      .where(
        and(
          eq(toolCredentials.isActive, true),
          or(
            eq(toolCredentials.type, ToolType.SLACK),
            eq(toolCredentials.type, ToolType.DISCORD),
          ),
        ),
      );

    console.log(`Found ${tools.length} active Slack/Discord tools:\n`);

    if (tools.length === 0) {
      console.log("❌ No active Slack or Discord tools found.");
      console.log("\nTo configure tools:");
      console.log("1. Go to Dashboard > Settings > Tools");
      console.log("2. Click 'Add Tool'");
      console.log("3. Select Slack or Discord");
      console.log("4. Enter webhook URL:");
      console.log("   - For Slack: https://hooks.slack.com/services/...");
      console.log("   - For Discord: https://discord.com/api/webhooks/...");
      console.log("5. Make sure to activate the tool");
      console.log("\nExample webhook URLs:");
      console.log(
        "- Slack: Get from https://api.slack.com/apps > Your App > Incoming Webhooks",
      );
      console.log(
        "- Discord: Right-click channel > Edit Channel > Integrations > Webhooks",
      );
      return;
    }

    // Display found tools
    tools.forEach((tool, index) => {
      console.log(`${index + 1}. ${tool.name} (${tool.type})`);
      console.log(`   ID: ${tool.id}`);
      console.log(`   Created: ${tool.createdAt.toISOString()}`);
      console.log(`   Status: ${tool.isActive ? "✅ Active" : "❌ Inactive"}`);

      // Parse and display webhook URL (redacted)
      try {
        const creds = JSON.parse(tool.credentials) as {
          webhookUrl?: string;
          url?: string;
        };
        if (creds.webhookUrl ?? creds.url) {
          const url = creds.webhookUrl ?? creds.url ?? "";
          const redactedUrl = url.substring(0, 30) + "...";
          console.log(`   Webhook: ${redactedUrl}`);
        }
      } catch (_e) {
        console.log(`   Webhook: [Unable to parse]`);
      }
      console.log();
    });

    console.log("\n✅ Tools are configured and ready for testing!");
    console.log("\nTo test these tools, you can:");
    console.log("1. Run: npx tsx src/scripts/test-real-tools.ts");
    console.log("2. Or create a test event in the dashboard");
    console.log("3. Or use the Tools Dashboard at /dashboard/tools");
  } catch (error) {
    console.error("❌ Error checking tools:", error);
  }
}

checkConfiguredTools()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
