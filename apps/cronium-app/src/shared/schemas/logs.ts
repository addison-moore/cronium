import { z } from "zod";
import { LogStatus } from "../schema";

// Base logs query schema
export const logsQuerySchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),

  // Filtering options
  eventId: z.number().int().positive().optional(),
  status: z.nativeEnum(LogStatus).optional(),
  workflowId: z.number().int().positive().optional(),
  date: z.string().optional(), // ISO date string for filtering by date
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),

  // Advanced filtering
  ownEventsOnly: z.boolean().default(false),
  sharedOnly: z.boolean().default(false),
  search: z.string().optional(), // Search in event names, output, etc.

  // Sorting options
  sortBy: z
    .enum(["startTime", "endTime", "duration", "eventName", "status"])
    .default("startTime"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),

  // Admin-specific filters
  userId: z.string().optional(), // For admin to filter by specific user
});

// Admin logs query schema (extends base with admin-only fields)
export const adminLogsQuerySchema = logsQuerySchema.extend({
  // Admin can access all logs across users
  allUsers: z.boolean().default(false),
  // Admin can filter by log level if available
  level: z.enum(["ERROR", "WARN", "INFO", "DEBUG"]).optional(),
});

// Create log schema
export const createLogSchema = z.object({
  eventId: z.number().int().positive("Event ID must be a positive integer"),
  eventName: z.string().min(1, "Event name is required").max(100),
  status: z.nativeEnum(LogStatus),
  output: z
    .string()
    .max(100000, "Output must be less than 100,000 characters")
    .optional(),
  errorOutput: z
    .string()
    .max(100000, "Error output must be less than 100,000 characters")
    .optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  duration: z.number().min(0, "Duration must be non-negative").optional(),
  workflowId: z.number().int().positive().optional(),
  workflowExecutionId: z.number().int().positive().optional(),
  serverId: z.number().int().positive().optional(),
  serverName: z.string().max(100).optional(),
  triggerType: z.enum(["MANUAL", "SCHEDULE", "WEBHOOK", "WORKFLOW"]).optional(),
  metadata: z.record(z.string(), z.any()).optional(), // Additional metadata as JSON
});

// Update log schema
export const updateLogSchema = z.object({
  id: z.number().int().positive("Log ID must be a positive integer"),
  status: z.nativeEnum(LogStatus).optional(),
  output: z.string().max(100000).optional(),
  errorOutput: z.string().max(100000).optional(),
  endTime: z.string().datetime().optional(),
  duration: z.number().min(0).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// Log ID parameter schema
export const logIdSchema = z.object({
  id: z.number().int().positive("Log ID must be a positive integer"),
});

// Bulk log operations schema
export const bulkLogOperationSchema = z.object({
  logIds: z
    .array(z.number().int().positive())
    .min(1, "At least one log must be selected"),
  operation: z.enum(["delete", "export", "archive"]),
});

// Log export schema
export const logExportSchema = z.object({
  logIds: z.array(z.number().int().positive()).optional(),
  filters: logsQuerySchema.optional(),
  format: z.enum(["json", "csv", "txt"]).default("json"),
  includeOutput: z.boolean().default(true),
  includeErrorOutput: z.boolean().default(true),
  includeMetadata: z.boolean().default(false),
});

// Log statistics schema
export const logStatsSchema = z.object({
  period: z.enum(["hour", "day", "week", "month", "year"]).default("day"),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  eventId: z.number().int().positive().optional(),
  workflowId: z.number().int().positive().optional(),
  groupBy: z
    .enum(["status", "event", "workflow", "server", "hour", "day"])
    .optional(),
});

// Real-time log streaming schema
export const logStreamSchema = z.object({
  eventId: z.number().int().positive().optional(),
  workflowId: z.number().int().positive().optional(),
  status: z.array(z.nativeEnum(LogStatus)).optional(),
  since: z.string().datetime().optional(), // Stream logs since this timestamp
});

// Log search schema (for full-text search in output)
export const logSearchSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  searchFields: z
    .array(z.enum(["output", "errorOutput", "eventName"]))
    .default(["output", "errorOutput"]),
  caseSensitive: z.boolean().default(false),
  regex: z.boolean().default(false),
  eventId: z.number().int().positive().optional(),
  workflowId: z.number().int().positive().optional(),
  status: z.nativeEnum(LogStatus).optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

// Workflow-specific log schema
export const workflowLogsSchema = z
  .object({
    workflowId: z
      .number()
      .int()
      .positive("Workflow ID must be a positive integer")
      .optional(),
    executionId: z
      .number()
      .int()
      .positive("Execution ID must be a positive integer")
      .optional(),
    limit: z.number().min(1).max(100).default(20),
    offset: z.number().min(0).default(0),
    status: z.nativeEnum(LogStatus).optional(),
    includeEventLogs: z.boolean().default(true),
  })
  .refine(
    (data) => {
      // Either workflowId or executionId must be provided
      return data.workflowId !== undefined || data.executionId !== undefined;
    },
    {
      message: "Either workflowId or executionId must be provided",
      path: ["workflowId", "executionId"],
    },
  );

// Type definitions inferred from schemas
export type LogsQueryInput = z.infer<typeof logsQuerySchema>;
export type AdminLogsQueryInput = z.infer<typeof adminLogsQuerySchema>;
export type CreateLogInput = z.infer<typeof createLogSchema>;
export type UpdateLogInput = z.infer<typeof updateLogSchema>;
export type BulkLogOperationInput = z.infer<typeof bulkLogOperationSchema>;
export type LogExportInput = z.infer<typeof logExportSchema>;
export type LogStatsInput = z.infer<typeof logStatsSchema>;
export type LogStreamInput = z.infer<typeof logStreamSchema>;
export type LogSearchInput = z.infer<typeof logSearchSchema>;
export type WorkflowLogsInput = z.infer<typeof workflowLogsSchema>;
