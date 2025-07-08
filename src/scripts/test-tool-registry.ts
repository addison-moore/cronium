/**
 * Test Tool Plugin Registry without database
 */

import { ToolPluginRegistry } from "@/components/tools/types/tool-plugin";
import { initializePlugins } from "@/components/tools/plugins";

async function testRegistry() {
  console.log("=== Tool Plugin Registry Test ===\n");

  // Initialize plugins
  initializePlugins();

  // List all registered plugins
  const allPlugins = ToolPluginRegistry.getAll();
  console.log(`Total plugins registered: ${allPlugins.length}\n`);

  allPlugins.forEach((plugin) => {
    console.log(`Plugin: ${plugin.name} (${plugin.id})`);
    console.log(`  Type: ${plugin.toolType}`);
    console.log(`  Actions: ${plugin.actions?.length || 0}`);

    if (plugin.actions) {
      plugin.actions.forEach((action) => {
        console.log(`    - ${action.id}: ${action.name}`);
      });
    }
    console.log();
  });

  // Test webhook plugin specifically
  const webhookPlugin = ToolPluginRegistry.get("webhook");
  if (webhookPlugin) {
    console.log("✅ Webhook plugin found!");
    console.log("Testing webhook action execution...");

    if (webhookPlugin.actions && webhookPlugin.actions.length > 0) {
      const sendAction = webhookPlugin.actions[0];

      try {
        // Test with httpbin
        const result = await sendAction.execute(
          {
            url: "https://httpbin.org/post",
            headers: { "X-Test": "Registry-Test" },
          },
          {
            method: "POST",
            body: { test: true, message: "Testing webhook plugin" },
            headers: { "Content-Type": "application/json" },
          },
          {
            logger: {
              info: (msg: string) => console.log(`  [INFO] ${msg}`),
              error: (msg: string) => console.error(`  [ERROR] ${msg}`),
              debug: (msg: string) => console.log(`  [DEBUG] ${msg}`),
              warn: (msg: string) => console.warn(`  [WARN] ${msg}`),
            },
          },
        );

        console.log("✅ Webhook execution successful!");
        console.log(`  Status: ${result.status} ${result.statusText}`);
        console.log(
          `  Response data:`,
          JSON.stringify(result.data, null, 2).substring(0, 200) + "...",
        );
      } catch (error) {
        console.error("❌ Webhook execution failed:", error);
      }
    }
  } else {
    console.error("❌ Webhook plugin not found!");
  }
}

testRegistry()
  .then(() => {
    console.log("\n✅ Registry test completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Registry test failed:", error);
    process.exit(1);
  });
