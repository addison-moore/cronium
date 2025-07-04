import { z } from "zod";

// Base variable query schema
export const variableQuerySchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
  sortBy: z.enum(["key", "createdAt", "updatedAt"]).default("key"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

// Create user variable schema
export const createUserVariableSchema = z.object({
  key: z.string()
    .min(1, "Variable key is required")
    .max(100, "Key must be less than 100 characters")
    .regex(/^[A-Z_][A-Z0-9_]*$/, "Key must contain only uppercase letters, numbers, and underscores"),
  value: z.string()
    .max(10000, "Value must be less than 10,000 characters"),
  description: z.string()
    .max(500, "Description must be less than 500 characters")
    .optional(),
})
.refine((data) => {
  // Validate that the key doesn't start with a reserved prefix
  const reservedPrefixes = ["CRONIUM_", "SYSTEM_", "NODE_", "PATH", "HOME"];
  return !reservedPrefixes.some(prefix => data.key.startsWith(prefix));
}, {
  message: "Variable key cannot start with reserved prefixes (CRONIUM_, SYSTEM_, NODE_, PATH, HOME)",
  path: ["key"],
});

// Update user variable schema
export const updateUserVariableSchema = z.object({
  id: z.number().int().positive("Variable ID must be a positive integer"),
  key: z.string()
    .min(1)
    .max(100)
    .regex(/^[A-Z_][A-Z0-9_]*$/, "Key must contain only uppercase letters, numbers, and underscores")
    .optional(),
  value: z.string()
    .max(10000)
    .optional(),
  description: z.string()
    .max(500)
    .optional(),
})
.refine((data) => {
  // Validate that the key doesn't start with a reserved prefix if key is provided
  if (!data.key) return true;
  const reservedPrefixes = ["CRONIUM_", "SYSTEM_", "NODE_", "PATH", "HOME"];
  return !reservedPrefixes.some(prefix => data.key!.startsWith(prefix));
}, {
  message: "Variable key cannot start with reserved prefixes (CRONIUM_, SYSTEM_, NODE_, PATH, HOME)",
  path: ["key"],
});

// Variable ID parameter schema
export const variableIdSchema = z.object({
  id: z.number().int().positive("Variable ID must be a positive integer"),
});

// Variable key parameter schema
export const variableKeySchema = z.object({
  key: z.string().min(1, "Variable key is required"),
});

// Bulk variable operations schema
export const bulkVariableOperationSchema = z.object({
  variableIds: z.array(z.number().int().positive()).min(1, "At least one variable must be selected"),
  operation: z.enum(["delete", "export"]),
});

// Variable export schema
export const variableExportSchema = z.object({
  variableIds: z.array(z.number().int().positive()).min(1, "At least one variable must be selected"),
  format: z.enum(["json", "env", "csv"]).default("json"),
  includeValues: z.boolean().default(true),
  includeDescriptions: z.boolean().default(true),
});

// Variable import schema
export const variableImportSchema = z.object({
  format: z.enum(["json", "env"]),
  data: z.string().min(1, "Import data is required"),
  overwriteExisting: z.boolean().default(false),
  validateKeys: z.boolean().default(true),
});

// Variable validation schema (for testing key/value before save)
export const validateVariableSchema = z.object({
  key: z.string().min(1, "Variable key is required"),
  value: z.string(),
  checkDuplicates: z.boolean().default(true),
});

// Variable usage schema (for getting variables used in events/workflows)
export const variableUsageSchema = z.object({
  variableId: z.number().int().positive("Variable ID must be a positive integer").optional(),
  key: z.string().optional(),
  includeEvents: z.boolean().default(true),
  includeWorkflows: z.boolean().default(true),
})
.refine((data) => {
  // Either variableId or key must be provided
  return data.variableId !== undefined || data.key !== undefined;
}, {
  message: "Either variableId or key must be provided",
  path: ["variableId", "key"],
});

// Type definitions inferred from schemas
export type VariableQueryInput = z.infer<typeof variableQuerySchema>;
export type CreateUserVariableInput = z.infer<typeof createUserVariableSchema>;
export type UpdateUserVariableInput = z.infer<typeof updateUserVariableSchema>;
export type BulkVariableOperationInput = z.infer<typeof bulkVariableOperationSchema>;
export type VariableExportInput = z.infer<typeof variableExportSchema>;
export type VariableImportInput = z.infer<typeof variableImportSchema>;
export type ValidateVariableInput = z.infer<typeof validateVariableSchema>;
export type VariableUsageInput = z.infer<typeof variableUsageSchema>;