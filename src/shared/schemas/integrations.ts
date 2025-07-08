import { z } from "zod";

// Base message sending schema
export const baseSendMessageSchema = z.object({
  toolId: z.number().int().positive("Tool ID must be a positive integer"),
  message: z.string().min(1, "Message content is required"),
  templateId: z.number().int().positive().optional(),
  variables: z.record(z.string()).optional(), // For template variable substitution
});

// Slack-specific message schema
export const slackSendSchema = baseSendMessageSchema.extend({
  channel: z.string().optional(), // Override default channel
  username: z.string().optional(), // Override default username
  iconEmoji: z.string().optional(), // Override default emoji
  iconUrl: z.string().url().optional(), // Override default icon URL
  threadTs: z.string().optional(), // For replying to threads
  unfurlLinks: z.boolean().default(true),
  unfurlMedia: z.boolean().default(true),
  blocks: z.array(z.any()).optional(), // Slack Block Kit blocks
  attachments: z.array(z.any()).optional(), // Legacy attachments
});

// Discord-specific message schema
export const discordSendSchema = baseSendMessageSchema.extend({
  username: z.string().optional(), // Override webhook username
  avatarUrl: z.string().url().optional(), // Override webhook avatar
  tts: z.boolean().default(false), // Text-to-speech
  embeds: z
    .array(
      z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        url: z.string().url().optional(),
        timestamp: z.string().datetime().optional(),
        color: z.number().int().min(0).max(16777215).optional(), // 0x000000 to 0xFFFFFF
        footer: z
          .object({
            text: z.string(),
            iconUrl: z.string().url().optional(),
          })
          .optional(),
        image: z
          .object({
            url: z.string().url(),
          })
          .optional(),
        thumbnail: z
          .object({
            url: z.string().url(),
          })
          .optional(),
        author: z
          .object({
            name: z.string(),
            url: z.string().url().optional(),
            iconUrl: z.string().url().optional(),
          })
          .optional(),
        fields: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              inline: z.boolean().default(false),
            }),
          )
          .optional(),
      }),
    )
    .max(10)
    .optional(), // Discord allows max 10 embeds
  components: z.array(z.any()).optional(), // Discord components (buttons, etc.)
});

// Email-specific message schema
export const emailSendSchema = baseSendMessageSchema.extend({
  recipients: z.string().min(1, "Recipients are required"), // Comma-separated emails
  subject: z.string().min(1, "Subject is required"),
  cc: z.string().optional(), // Comma-separated emails
  bcc: z.string().optional(), // Comma-separated emails
  replyTo: z.string().email().optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  isHtml: z.boolean().default(false),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        content: z.string(), // Base64 encoded content
        contentType: z.string().optional(),
        size: z.number().int().min(0).optional(),
      }),
    )
    .optional(),
  trackOpens: z.boolean().default(false),
  trackClicks: z.boolean().default(false),
});

// Webhook message schema (for custom webhooks)
export const webhookSendSchema = baseSendMessageSchema.extend({
  method: z.enum(["GET", "POST", "PUT", "PATCH"]).default("POST"),
  headers: z.record(z.string()).optional(),
  queryParams: z.record(z.string()).optional(),
  payload: z.record(z.any()).optional(), // Custom payload structure
  contentType: z
    .enum([
      "application/json",
      "application/x-www-form-urlencoded",
      "text/plain",
    ])
    .default("application/json"),
  timeout: z.number().int().min(1).max(300).default(30),
});

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
  type: z.enum(["EMAIL", "SLACK", "DISCORD", "WEBHOOK", "HTTP"]).optional(),
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
  type: z.enum(["EMAIL", "SLACK", "DISCORD", "WEBHOOK", "HTTP"]).optional(),
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
export type SlackSendInput = z.infer<typeof slackSendSchema>;
export type DiscordSendInput = z.infer<typeof discordSendSchema>;
export type EmailSendInput = z.infer<typeof emailSendSchema>;
export type WebhookSendInput = z.infer<typeof webhookSendSchema>;
export type HttpRequestInput = z.infer<typeof httpRequestSchema>;
export type BulkSendInput = z.infer<typeof bulkSendSchema>;
export type TemplateQueryInput = z.infer<typeof templateQuerySchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type MessageHistoryInput = z.infer<typeof messageHistorySchema>;
export type MessageStatsInput = z.infer<typeof messageStatsSchema>;
export type TestMessageInput = z.infer<typeof testMessageSchema>;
export type DeliveryOptionsInput = z.infer<typeof deliveryOptionsSchema>;
