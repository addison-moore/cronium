import { createCardAction } from "./create-card";
import { moveCardAction } from "./move-card";
import { addMemberAction } from "./add-member";
import { addChecklistAction } from "./add-checklist";
import { attachFileAction } from "./attach-file";
import type { ToolAction } from "@/components/tools/types/tool-plugin";

export const trelloActions: Record<string, ToolAction> = {
  "create-card": createCardAction,
  "move-card": moveCardAction,
  "add-member": addMemberAction,
  "add-checklist": addChecklistAction,
  "attach-file": attachFileAction,
};
