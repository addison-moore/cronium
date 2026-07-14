/**
 * The self-contained, server-safe contract for a tool.
 *
 * Everything the server needs to run and validate a tool lives here — its
 * credential schema, actions, connection test, and OAuth config — with NO React
 * and NO "use client". A tool's `manifest.ts` assembles this from the tool's own
 * folder; the single `tool-registry.ts` imports every manifest.
 *
 * This is what makes a tool pluggable: adding one means creating its folder +
 * manifest and adding one import to the registry — no edits to routers, no
 * per-tool validation/connection/oauth registries.
 */
import { type z } from "zod";
import type { ToolAction } from "@/tools/types/tool-plugin";
import type { ConnectionTestResult } from "@/lib/tools/connection-test";

export interface ToolOAuthConfig {
  providerId: "google" | "microsoft" | "slack";
  scope: string;
}

export interface ToolManifest {
  /** Canonical tool type, e.g. "slack", "google-sheets" (lowercase, hyphenated). */
  type: string;
  /** Zod schema for the tool's stored credentials. */
  credentialSchema: z.ZodSchema;
  /** The actions this tool exposes. */
  actions: ToolAction[];
  /** Verify credentials against the live provider. */
  testConnection: (
    credentials: Record<string, unknown>,
  ) => Promise<ConnectionTestResult>;
  /** Present only for OAuth-based tools; the server injects a token before execute(). */
  oauth?: ToolOAuthConfig;
}
