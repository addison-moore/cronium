import type { ToolManifest } from "@/lib/tools/tool-manifest";
import { slackCredentialsSchema } from "./schemas";
import { slackActions } from "./actions";
import { testConnection } from "./connection-test";

export const slackManifest: ToolManifest = {
  type: "slack",
  credentialSchema: slackCredentialsSchema,
  actions: Object.values(slackActions),
  testConnection,
};
