/**
 * OAuth configuration per plugin, in a plain (non-"use client") module.
 *
 * The plugin objects that carry `requiresOAuth` live in "use client" files, so
 * server code can't read it off them (it gets a client reference proxy). The
 * OAuth credential bridge reads from here instead; the plugin files import the
 * same values, keeping a single source of truth.
 */
export interface PluginOAuthConfig {
  providerId: "google" | "microsoft" | "slack";
  scope: string;
}

export const GOOGLE_SHEETS_OAUTH: PluginOAuthConfig = {
  providerId: "google",
  scope: "https://www.googleapis.com/auth/spreadsheets",
};

// Keyed by plugin id (toolType lowercased with underscores -> hyphens).
export const PLUGIN_OAUTH_CONFIG: Record<string, PluginOAuthConfig> = {
  "google-sheets": GOOGLE_SHEETS_OAUTH,
};

export function getPluginOAuthConfig(
  pluginId: string,
): PluginOAuthConfig | undefined {
  return PLUGIN_OAUTH_CONFIG[pluginId];
}
