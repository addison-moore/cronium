import { readDataAction } from "./read-data";
import { writeDataAction } from "./write-data";
import { createSheetAction } from "./create-sheet";
import type { ToolAction } from "@/components/tools/types/tool-plugin";

export const googleSheetsActions: Record<string, ToolAction> = {
  "read-data": readDataAction,
  "write-data": writeDataAction,
  "create-sheet": createSheetAction,
};
