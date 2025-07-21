import { createPageAction } from "./create-page";
import { updateDatabaseAction } from "./update-database";
import { searchContentAction } from "./search-content";
import { manageBlocksAction } from "./manage-blocks";
import type { ToolAction } from "@/tools/types/tool-plugin";

export const notionActions: Record<string, ToolAction> = {
  "create-page": createPageAction,
  "update-database": updateDatabaseAction,
  "search-content": searchContentAction,
  "manage-blocks": manageBlocksAction,
};
