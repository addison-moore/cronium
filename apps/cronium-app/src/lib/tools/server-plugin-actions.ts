/**
 * Server-side tool action registry.
 *
 * The tool plugin objects live in "use client" modules (`*-plugin.tsx`), so when
 * server code imports them through `@/tools/plugins` they arrive as client
 * reference proxies with no usable `execute`/`actions`. Routing job execution
 * through those proxies silently produced an empty action registry and every
 * tool action failed with "Action not found".
 *
 * This module bypasses the plugin objects entirely and imports each plugin's
 * action definitions — which are plain, server-safe modules — directly. It is
 * the single source of truth for executing a tool action on the server.
 */
import type { ToolAction } from "@/tools/types/tool-plugin";
import { slackActions } from "@/tools/plugins/slack/actions";
import { discordActions } from "@/tools/plugins/discord/actions";
import { teamsActions } from "@/tools/plugins/teams/actions";
import { notionActions } from "@/tools/plugins/notion/actions";
import { trelloActions } from "@/tools/plugins/trello/actions";
import { googleSheetsActions } from "@/tools/plugins/google-sheets/actions";
import { emailActions } from "@/tools/plugins/email/actions";

// Each non-email plugin exports a Record<id, ToolAction>; email exports an array.
function toList(
  actions: Record<string, ToolAction> | ToolAction[],
): ToolAction[] {
  return Array.isArray(actions) ? actions : Object.values(actions);
}

const ALL_ACTIONS: ToolAction[] = [
  ...toList(slackActions),
  ...toList(discordActions),
  ...toList(teamsActions),
  ...toList(notionActions),
  ...toList(trelloActions),
  ...toList(googleSheetsActions),
  ...toList(emailActions),
];

// Built once at module load. Duplicate ids would mean a plugin bug; the last
// one wins, which matches Map semantics and is fine for our unique ids.
const ACTIONS_BY_ID = new Map<string, ToolAction>(
  ALL_ACTIONS.map((action) => [action.id, action]),
);

export function getServerActionById(actionId: string): ToolAction | undefined {
  return ACTIONS_BY_ID.get(actionId);
}

export function getAllServerActionIds(): string[] {
  return Array.from(ACTIONS_BY_ID.keys());
}
