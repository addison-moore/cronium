import { promptAction } from "./prompt";
import type { ToolAction } from "@/tools/types/tool-plugin";

export const aiActions: Record<string, ToolAction> = {
  "ai-prompt": promptAction,
};
