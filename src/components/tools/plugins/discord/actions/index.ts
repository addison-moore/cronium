import { sendMessageAction } from "./send-message";
import type { ToolAction } from "@/components/tools/types/tool-plugin";

export const discordActions: Record<string, ToolAction> = {
  "discord-send-message": sendMessageAction,
};
