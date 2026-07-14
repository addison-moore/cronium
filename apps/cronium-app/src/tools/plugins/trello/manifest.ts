import type { ToolManifest } from "@/lib/tools/tool-manifest";
import { trelloCredentialsSchema } from "./schemas";
import { trelloActions } from "./actions";
import { testConnection } from "./connection-test";

export const trelloManifest: ToolManifest = {
  type: "trello",
  credentialSchema: trelloCredentialsSchema,
  actions: Object.values(trelloActions),
  testConnection,
};
