import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";

// Schema for Discord message action parameters - Simplified for MVP
export const sendMessageSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(2000)
    .describe("The message content (up to 2000 characters)"),
});

export type SendMessageParams = z.infer<typeof sendMessageSchema>;

export const sendMessageAction: ToolAction = {
  id: "discord-send-message",
  name: "Send Message",
  description: "Send a message to a Discord channel via webhook",
  category: "Communication",
  actionType: "create",
  developmentMode: "visual",
  isConditionalAction: true,
  inputSchema: sendMessageSchema,
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
      name: "Event Notification",
      description: "Send an event status notification",
      input: {
        content:
          "Event '{{cronium.event.name}}' completed successfully in {{cronium.event.duration}}ms",
      },
      output: {
        success: true,
        message_id: "1234567890123456789",
      },
    },
    {
      name: "Alert Message",
      description: "Send an alert or warning",
      input: {
        content: "⚠️ Warning: Server CPU usage is above 90%",
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

      // Build the payload - Simplified for MVP
      const payload = {
        content: replaceVariables(typedParams.content, variables),
      };

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
