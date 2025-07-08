import { sendMessageAction } from "./send-message";
import type { ToolAction } from "@/components/tools/types/tool-plugin";

// Export all Slack actions - Simplified for MVP
export const slackActions: Record<string, ToolAction> = {
  "slack-send-message": sendMessageAction,
};

// Export individual actions for direct import
export { sendMessageAction };
