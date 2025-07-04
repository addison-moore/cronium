import { z } from "zod";
import { ToolType } from "../schema";

// Base tool query schema
export const toolQuerySchema = z.object({
  limit: z.number().min(1).max(1000).default(20), // Increased limit for client-side filtering
  offset: z.number().min(0).default(0),
  type: z.nativeEnum(ToolType).optional(),
  search: z.string().optional(),
  sortBy: z.enum(["name", "type", "createdAt", "updatedAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

// Slack credentials schema
export const slackCredentialsSchema = z.object({
  webhookUrl: z.string().url("Must be a valid webhook URL")
    .refine(url => url.includes("hooks.slack.com"), "Must be a valid Slack webhook URL"),
  channel: z.string().optional(),
  username: z.string().optional(),
  iconEmoji: z.string().optional(),
  iconUrl: z.string().url().optional(),
});

// Discord credentials schema
export const discordCredentialsSchema = z.object({
  webhookUrl: z.string().url("Must be a valid webhook URL")
    .refine(url => url.includes("discord.com/api/webhooks"), "Must be a valid Discord webhook URL"),
  username: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

// Email credentials schema
export const emailCredentialsSchema = z.object({
  smtpHost: z.string().min(1, "SMTP host is required"),
  smtpPort: z.number().int().min(1).max(65535, "Port must be between 1 and 65535"),
  smtpUser: z.string().min(1, "SMTP username is required"),
  smtpPassword: z.string().min(1, "SMTP password is required"),
  fromEmail: z.string().email("Must be a valid email address"),
  fromName: z.string().optional(),
  enableTLS: z.boolean().default(true),
  enableSSL: z.boolean().default(false),
});

// Webhook credentials schema (for custom webhooks)
export const webhookCredentialsSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  method: z.enum(["GET", "POST", "PUT", "PATCH"]).default("POST"),
  headers: z.record(z.string()).optional(),
  authType: z.enum(["none", "bearer", "basic", "api_key"]).default("none"),
  authToken: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  apiKeyHeader: z.string().optional(),
  apiKeyValue: z.string().optional(),
});

// HTTP credentials schema (for HTTP requests)
export const httpCredentialsSchema = z.object({
  baseUrl: z.string().url("Must be a valid base URL"),
  defaultHeaders: z.record(z.string()).optional(),
  authType: z.enum(["none", "bearer", "basic", "api_key"]).default("none"),
  authToken: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  apiKeyHeader: z.string().optional(),
  apiKeyValue: z.string().optional(),
  timeout: z.number().int().min(1).max(300).default(30), // timeout in seconds
});

// Create tool schema with dynamic credentials validation
export const createToolSchema = z.object({
  name: z.string().min(1, "Tool name is required").max(100, "Name must be less than 100 characters"),
  type: z.nativeEnum(ToolType, { required_error: "Tool type is required" }),
  description: z.string().max(500, "Description must be less than 500 characters").optional(),
  credentials: z.record(z.any()), // Will be validated based on type
  tags: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
})
.refine((data) => {
  // Validate credentials based on tool type
  try {
    switch (data.type) {
      case ToolType.SLACK:
        slackCredentialsSchema.parse(data.credentials);
        break;
      case ToolType.DISCORD:
        discordCredentialsSchema.parse(data.credentials);
        break;
      case ToolType.EMAIL:
        emailCredentialsSchema.parse(data.credentials);
        break;
      case ToolType.WEBHOOK:
        webhookCredentialsSchema.parse(data.credentials);
        break;
      case ToolType.HTTP:
        httpCredentialsSchema.parse(data.credentials);
        break;
      default:
        return false;
    }
    return true;
  } catch {
    return false;
  }
}, {
  message: "Invalid credentials for the selected tool type",
  path: ["credentials"],
});

// Update tool schema
export const updateToolSchema = z.object({
  id: z.number().int().positive("Tool ID must be a positive integer"),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  credentials: z.record(z.any()).optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
})
.refine((data) => {
  // Only validate credentials if they are provided
  if (!data.credentials) return true;
  
  // Note: We can't validate type-specific credentials here without knowing the tool type
  // This validation will be done in the router after fetching the existing tool
  return true;
}, {
  message: "Invalid credentials format",
  path: ["credentials"],
});

// Tool ID parameter schema
export const toolIdSchema = z.object({
  id: z.number().int().positive("Tool ID must be a positive integer"),
});

// Tool test schema
export const testToolSchema = z.object({
  id: z.number().int().positive("Tool ID must be a positive integer"),
  testData: z.record(z.any()).optional(), // Test-specific data
});

// Bulk tool operations schema
export const bulkToolOperationSchema = z.object({
  toolIds: z.array(z.number().int().positive()).min(1, "At least one tool must be selected"),
  operation: z.enum(["delete", "activate", "deactivate", "test"]),
});

// Tool usage schema (for getting tools used in events/workflows)
export const toolUsageSchema = z.object({
  toolId: z.number().int().positive("Tool ID must be a positive integer"),
  includeEvents: z.boolean().default(true),
  includeWorkflows: z.boolean().default(true),
  includeTemplates: z.boolean().default(true),
});

// Tool credentials validation schema (for testing before save)
export const validateToolCredentialsSchema = z.object({
  type: z.nativeEnum(ToolType, { required_error: "Tool type is required" }),
  credentials: z.record(z.any()),
  testConnection: z.boolean().default(false),
});

// Tool export/import schemas
export const toolExportSchema = z.object({
  toolIds: z.array(z.number().int().positive()).min(1, "At least one tool must be selected"),
  format: z.enum(["json", "yaml"]).default("json"),
  includeCredentials: z.boolean().default(false), // Security consideration
  includeInactive: z.boolean().default(false),
});

export const toolImportSchema = z.object({
  format: z.enum(["json", "yaml"]),
  data: z.string().min(1, "Import data is required"),
  overwriteExisting: z.boolean().default(false),
  validateCredentials: z.boolean().default(true),
  importInactive: z.boolean().default(false),
});

// Tool statistics schema
export const toolStatsSchema = z.object({
  period: z.enum(["day", "week", "month", "year"]).default("week"),
  toolId: z.number().int().positive().optional(),
  groupBy: z.enum(["type", "usage", "success_rate"]).default("type"),
});

// Type definitions inferred from schemas
export type ToolQueryInput = z.infer<typeof toolQuerySchema>;
export type SlackCredentials = z.infer<typeof slackCredentialsSchema>;
export type DiscordCredentials = z.infer<typeof discordCredentialsSchema>;
export type EmailCredentials = z.infer<typeof emailCredentialsSchema>;
export type WebhookCredentials = z.infer<typeof webhookCredentialsSchema>;
export type HttpCredentials = z.infer<typeof httpCredentialsSchema>;
export type CreateToolInput = z.infer<typeof createToolSchema>;
export type UpdateToolInput = z.infer<typeof updateToolSchema>;
export type TestToolInput = z.infer<typeof testToolSchema>;
export type BulkToolOperationInput = z.infer<typeof bulkToolOperationSchema>;
export type ToolUsageInput = z.infer<typeof toolUsageSchema>;
export type ValidateToolCredentialsInput = z.infer<typeof validateToolCredentialsSchema>;
export type ToolExportInput = z.infer<typeof toolExportSchema>;
export type ToolImportInput = z.infer<typeof toolImportSchema>;
export type ToolStatsInput = z.infer<typeof toolStatsSchema>;