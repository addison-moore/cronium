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
  credentials: z.record(z.string(), z.any()), // Will be validated by the tool plugin
  tags: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

// Update tool schema
export const updateToolSchema = z
  .object({
    id: z.number().int().positive("Tool ID must be a positive integer"),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    credentials: z.record(z.string(), z.any()).optional(),
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

// Tool statistics schema
export const toolStatsSchema = z.object({
  period: z.enum(["day", "week", "month", "year"]).default("week"),
  toolId: z.number().int().positive().optional(),
  groupBy: z.enum(["type", "usage", "success_rate"]).default("type"),
});
