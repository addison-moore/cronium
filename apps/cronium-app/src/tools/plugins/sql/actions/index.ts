import { runQueryAction } from "./run-query";
import { executeStatementAction } from "./execute-statement";
import type { ToolAction } from "@/tools/types/tool-plugin";

export const sqlActions: Record<string, ToolAction> = {
  "run-query": runQueryAction,
  "execute-statement": executeStatementAction,
};
