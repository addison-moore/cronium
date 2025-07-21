import { z } from "zod";

// Slack credentials schema
export const slackCredentialsSchema = z.object({
  webhookUrl: z
    .string()
    .url("Must be a valid webhook URL")
    .refine(
      (url) => url.includes("hooks.slack.com"),
      "Must be a valid Slack webhook URL",
    ),
  channel: z.string().optional(),
  username: z.string().optional(),
  iconEmoji: z.string().optional(),
  iconUrl: z.string().url().optional(),
});

// Slack send action schema
export const slackSendSchema = z.object({
  toolId: z.number().int().positive("Tool ID must be a positive integer"),
  message: z.string().min(1, "Message content is required"),
  templateId: z.number().int().positive().optional(),
  variables: z.record(z.string()).optional(),
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

// Type definitions
export type SlackCredentials = z.infer<typeof slackCredentialsSchema>;
export type SlackSendInput = z.infer<typeof slackSendSchema>;
