import { z } from "zod";

// Base message sending schema
export const baseSendMessageSchema = z.object({
  toolId: z.number().int().positive("Tool ID must be a positive integer"),
  message: z.string().min(1, "Message content is required"),
  templateId: z.number().int().positive().optional(),
  variables: z.record(z.string()).optional(), // For template variable substitution
});

// Tool-specific message schemas have been moved to their respective plugin directories
// See src/tools/plugins/[tool-name]/schemas.ts

// HTTP request schema (for HTTP tools)
export const httpRequestSchema = z.object({
  toolId: z.number().int().positive("Tool ID must be a positive integer"),
  path: z.string().min(1, "Path is required"), // Path to append to base URL
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string()).optional(),
  queryParams: z.record(z.string()).optional(),
  body: z.record(z.any()).optional(),
  timeout: z.number().int().min(1).max(300).default(30),
});

// Bulk message sending schema
export const bulkSendSchema = z.object({
  messages: z
    .array(
      z.object({
        toolId: z.number().int().positive(),
        message: z.string().min(1),
        recipients: z.string().optional(), // For email
        subject: z.string().optional(), // For email
        channel: z.string().optional(), // For Slack/Discord
        templateId: z.number().int().positive().optional(),
        variables: z.record(z.string()).optional(),
      }),
    )
    .min(1, "At least one message is required")
    .max(100, "Cannot send more than 100 messages at once"),
  delayBetweenMessages: z.number().int().min(0).max(60).default(1), // Delay in seconds
  stopOnError: z.boolean().default(false),
});

// OLD TEMPLATE SCHEMAS - REMOVED
// These have been replaced by the tool action templates system

// Message history and tracking schemas
export const messageHistorySchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  toolId: z.number().int().positive().optional(),
  type: z.enum(["email", "slack", "discord", "webhook", "http"]).optional(),
  status: z
    .enum(["sent", "failed", "pending", "delivered", "bounced"])
    .optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  recipient: z.string().optional(), // Filter by recipient/channel
});

export const messageStatsSchema = z.object({
  period: z.enum(["day", "week", "month", "year"]).default("week"),
  toolId: z.number().int().positive().optional(),
  type: z.enum(["email", "slack", "discord", "webhook", "http"]).optional(),
  groupBy: z.enum(["tool", "type", "status", "day", "hour"]).default("type"),
});

// Test message schemas
export const testMessageSchema = z.object({
  toolId: z.number().int().positive("Tool ID must be a positive integer"),
  testType: z.enum(["connection", "send_test_message"]).default("connection"),
  message: z.string().optional(), // For send_test_message
  recipient: z.string().optional(), // For email test messages
});

// Rate limiting and delivery schemas
export const deliveryOptionsSchema = z.object({
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  retryAttempts: z.number().int().min(0).max(5).default(3),
  retryDelay: z.number().int().min(1).max(300).default(30), // seconds
  deliveryTime: z.string().datetime().optional(), // Schedule for later delivery
  rateLimitPerMinute: z.number().int().min(1).max(100).default(10),
});

// Type definitions inferred from schemas
export type HttpRequestInput = z.infer<typeof httpRequestSchema>;
export type BulkSendInput = z.infer<typeof bulkSendSchema>;
export type MessageHistoryInput = z.infer<typeof messageHistorySchema>;
export type MessageStatsInput = z.infer<typeof messageStatsSchema>;
export type TestMessageInput = z.infer<typeof testMessageSchema>;
export type DeliveryOptionsInput = z.infer<typeof deliveryOptionsSchema>;
