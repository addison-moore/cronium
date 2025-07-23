import { z } from "zod";

// Trello credentials schema
export const trelloCredentialsSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  apiToken: z.string().min(1, "API token is required"),
  boardId: z.string().optional(), // Default board ID
});

// Type definitions
export type TrelloCredentials = z.infer<typeof trelloCredentialsSchema>;
