import { z } from "zod";

// Base tool query schema
export const toolQuerySchema = z.object({
  limit: z.number().min(1).max(1000).default(20), // Increased limit for client-side filtering
  offset: z.number().min(0).default(0),
  type: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(["name", "type", "createdAt", "updatedAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

// Tool-specific credential schemas have been moved to their respective plugin directories
// See src/tools/plugins/[tool-name]/schemas.ts

// Create tool schema - credentials will be validated by plugins
export const createToolSchema = z.object({
  name: z
    .string()
    .min(1, "Tool name is required")
    .max(100, "Name must be less than 100 characters"),
  type: z.string().min(1, { message: "Tool type is required" }),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional(),
  credentials: z.record(z.any()), // Will be validated by the tool plugin
  tags: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

// Update tool schema
export const updateToolSchema = z
  .object({
    id: z.number().int().positive("Tool ID must be a positive integer"),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    credentials: z.record(z.any()).optional(),
    tags: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // Only validate credentials if they are provided
      if (!data.credentials) return true;

      // Note: We can't validate type-specific credentials here without knowing the tool type
      // This validation will be done in the router after fetching the existing tool
      return true;
    },
    {
      message: "Invalid credentials format",
      path: ["credentials"],
    },
  );

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
  toolIds: z
    .array(z.number().int().positive())
    .min(1, "At least one tool must be selected"),
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
  type: z.string().min(1, { message: "Tool type is required" }),
  credentials: z.record(z.any()),
  testConnection: z.boolean().default(false),
});

// Tool export/import schemas
export const toolExportSchema = z.object({
  toolIds: z
    .array(z.number().int().positive())
    .min(1, "At least one tool must be selected"),
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
export type CreateToolInput = z.infer<typeof createToolSchema>;
export type UpdateToolInput = z.infer<typeof updateToolSchema>;
export type TestToolInput = z.infer<typeof testToolSchema>;
export type BulkToolOperationInput = z.infer<typeof bulkToolOperationSchema>;
export type ToolUsageInput = z.infer<typeof toolUsageSchema>;
export type ValidateToolCredentialsInput = z.infer<
  typeof validateToolCredentialsSchema
>;
export type ToolExportInput = z.infer<typeof toolExportSchema>;
export type ToolImportInput = z.infer<typeof toolImportSchema>;
export type ToolStatsInput = z.infer<typeof toolStatsSchema>;
