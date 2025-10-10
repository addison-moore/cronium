import { z } from "zod";

// Discord credentials schema
export const discordCredentialsSchema = z.object({
  webhookUrl: z
    .string()
    .url("Must be a valid webhook URL")
    .refine(
      (url) => url.includes("discord.com/api/webhooks"),
      "Must be a valid Discord webhook URL",
    ),
  username: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

// Discord send action schema
export const discordSendSchema = z.object({
  toolId: z.number().int().positive("Tool ID must be a positive integer"),
  message: z.string().min(1, "Message content is required"),
  templateId: z.number().int().positive().optional(),
  variables: z.record(z.string(), z.string()).optional(),
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

// Type definitions
export type DiscordCredentials = z.infer<typeof discordCredentialsSchema>;
export type DiscordSendInput = z.infer<typeof discordSendSchema>;
