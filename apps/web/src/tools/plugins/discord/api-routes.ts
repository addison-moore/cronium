import { z } from "zod";
import { type PluginApiRoutes } from "../../types/tool-plugin";
import { discordSendSchema } from "./schemas";

// Response schemas
const testConnectionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z
    .object({
      guildName: z.string().optional(),
      channelName: z.string().optional(),
      webhookId: z.string().optional(),
    })
    .optional(),
});

const sendMessageResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  messageId: z.string().optional(),
  timestamp: z.string().optional(),
});

export const discordApiRoutes: PluginApiRoutes = {
  testConnection: {
    path: "testConnection",
    method: "mutation",
    description: "Test the Discord webhook connection",
    handler: {
      input: z.object({
        toolId: z.number().int().positive(),
      }),
      output: testConnectionResponseSchema,
      handler: async ({ ctx }) => {
        try {
          const webhookUrl = ctx.tool.credentials.webhookUrl as string;
          if (!webhookUrl) {
            throw new Error("Webhook URL not found in credentials");
          }

          // Parse webhook URL to extract webhook ID
          const urlMatch = /webhooks\/(\d+)\//.exec(webhookUrl);
          const webhookId = urlMatch ? urlMatch[1] : undefined;

          // Test with a minimal payload
          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content: "🔗 Cronium connection test",
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Discord API error: ${response.status} ${errorText}`,
            );
          }

          return {
            success: true,
            message: "Successfully connected to Discord",
            details: {
              webhookId,
            },
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Connection failed",
          };
        }
      },
    },
    requiresAuth: true,
    requiresActiveStatus: true,
  },

  send: {
    path: "send",
    method: "mutation",
    description: "Send a message to Discord",
    handler: {
      input: discordSendSchema,
      output: sendMessageResponseSchema,
      handler: async ({ input, ctx }) => {
        const typedInput = input as z.infer<typeof discordSendSchema>;
        try {
          const webhookUrl = ctx.tool.credentials.webhookUrl as string;
          if (!webhookUrl) {
            throw new Error("Webhook URL not found in credentials");
          }

          // Build the payload
          const payload: Record<string, unknown> = {
            content: typedInput.message,
          };

          // Add optional fields
          if (typedInput.username || ctx.tool.credentials.username) {
            payload.username =
              typedInput.username ?? ctx.tool.credentials.username;
          }
          if (typedInput.avatarUrl || ctx.tool.credentials.avatarUrl) {
            payload.avatar_url =
              typedInput.avatarUrl ?? ctx.tool.credentials.avatarUrl;
          }
          if (typedInput.tts) {
            payload.tts = typedInput.tts;
          }
          if (typedInput.embeds) {
            payload.embeds = typedInput.embeds;
          }

          // Send the request to Discord
          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Discord API error: ${response.status} ${errorText}`,
            );
          }

          // Discord webhooks return 204 No Content on success
          return {
            success: true,
            message: "Message sent successfully",
            messageId: `${Date.now()}`,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          return {
            success: false,
            message:
              error instanceof Error ? error.message : "Failed to send message",
          };
        }
      },
    },
    requiresAuth: true,
    requiresActiveStatus: true,
  },

  validateCredentials: {
    path: "validateCredentials",
    method: "query",
    description: "Validate Discord credentials format",
    handler: {
      input: z.object({
        credentials: z.record(z.unknown()),
      }),
      output: z.object({
        valid: z.boolean(),
        errors: z.array(z.string()).optional(),
      }),
      handler: async ({ input }) => {
        const typedInput = input as { credentials: Record<string, unknown> };
        const { discordCredentialsSchema } = await import("./schemas");
        const result = discordCredentialsSchema.safeParse(
          typedInput.credentials,
        );

        if (result.success) {
          return { valid: true };
        }

        return {
          valid: false,
          errors: result.error.errors.map(
            (err) => `${err.path.join(".")}: ${err.message}`,
          ),
        };
      },
    },
    requiresAuth: true,
  },
};
