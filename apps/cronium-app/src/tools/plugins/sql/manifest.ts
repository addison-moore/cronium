import type { ToolManifest } from "@/lib/tools/tool-manifest";
import { sqlCredentialsSchema } from "./schemas";
import { sqlActions } from "./actions";
import { testConnection } from "./connection-test";

export const sqlManifest: ToolManifest = {
  type: "sql",
  credentialSchema: sqlCredentialsSchema,
  actions: Object.values(sqlActions),
  testConnection,
};
