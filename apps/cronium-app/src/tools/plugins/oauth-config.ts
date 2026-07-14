/**
 * OAuth config for tools that need it, in a plain (client-safe) module so both
 * the google-sheets manifest (server) and its "use client" plugin can import it.
 * The tool registry exposes it via `getOAuthConfig(type)`.
 */
export interface PluginOAuthConfig {
  providerId: "google" | "microsoft" | "slack";
  scope: string;
}

export const GOOGLE_SHEETS_OAUTH: PluginOAuthConfig = {
  providerId: "google",
  scope: "https://www.googleapis.com/auth/spreadsheets",
};
