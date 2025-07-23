import { z } from "zod";

// Notion credentials schema
export const notionCredentialsSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  workspaceId: z.string().optional(), // Default workspace ID
});

// Type definitions
export type NotionCredentials = z.infer<typeof notionCredentialsSchema>;
