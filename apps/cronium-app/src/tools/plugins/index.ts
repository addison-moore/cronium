// Plugin registry initialization
import { ToolPluginRegistry } from "../types/tool-plugin";
import { EmailPlugin } from "./email/email-plugin";
import { SlackPluginTrpc as SlackPlugin } from "./slack/slack-plugin";
import { DiscordPlugin } from "./discord/discord-plugin";
import { GoogleSheetsPlugin } from "./google-sheets/google-sheets-plugin";
import { TeamsPlugin } from "./teams/teams-plugin";
import { NotionPlugin } from "./notion/notion-plugin";
import { TrelloPlugin } from "./trello/trello-plugin";

// Track initialization state globally
declare global {
  var __pluginsInitialized: boolean | undefined;
}

// Register all built-in plugins
export function initializePlugins() {
  // Check if already initialized
  if (global.__pluginsInitialized) {
    return;
  }

  ToolPluginRegistry.register(EmailPlugin);
  ToolPluginRegistry.register(SlackPlugin);
  ToolPluginRegistry.register(DiscordPlugin);
  ToolPluginRegistry.register(GoogleSheetsPlugin);
  ToolPluginRegistry.register(TeamsPlugin);
  ToolPluginRegistry.register(NotionPlugin);
  ToolPluginRegistry.register(TrelloPlugin);

  global.__pluginsInitialized = true;
}

// Export plugins for manual registration if needed
export {
  EmailPlugin,
  SlackPlugin,
  DiscordPlugin,
  GoogleSheetsPlugin,
  TeamsPlugin,
  NotionPlugin,
  TrelloPlugin,
};

// Export registry for easy access
export { ToolPluginRegistry };

// Initialize plugins automatically when this module is imported
initializePlugins();
