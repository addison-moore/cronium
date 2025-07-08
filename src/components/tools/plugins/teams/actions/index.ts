import { sendMessageAction } from "./send-message";
import { sendCardAction } from "./send-card";
import { createMeetingAction } from "./create-meeting";
import { manageTeamAction } from "./manage-team";
import type { ToolAction } from "@/components/tools/types/tool-plugin";

export const teamsActions: Record<string, ToolAction> = {
  "send-message": sendMessageAction,
  "send-card": sendCardAction,
  "create-meeting": createMeetingAction,
  "manage-team": manageTeamAction,
};
