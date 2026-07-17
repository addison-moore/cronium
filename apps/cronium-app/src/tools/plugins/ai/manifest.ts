import type { ToolManifest } from "@/lib/tools/tool-manifest";
import { aiCredentialsSchema } from "./schemas";
import { aiActions } from "./actions";
import { testConnection } from "./connection-test";

export const aiManifest: ToolManifest = {
  type: "ai",
  credentialSchema: aiCredentialsSchema,
  actions: Object.values(aiActions),
  testConnection,
};
