import type { ToolManifest } from "@/lib/tools/tool-manifest";
import { emailCredentialsSchema } from "./schemas";
import { emailActions } from "./actions";
import { testConnection } from "./connection-test";

export const emailManifest: ToolManifest = {
  type: "email",
  credentialSchema: emailCredentialsSchema,
  actions: emailActions,
  testConnection,
};
