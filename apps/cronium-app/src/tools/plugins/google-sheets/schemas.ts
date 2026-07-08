import { z } from "zod";

// Google Sheets credentials schema.
// Authentication happens via the server-configured Google OAuth app
// (OAUTH_GOOGLE_CLIENT_ID/SECRET env) and the per-user Connect flow;
// clientId/clientSecret are kept optional for legacy stored credentials.
export const googleSheetsCredentialsSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  refreshToken: z.string().optional(),
  scope: z
    .string()
    .min(1, "Scope is required")
    .default("https://www.googleapis.com/auth/spreadsheets"),
  spreadsheetId: z.string().optional(), // Default spreadsheet ID
});

// Type definitions
export type GoogleSheetsCredentials = z.infer<
  typeof googleSheetsCredentialsSchema
>;
