import { sendMessageAction } from "./send-message";
import { manageRolesAction } from "./manage-roles";
import { createChannelAction } from "./create-channel";
import type { ToolAction } from "@/components/tools/types/tool-plugin";

export const discordActions: Record<string, ToolAction> = {
  "discord-send-message": sendMessageAction,
  "manage-roles": manageRolesAction,
  "create-channel": createChannelAction,
};
