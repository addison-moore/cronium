import type { ToolManifest } from "@/lib/tools/tool-manifest";
import { discordCredentialsSchema } from "./schemas";
import { discordActions } from "./actions";
import { testConnection } from "./connection-test";

export const discordManifest: ToolManifest = {
  type: "discord",
  credentialSchema: discordCredentialsSchema,
  actions: Object.values(discordActions),
  testConnection,
};
