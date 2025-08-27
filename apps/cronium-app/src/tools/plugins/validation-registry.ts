// Server-side validation registry for tool plugins
// This file contains only the schemas and validation logic, no React components

import { z } from "zod";

// Import all plugin schemas
import { emailCredentialsSchema } from "./email/schemas";
import { slackCredentialsSchema } from "./slack/schemas";
import { discordCredentialsSchema } from "./discord/schemas";
import { googleSheetsCredentialsSchema } from "./google-sheets/schemas";
import { teamsCredentialsSchema } from "./teams/schemas";
import { notionCredentialsSchema } from "./notion/schemas";
import { trelloCredentialsSchema } from "./trello/schemas";

// Map of tool types to their validation schemas
const validationSchemas: Record<string, z.ZodSchema> = {
  email: emailCredentialsSchema,
  slack: slackCredentialsSchema,
  discord: discordCredentialsSchema,
  "google-sheets": googleSheetsCredentialsSchema,
  teams: teamsCredentialsSchema,
  notion: notionCredentialsSchema,
  trello: trelloCredentialsSchema,
};

// Server-side validation function
export function validateToolCredentials(
  toolType: string,
  credentials: unknown,
): { valid: boolean; errors: string[] } {
  const schema = validationSchemas[toolType.toLowerCase()];

  if (!schema) {
    return {
      valid: false,
      errors: [`Unsupported tool type: ${toolType}`],
    };
  }

  const result = schema.safeParse(credentials);

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map(
        (e) => `${e.path.join(".")}: ${e.message}`,
      ),
    };
  }

  return { valid: true, errors: [] };
}

// Get list of supported tool types
export function getSupportedToolTypes(): string[] {
  return Object.keys(validationSchemas);
}
