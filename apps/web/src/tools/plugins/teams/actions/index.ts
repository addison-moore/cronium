import { sendMessageAction } from "./send-message";
import { sendCardAction } from "./send-card";
import type { ToolAction } from "@/tools/types/tool-plugin";

export const teamsActions: Record<string, ToolAction> = {
  "send-message": sendMessageAction,
  "send-card": sendCardAction,
};
