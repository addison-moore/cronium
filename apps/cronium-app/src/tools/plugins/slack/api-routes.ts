import { z } from "zod";
import { type PluginApiRoutes } from "../../types/tool-plugin";
import { slackSendSchema } from "./schemas";

// Response schemas
const testConnectionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z
    .object({
      teamName: z.string().optional(),
      channelId: z.string().optional(),
      channelName: z.string().optional(),
    })
    .optional(),
});

const sendMessageResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  messageTs: z.string().optional(),
  channel: z.string().optional(),
});

const listChannelsResponseSchema = z.object({
  success: z.boolean(),
  channels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      is_private: z.boolean(),
      is_channel: z.boolean(),
      is_group: z.boolean(),
      is_im: z.boolean(),
    }),
  ),
});

export const slackApiRoutes: PluginApiRoutes = {
  testConnection: {
    path: "testConnection",
    method: "mutation",
    description: "Test the Slack webhook connection",
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

          // Test with a minimal payload
          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: "🔗 Cronium connection test",
            }),
          });

          const responseText = await response.text();

          if (!response.ok) {
            throw new Error(
              `Slack API error: ${response.status} ${responseText}`,
            );
          }

          if (responseText === "ok") {
            return {
              success: true,
              message: "Successfully connected to Slack",
              details: {
                channelName:
                  (ctx.tool.credentials.channel as string) ?? "default channel",
              },
            };
          } else {
            throw new Error(`Unexpected response: ${responseText}`);
          }
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
    description: "Send a message to Slack",
    handler: {
      input: slackSendSchema,
      output: sendMessageResponseSchema,
      handler: async ({ input, ctx }) => {
        try {
          const webhookUrl = ctx.tool.credentials.webhookUrl as string;
          if (!webhookUrl) {
            throw new Error("Webhook URL not found in credentials");
          }

          // Type assertion for input
          const typedInput = input as z.infer<typeof slackSendSchema>;

          // Build the payload
          const payload: Record<string, unknown> = {
            text: typedInput.message,
          };

          // Add optional fields
          if (typedInput.channel ?? ctx.tool.credentials.channel) {
            payload.channel =
              typedInput.channel ?? ctx.tool.credentials.channel;
          }
          if (typedInput.username ?? ctx.tool.credentials.username) {
            payload.username =
              typedInput.username ?? ctx.tool.credentials.username;
          }
          if (typedInput.iconEmoji) {
            payload.icon_emoji = typedInput.iconEmoji;
          }
          if (typedInput.iconUrl) {
            payload.icon_url = typedInput.iconUrl;
          }

          // Send the request to Slack
          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          const responseText = await response.text();

          if (!response.ok) {
            throw new Error(
              `Slack API error: ${response.status} ${responseText}`,
            );
          }

          // Slack webhooks return 'ok' as plain text for success
          if (responseText === "ok") {
            return {
              success: true,
              message: "Message sent successfully",
              messageTs: Date.now().toString(),
              channel: payload.channel as string,
            };
          } else {
            throw new Error(`Unexpected response: ${responseText}`);
          }
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

  listChannels: {
    path: "listChannels",
    method: "query",
    description: "List available Slack channels",
    handler: {
      input: z.object({
        toolId: z.number().int().positive(),
      }),
      output: listChannelsResponseSchema,
      handler: async () => {
        // Mock implementation for now
        // TODO: Implement actual Slack channel listing
        try {
          // Simulate channel listing
          await new Promise((resolve) => setTimeout(resolve, 300));

          return {
            success: true,
            channels: [
              {
                id: "C123456789",
                name: "general",
                is_private: false,
                is_channel: true,
                is_group: false,
                is_im: false,
              },
              {
                id: "C987654321",
                name: "random",
                is_private: false,
                is_channel: true,
                is_group: false,
                is_im: false,
              },
              {
                id: "C456789123",
                name: "dev-team",
                is_private: true,
                is_channel: true,
                is_group: false,
                is_im: false,
              },
            ],
          };
        } catch {
          return {
            success: false,
            channels: [],
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
    description: "Validate Slack credentials format",
    handler: {
      input: z.object({
        credentials: z.record(z.unknown()),
      }),
      output: z.object({
        valid: z.boolean(),
        errors: z.array(z.string()).optional(),
      }),
      handler: async ({ input }) => {
        const { slackCredentialsSchema } = await import("./schemas");
        const result = slackCredentialsSchema.safeParse(
          (input as { credentials: Record<string, unknown> }).credentials,
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
