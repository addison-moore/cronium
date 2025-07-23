import { z } from "zod";

// Google Sheets credentials schema
export const googleSheetsCredentialsSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
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
