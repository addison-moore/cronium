import type { ToolManifest } from "@/lib/tools/tool-manifest";
import { teamsCredentialsSchema } from "./schemas";
import { teamsActions } from "./actions";
import { testConnection } from "./connection-test";

export const teamsManifest: ToolManifest = {
  type: "teams",
  credentialSchema: teamsCredentialsSchema,
  actions: Object.values(teamsActions),
  testConnection,
};
