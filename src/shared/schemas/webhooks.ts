import { z } from "zod";
import { WorkflowTriggerType, EventStatus } from "../schema";

// Webhook execution schema (for triggering workflows)
export const executeWebhookSchema = z.object({
  key: z.string().min(1, "Webhook key is required"),
  payload: z.record(z.any()).optional(),
  headers: z.record(z.string()).optional(),
  query: z.record(z.string()).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH"]).default("POST"),
  userAgent: z.string().optional(),
  sourceIp: z.string().optional(),
});

// Webhook configuration query schema
export const webhookQuerySchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
  status: z.nativeEnum(EventStatus).optional(),
  workflowId: z.number().int().positive().optional(),
  includeInactive: z.boolean().default(false),
  sortBy: z.enum(["name", "createdAt", "lastTriggered", "triggerCount"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

// Webhook creation schema (for workflows)
export const createWebhookSchema = z.object({
  workflowId: z.number().int().positive("Workflow ID must be a positive integer"),
  key: z.string()
    .min(8, "Webhook key must be at least 8 characters")
    .max(64, "Webhook key must be less than 64 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Webhook key can only contain letters, numbers, underscores, and hyphens")
    .optional(), // If not provided, will be auto-generated
  description: z.string().max(500, "Description must be less than 500 characters").optional(),
  isActive: z.boolean().default(true),
  allowedMethods: z.array(z.enum(["GET", "POST", "PUT", "PATCH"])).default(["POST"]),
  allowedIps: z.array(z.string()).optional(), // IP whitelist
  rateLimitPerMinute: z.number().int().min(1).max(1000).default(60),
  requireAuth: z.boolean().default(false),
  authToken: z.string().optional(), // Bearer token for authentication
  customHeaders: z.record(z.string()).optional(), // Required headers
  responseFormat: z.enum(["json", "text", "xml"]).default("json"),
});

// Webhook update schema
export const updateWebhookSchema = z.object({
  key: z.string().min(1, "Webhook key is required"),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
  allowedMethods: z.array(z.enum(["GET", "POST", "PUT", "PATCH"])).optional(),
  allowedIps: z.array(z.string()).optional(),
  rateLimitPerMinute: z.number().int().min(1).max(1000).optional(),
  requireAuth: z.boolean().optional(),
  authToken: z.string().optional(),
  customHeaders: z.record(z.string()).optional(),
  responseFormat: z.enum(["json", "text", "xml"]).optional(),
});

// Webhook key parameter schema
export const webhookKeySchema = z.object({
  key: z.string().min(1, "Webhook key is required"),
});

// Webhook test schema
export const testWebhookSchema = z.object({
  key: z.string().min(1, "Webhook key is required"),
  payload: z.record(z.any()).optional(),
  headers: z.record(z.string()).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH"]).default("POST"),
});

// Webhook execution history schema
export const webhookExecutionHistorySchema = z.object({
  key: z.string().min(1, "Webhook key is required").optional(),
  workflowId: z.number().int().positive().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  status: z.enum(["success", "failure", "timeout", "rate_limited", "unauthorized"]).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  sourceIp: z.string().optional(),
  sortBy: z.enum(["timestamp", "duration", "status"]).default("timestamp"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// Webhook statistics schema
export const webhookStatsSchema = z.object({
  key: z.string().min(1, "Webhook key is required").optional(),
  workflowId: z.number().int().positive().optional(),
  period: z.enum(["hour", "day", "week", "month", "year"]).default("day"),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  groupBy: z.enum(["status", "source_ip", "method", "hour", "day"]).default("status"),
});

// Bulk webhook operations schema
export const bulkWebhookOperationSchema = z.object({
  keys: z.array(z.string()).min(1, "At least one webhook key must be selected"),
  operation: z.enum(["activate", "deactivate", "delete", "regenerate_key", "reset_stats"]),
});

// Webhook security settings schema
export const webhookSecuritySchema = z.object({
  key: z.string().min(1, "Webhook key is required"),
  enableIpWhitelist: z.boolean().default(false),
  allowedIps: z.array(z.string()).optional(),
  enableRateLimit: z.boolean().default(true),
  rateLimitPerMinute: z.number().int().min(1).max(1000).default(60),
  enableAuth: z.boolean().default(false),
  authType: z.enum(["bearer", "basic", "custom_header"]).default("bearer"),
  authToken: z.string().optional(),
  customAuthHeader: z.string().optional(),
  enableSignatureVerification: z.boolean().default(false),
  signatureSecret: z.string().optional(),
  signatureHeader: z.string().default("X-Webhook-Signature"),
});

// Webhook URL generation schema
export const generateWebhookUrlSchema = z.object({
  workflowId: z.number().int().positive("Workflow ID must be a positive integer"),
  customKey: z.string()
    .min(8)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  includeAuth: z.boolean().default(false),
  includeQuery: z.record(z.string()).optional(),
});

// Webhook monitoring schema
export const webhookMonitoringSchema = z.object({
  key: z.string().min(1, "Webhook key is required").optional(),
  includeRealtime: z.boolean().default(false),
  metricsWindow: z.enum(["1h", "6h", "24h", "7d", "30d"]).default("24h"),
  alertThresholds: z.object({
    errorRate: z.number().min(0).max(100).default(10), // Percentage
    rateLimitHits: z.number().int().min(0).default(100),
    avgResponseTime: z.number().min(0).default(5000), // Milliseconds
  }).optional(),
});

// Webhook payload validation schema
export const webhookPayloadValidationSchema = z.object({
  key: z.string().min(1, "Webhook key is required"),
  payloadSchema: z.record(z.any()).optional(), // JSON Schema for payload validation
  requireContentType: z.string().optional(), // Required Content-Type header
  maxPayloadSize: z.number().int().min(1).max(10485760).default(1048576), // Max 10MB, default 1MB
  validateSignature: z.boolean().default(false),
  allowedFields: z.array(z.string()).optional(), // Whitelist of allowed payload fields
  requiredFields: z.array(z.string()).optional(), // Required payload fields
});

// Webhook response customization schema
export const webhookResponseSchema = z.object({
  key: z.string().min(1, "Webhook key is required"),
  responseFormat: z.enum(["json", "text", "xml"]).default("json"),
  successResponse: z.object({
    statusCode: z.number().int().min(200).max(299).default(200),
    body: z.record(z.any()).optional(),
    headers: z.record(z.string()).optional(),
  }).optional(),
  errorResponse: z.object({
    statusCode: z.number().int().min(400).max(599).default(400),
    body: z.record(z.any()).optional(),
    headers: z.record(z.string()).optional(),
  }).optional(),
  includeExecutionId: z.boolean().default(true),
  includeTimestamp: z.boolean().default(true),
});

// Type definitions inferred from schemas
export type ExecuteWebhookInput = z.infer<typeof executeWebhookSchema>;
export type WebhookQueryInput = z.infer<typeof webhookQuerySchema>;
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
export type TestWebhookInput = z.infer<typeof testWebhookSchema>;
export type WebhookExecutionHistoryInput = z.infer<typeof webhookExecutionHistorySchema>;
export type WebhookStatsInput = z.infer<typeof webhookStatsSchema>;
export type BulkWebhookOperationInput = z.infer<typeof bulkWebhookOperationSchema>;
export type WebhookSecurityInput = z.infer<typeof webhookSecuritySchema>;
export type GenerateWebhookUrlInput = z.infer<typeof generateWebhookUrlSchema>;
export type WebhookMonitoringInput = z.infer<typeof webhookMonitoringSchema>;
export type WebhookPayloadValidationInput = z.infer<typeof webhookPayloadValidationSchema>;
export type WebhookResponseInput = z.infer<typeof webhookResponseSchema>;