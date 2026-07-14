/**
 * The single server-side tool registry.
 *
 * This replaces four separate per-tool registries that each re-listed every
 * tool (actions, credential schemas, the connection-test switch, and OAuth
 * config). Everything now comes from one list of manifests below — adding a
 * tool means creating its folder + manifest and adding one import here. Nothing
 * else on the server needs to change.
 *
 * Server-safe: manifests carry no React / "use client".
 */
import type { ToolManifest, ToolOAuthConfig } from "@/lib/tools/tool-manifest";
import type { ToolAction } from "@/tools/types/tool-plugin";
import type { ConnectionTestResult } from "@/lib/tools/connection-test";

import { slackManifest } from "@/tools/plugins/slack/manifest";
import { discordManifest } from "@/tools/plugins/discord/manifest";
import { teamsManifest } from "@/tools/plugins/teams/manifest";
import { notionManifest } from "@/tools/plugins/notion/manifest";
import { trelloManifest } from "@/tools/plugins/trello/manifest";
import { googleSheetsManifest } from "@/tools/plugins/google-sheets/manifest";
import { emailManifest } from "@/tools/plugins/email/manifest";

// ── The single list. Add a tool by adding its manifest import above + here. ──
const MANIFESTS: ToolManifest[] = [
  slackManifest,
  discordManifest,
  teamsManifest,
  notionManifest,
  trelloManifest,
  googleSheetsManifest,
  emailManifest,
];

export type { ConnectionTestResult };

function normalizeType(type: string): string {
  return type.toLowerCase().replace(/_/g, "-");
}

const BY_TYPE = new Map<string, ToolManifest>(
  MANIFESTS.map((m) => [m.type, m]),
);
// Action ids are the global routing key (stored events reference them by
// string), so a collision would silently shadow one tool's action with
// another's. Fail loudly at module load instead of at runtime.
const ACTION_BY_ID = new Map<string, ToolAction>();
for (const m of MANIFESTS) {
  for (const action of m.actions) {
    const existing = ACTION_BY_ID.get(action.id);
    if (existing) {
      throw new Error(
        `Duplicate tool action id "${action.id}" (in "${m.type}" and an earlier manifest). Action ids must be globally unique.`,
      );
    }
    ACTION_BY_ID.set(action.id, action);
  }
}

export function getManifest(type: string): ToolManifest | undefined {
  return BY_TYPE.get(normalizeType(type));
}

export function getServerActionById(actionId: string): ToolAction | undefined {
  return ACTION_BY_ID.get(actionId);
}

export function getAllServerActionIds(): string[] {
  return Array.from(ACTION_BY_ID.keys());
}

export function getSupportedToolTypes(): string[] {
  return Array.from(BY_TYPE.keys());
}

export function getOAuthConfig(type: string): ToolOAuthConfig | undefined {
  return getManifest(type)?.oauth;
}

/** Validate credentials against a tool's schema. */
export function validateToolCredentials(
  type: string,
  credentials: unknown,
): { valid: boolean; errors: string[] } {
  const manifest = getManifest(type);
  if (!manifest) {
    return { valid: false, errors: [`Unsupported tool type: ${type}`] };
  }
  const result = manifest.credentialSchema.safeParse(credentials);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(
        (e) => `${e.path.join(".")}: ${e.message}`,
      ),
    };
  }
  return { valid: true, errors: [] };
}

/** Run a tool's live connection test. Never throws — returns an honest result. */
export async function testToolConnection(
  type: string,
  credentials: Record<string, unknown>,
): Promise<ConnectionTestResult> {
  const manifest = getManifest(type);
  if (!manifest) {
    return {
      success: false,
      message: `No connection test available for ${type}`,
    };
  }
  try {
    return await manifest.testConnection(credentials);
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Connection test timed out"
        : error instanceof Error
          ? error.message
          : "Connection test failed";
    return { success: false, message };
  }
}
