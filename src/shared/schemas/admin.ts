import { z } from "zod";
import { UserRole, UserStatus } from "../schema";

// Base admin query schema
export const adminQuerySchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

// User invitation schema
export const inviteUserSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  role: z.nativeEnum(UserRole, { required_error: "User role is required" }),
});

// User update schema
export const updateUserSchema = z.object({
  id: z.string().min(1, "User ID is required"),
  email: z.string().email().optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

// User ID parameter schema
export const userIdSchema = z.object({
  id: z.string().min(1, "User ID is required"),
});

// User enable/disable schema
export const toggleUserStatusSchema = z.object({
  id: z.string().min(1, "User ID is required"),
  status: z.nativeEnum(UserStatus, { required_error: "Status is required" }),
});

// Bulk user operations schema
export const bulkUserOperationSchema = z.object({
  userIds: z.array(z.string()).min(1, "At least one user must be selected"),
  operation: z.enum(["activate", "deactivate", "delete", "resend_invite"]),
});

// Variables schemas
export const createVariableSchema = z.object({
  key: z.string().min(1, "Variable key is required").max(100, "Key must be less than 100 characters")
    .regex(/^[A-Z_][A-Z0-9_]*$/, "Key must contain only uppercase letters, numbers, and underscores"),
  value: z.string().max(1000, "Value must be less than 1000 characters"),
  description: z.string().max(500, "Description must be less than 500 characters").optional(),
  isGlobal: z.boolean().default(true),
  isEncrypted: z.boolean().default(false),
});

export const updateVariableSchema = z.object({
  id: z.number().int().positive("Variable ID must be a positive integer"),
  key: z.string().min(1).max(100)
    .regex(/^[A-Z_][A-Z0-9_]*$/, "Key must contain only uppercase letters, numbers, and underscores").optional(),
  value: z.string().max(1000).optional(),
  description: z.string().max(500).optional(),
  isGlobal: z.boolean().optional(),
  isEncrypted: z.boolean().optional(),
});

export const variableIdSchema = z.object({
  id: z.number().int().positive("Variable ID must be a positive integer"),
});

export const variableQuerySchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
  isGlobal: z.boolean().optional(),
  userId: z.string().optional(),
});

// System settings schemas
export const systemSettingsSchema = z.object({
  maxUsers: z.number().min(1).max(1000).optional(),
  maxEventsPerUser: z.number().min(1).max(10000).optional(),
  maxWorkflowsPerUser: z.number().min(1).max(1000).optional(),
  maxServersPerUser: z.number().min(1).max(100).optional(),
  enableRegistration: z.boolean().optional(),
  enableGuestAccess: z.boolean().optional(),
  defaultUserRole: z.nativeEnum(UserRole).optional(),
  sessionTimeout: z.number().min(60).max(86400).optional(), // 1 minute to 24 hours in seconds
  logRetentionDays: z.number().min(1).max(365).optional(),
  // SMTP settings
  smtpHost: z.string().optional(),
  smtpPort: z.string().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpFromEmail: z.string().email().optional(),
  smtpFromName: z.string().optional(),
  smtpEnabled: z.boolean().optional(),
  // Registration settings
  allowRegistration: z.boolean().optional(),
  requireAdminApproval: z.boolean().optional(),
  inviteOnly: z.boolean().optional(),
  // AI settings
  aiEnabled: z.boolean().optional(),
  aiModel: z.string().optional(),
  openaiApiKey: z.string().optional(),
});

// Logs query schema
export const adminLogsSchema = z.object({
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  level: z.enum(["ERROR", "WARN", "INFO", "DEBUG"]).optional(),
  userId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
});

export const logIdSchema = z.object({
  id: z.string().min(1, "Log ID is required"),
});

// System stats schema
export const systemStatsSchema = z.object({
  period: z.enum(["day", "week", "month", "year"]).default("week"),
});

// Type definitions inferred from schemas
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type AdminQueryInput = z.infer<typeof adminQuerySchema>;
export type ToggleUserStatusInput = z.infer<typeof toggleUserStatusSchema>;
export type BulkUserOperationInput = z.infer<typeof bulkUserOperationSchema>;
export type CreateVariableInput = z.infer<typeof createVariableSchema>;
export type UpdateVariableInput = z.infer<typeof updateVariableSchema>;
export type VariableQueryInput = z.infer<typeof variableQuerySchema>;
export type SystemSettingsInput = z.infer<typeof systemSettingsSchema>;
export type AdminLogsInput = z.infer<typeof adminLogsSchema>;
export type SystemStatsInput = z.infer<typeof systemStatsSchema>;