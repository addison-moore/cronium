import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";

// Schema for the send-message action parameters - Simplified for MVP
export const sendMessageSchema = z.object({
  text: z.string().min(1).describe("The message text"),
  channel: z
    .string()
    .optional()
    .describe("Channel ID or name (e.g., #general, @username)"),
});

export type SendMessageParams = z.infer<typeof sendMessageSchema>;

export const sendMessageAction: ToolAction = {
  id: "slack-send-message",
  name: "Send Message",
  description: "Send a message to a Slack channel or direct message",
  category: "Communication",
  actionType: "create",
  developmentMode: "visual",
  isConditionalAction: true,
  inputSchema: sendMessageSchema,
  outputSchema: z.object({
    ok: z.boolean(),
    ts: z.string().optional().describe("Message timestamp"),
    channel: z.string().optional().describe("Channel where message was posted"),
    message: z.any().optional().describe("The sent message object"),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Simple Text Message",
      description: "Send a basic text message to Slack",
      input: {
        text: "Hello from Cronium! 👋",
      },
      output: {
        ok: true,
      },
    },
    {
      name: "Channel Message",
      description: "Send a message to a specific channel",
      input: {
        channel: "#general",
        text: "Team meeting in 10 minutes!",
      },
      output: {
        ok: true,
      },
    },
    {
      name: "Event Notification",
      description: "Send an event status notification",
      input: {
        channel: "#alerts",
        text: "Event '{{cronium.event.name}}' completed successfully",
      },
      output: {
        ok: true,
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
        onProgress({ step: "Preparing Slack message...", percentage: 10 });
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
      const payload: Record<string, unknown> = {
        text: replaceVariables(typedParams.text, variables),
      };

      // Add optional channel
      if (typedParams.channel) {
        payload.channel = typedParams.channel;
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Sending message to Slack...", percentage: 60 });
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

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 90 });
      }

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status} ${responseText}`);
      }

      // Slack webhooks return 'ok' as plain text for success
      if (responseText === "ok") {
        if (onProgress) {
          onProgress({ step: "Message sent successfully!", percentage: 100 });
        }
        return {
          ok: true,
          // Webhook responses don't include ts or channel info
          // These would be available with the Web API
        };
      } else {
        throw new Error(`Unexpected response: ${responseText}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Slack send error: ${errorMessage}`);
      if (onProgress) {
        onProgress({ step: `Failed: ${errorMessage}`, percentage: 100 });
      }
      return {
        ok: false,
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
