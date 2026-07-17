import type { ToolManifest } from "@/lib/tools/tool-manifest";
import { mongoCredentialsSchema } from "./schemas";
import { mongoActions } from "./actions";
import { testConnection } from "./connection-test";

export const mongodbManifest: ToolManifest = {
  type: "mongodb",
  credentialSchema: mongoCredentialsSchema,
  actions: Object.values(mongoActions),
  testConnection,
};
