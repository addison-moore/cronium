import { createCardAction } from "./create-card";
import { moveCardAction } from "./move-card";
import { addChecklistAction } from "./add-checklist";
import type { ToolAction } from "@/components/tools/types/tool-plugin";

export const trelloActions: Record<string, ToolAction> = {
  "create-card": createCardAction,
  "move-card": moveCardAction,
  "add-checklist": addChecklistAction,
};
