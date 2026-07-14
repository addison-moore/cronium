import type { ToolManifest } from "@/lib/tools/tool-manifest";
import { notionCredentialsSchema } from "./schemas";
import { notionActions } from "./actions";
import { testConnection } from "./connection-test";

export const notionManifest: ToolManifest = {
  type: "notion",
  credentialSchema: notionCredentialsSchema,
  actions: Object.values(notionActions),
  testConnection,
};
