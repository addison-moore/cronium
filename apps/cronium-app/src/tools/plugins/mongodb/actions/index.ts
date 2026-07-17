import { findDocumentsAction } from "./find-documents";
import { aggregateDocumentsAction } from "./aggregate-documents";
import { insertDocumentsAction } from "./insert-documents";
import { updateDocumentsAction } from "./update-documents";
import { deleteDocumentsAction } from "./delete-documents";
import type { ToolAction } from "@/tools/types/tool-plugin";

export const mongoActions: Record<string, ToolAction> = {
  "find-documents": findDocumentsAction,
  "aggregate-documents": aggregateDocumentsAction,
  "insert-documents": insertDocumentsAction,
  "update-documents": updateDocumentsAction,
  "delete-documents": deleteDocumentsAction,
};
