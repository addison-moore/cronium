import type { ToolManifest } from "@/lib/tools/tool-manifest";
import { googleSheetsCredentialsSchema } from "./schemas";
import { googleSheetsActions } from "./actions";
import { testConnection } from "./connection-test";
import { GOOGLE_SHEETS_OAUTH } from "../oauth-config";

export const googleSheetsManifest: ToolManifest = {
  type: "google-sheets",
  credentialSchema: googleSheetsCredentialsSchema,
  actions: Object.values(googleSheetsActions),
  testConnection,
  oauth: GOOGLE_SHEETS_OAUTH,
};
