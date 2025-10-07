import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";

// Schema for Discord message action parameters - Enhanced to support embeds
export const sendMessageSchema = z
  .object({
    content: z
      .string()
      .max(2000)
      .optional()
      .describe("The message content (up to 2000 characters)"),
    embeds: z
      .string()
      .optional()
      .describe("Rich embeds for the message (JSON format)"),
    username: z
      .string()
      .optional()
      .describe("Override the default webhook username"),
    avatar_url: z
      .string()
      .url()
      .optional()
      .describe("Override the default webhook avatar"),
  })
  .refine((data) => data.content ?? data.embeds, {
    message: "Either content or embeds must be provided",
  });

export type SendMessageParams = z.infer<typeof sendMessageSchema>;

export const sendMessageAction: ToolAction = {
  id: "discord-send-message",
  name: "Send Message",
  description: "Send a message to a Discord channel via webhook",
  category: "Communication",
  actionType: "create",
  developmentMode: "visual",
  isSendMessageAction: true,
  conditionalActionConfig: {
    parameterMapping: {
      message: "content",
    },
    displayConfig: {
      recipientLabel: "Webhook URL",
      messageLabel: "Message Content",
      showSubject: false,
    },
    validate: (params) => {
      const errors: string[] = [];

      if (!params.content || typeof params.content !== "string") {
        errors.push("Message content is required");
      } else if (params.content.length > 2000) {
        errors.push("Message content must be 2000 characters or less");
      }

      return { isValid: errors.length === 0, errors };
    },
  },
  inputSchema: sendMessageSchema,
  parameters: safeZodToParameters(sendMessageSchema),
  outputSchema: z.object({
    success: z.boolean(),
    message_id: z.string().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Simple Message",
      description: "Send a basic text message",
      input: {
        content: "Hello from Cronium! 👋",
      },
      output: {
        success: true,
        message_id: "1234567890123456789",
      },
    },
    {
      name: "Rich Embed Message",
      description: "Send a rich embed with event details",
      input: {
        embeds: JSON.stringify([
          {
            title: "{{cronium.event.name}}",
            description: "Event execution completed",
            color:
              "{{#ifEquals cronium.event.status 'success'}}3066993{{else}}15158332{{/ifEquals}}",
            fields: [
              {
                name: "Status",
                value: "{{cronium.event.status}}",
                inline: true,
              },
              {
                name: "Duration",
                value: "{{formatDuration cronium.event.duration}}",
                inline: true,
              },
              {
                name: "Server",
                value: "{{cronium.event.server}}",
                inline: true,
              },
            ],
            timestamp: new Date().toISOString(),
          },
        ]),
      },
      output: {
        success: true,
        message_id: "1234567890123456789",
      },
    },
    {
      name: "Alert Message",
      description: "Send an alert with custom webhook appearance",
      input: {
        content: "⚠️ Warning: Server CPU usage is above 90%",
        username: "Cronium Alerts",
        avatar_url: "https://example.com/alert-icon.png",
      },
      output: {
        success: true,
        message_id: "1234567890123456789",
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as SendMessageParams;
    const { variables, logger, onProgress } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing Discord message...", percentage: 10 });
      }

      // Get webhook URL from credentials
      const webhookUrl = (credentials as { webhookUrl?: string }).webhookUrl;
      if (!webhookUrl) {
        throw new Error("Webhook URL not found in credentials");
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Building message payload...", percentage: 30 });
      }

      // Build the payload
      const payload: Record<string, unknown> = {};

      // Add content if provided
      if (typedParams.content) {
        payload.content = replaceVariables(typedParams.content, variables);
      }

      // Handle embeds
      if (typedParams.embeds) {
        try {
          const embedsJson = replaceVariables(typedParams.embeds, variables);
          const parsedEmbeds = JSON.parse(embedsJson) as unknown;

          if (Array.isArray(parsedEmbeds)) {
            payload.embeds = parsedEmbeds;
          } else if (
            typeof parsedEmbeds === "object" &&
            parsedEmbeds !== null &&
            "embeds" in parsedEmbeds
          ) {
            payload.embeds = (parsedEmbeds as { embeds: unknown[] }).embeds;
          } else {
            throw new Error(
              "Invalid embeds format. Expected an array or object with 'embeds' property.",
            );
          }
        } catch (error) {
          throw new Error(
            `Failed to parse embeds JSON: ${error instanceof Error ? error.message : "Invalid JSON"}`,
          );
        }
      }

      // Add optional username and avatar
      if (typedParams.username) {
        payload.username = replaceVariables(typedParams.username, variables);
      }
      if (typedParams.avatar_url) {
        payload.avatar_url = typedParams.avatar_url;
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Sending message to Discord...", percentage: 60 });
      }

      // Send the request to Discord
      const response = await fetch(webhookUrl + "?wait=true", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseData = (await response.json()) as unknown;

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 90 });
      }

      if (!response.ok) {
        const errorMessage =
          (responseData as { message?: string }).message ??
          `Discord API error: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Success!
      if (onProgress) {
        onProgress({ step: "Message sent successfully!", percentage: 100 });
      }

      return {
        success: true,
        message_id: (responseData as { id?: string }).id,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Discord send error: ${errorMessage}`);
      if (onProgress) {
        onProgress({ step: `Failed: ${errorMessage}`, percentage: 100 });
      }
      return {
        success: false,
        error: errorMessage,
      };
    }
  },
};

// Helper function to replace variables in text
function replaceVariables(
  text: string,
  variables: { get: (key: string) => unknown }, // VariableManager from ExecutionContext
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = variables.get(key);
    if (value === null || value === undefined) return match;
    // Handle different types
    switch (typeof value) {
      case "object":
        return JSON.stringify(value);
      case "string":
        return value;
      case "number":
      case "boolean":
        return String(value);
      default:
        return match;
    }
  });
}
