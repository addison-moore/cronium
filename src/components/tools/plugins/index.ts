// Plugin registry initialization
import { ToolPluginRegistry } from "../types/tool-plugin";
import { EmailPlugin } from "./email/email-plugin";
import { SlackPluginTrpc as SlackPlugin } from "./slack/slack-plugin";
import { DiscordPlugin } from "./discord/discord-plugin";

// Register all built-in plugins
export function initializePlugins() {
  ToolPluginRegistry.register(EmailPlugin);
  ToolPluginRegistry.register(SlackPlugin);
  ToolPluginRegistry.register(DiscordPlugin);
}

// Export plugins for manual registration if needed
export { EmailPlugin, SlackPlugin, DiscordPlugin };

// Export registry for easy access
export { ToolPluginRegistry };

// Initialize plugins automatically when this module is imported
initializePlugins();
