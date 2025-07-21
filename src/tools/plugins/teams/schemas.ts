import { z } from "zod";

// Teams credentials schema
export const teamsCredentialsSchema = z.object({
  scope: z.string().min(1, "Scope is required"),
  webhookUrl: z
    .string()
    .url("Must be a valid URL")
    .optional()
    .describe("Teams webhook URL for sending messages"),
  clientId: z.string().optional().describe("Azure AD application client ID"),
  clientSecret: z
    .string()
    .optional()
    .describe("Azure AD application client secret"),
  tenantId: z.string().optional().describe("Azure AD tenant ID"),
  refreshToken: z.string().optional(),
});

// Type definitions
export type TeamsCredentials = z.infer<typeof teamsCredentialsSchema>;
