import { z } from "zod";

// Email credentials schema
export const emailCredentialsSchema = z.object({
  smtpHost: z.string().min(1, "SMTP host is required"),
  smtpPort: z
    .number()
    .int()
    .min(1)
    .max(65535, "Port must be between 1 and 65535"),
  smtpUser: z.string().min(1, "SMTP username is required"),
  smtpPassword: z.string().min(1, "SMTP password is required"),
  fromEmail: z.string().email("Must be a valid email address"),
  fromName: z.string().optional(),
  enableTLS: z.boolean().default(true),
  enableSSL: z.boolean().default(false),
});

// Email send action schema
export const emailSendSchema = z.object({
  toolId: z.number().int().positive("Tool ID must be a positive integer"),
  message: z.string().min(1, "Message content is required"),
  templateId: z.number().int().positive().optional(),
  variables: z.record(z.string()).optional(),
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

// Type definitions
export type EmailCredentials = z.infer<typeof emailCredentialsSchema>;
export type EmailSendInput = z.infer<typeof emailSendSchema>;
