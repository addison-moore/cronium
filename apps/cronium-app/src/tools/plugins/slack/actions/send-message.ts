import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";

// Schema for the send-message action parameters - Enhanced to support blocks
export const sendMessageSchema = z
  .object({
    channel: z
      .string()
      .optional()
      .describe("Channel ID or name (e.g., #general, @username)"),
    text: z
      .string()
      .optional()
      .describe("Fallback text for notifications (required if using blocks)"),
    blocks: z
      .string()
      .optional()
      .describe("Rich message content using Slack Block Kit (JSON format)"),
  })
  .refine((data) => data.text ?? data.blocks, {
    message: "Either text or blocks must be provided",
  });

export type SendMessageParams = z.infer<typeof sendMessageSchema>;

export const sendMessageAction: ToolAction = {
  id: "slack-send-message",
  name: "Send Message",
  description: "Send a message to a Slack channel or direct message",
  category: "Communication",
  actionType: "create",
  actionTypeColor: "bg-green-500 text-white",
  developmentMode: "visual",
  isSendMessageAction: true,
  conditionalActionConfig: {
    parameterMapping: {
      recipients: "channel",
      message: "text",
    },
    displayConfig: {
      recipientLabel: "Channel or User",
      messageLabel: "Message Text",
      showSubject: false,
    },
    validate: (params) => {
      const errors: string[] = [];

      if (!params.text || typeof params.text !== "string") {
        errors.push("Message text is required");
      }

      // Channel is optional for Slack webhooks
      if (params.channel && typeof params.channel === "string") {
        // Basic validation for channel format
        if (
          !/^[#@].+/.exec(params.channel) &&
          !/^[CG][A-Z0-9]+$/.exec(params.channel)
        ) {
          errors.push(
            "Channel should start with # or @ or be a valid channel ID",
          );
        }
      }

      return { isValid: errors.length === 0, errors };
    },
  },
  inputSchema: sendMessageSchema,
  parameters: safeZodToParameters(sendMessageSchema),
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
      name: "Rich Block Message",
      description: "Send a rich message using Slack Block Kit",
      input: {
        channel: "#alerts",
        text: "Event notification",
        blocks: JSON.stringify({
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "{{cronium.event.name}} - {{cronium.event.status}}",
              },
            },
            {
              type: "section",
              fields: [
                {
                  type: "mrkdwn",
                  text: "*Status:* {{cronium.event.status}}",
                },
                {
                  type: "mrkdwn",
                  text: "*Duration:* {{formatDuration cronium.event.duration}}",
                },
              ],
            },
          ],
        }),
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

      // Build the payload
      const payload: Record<string, unknown> = {};

      // Add channel if specified
      if (typedParams.channel) {
        payload.channel = typedParams.channel;
      }

      // Handle blocks or text
      if (typedParams.blocks) {
        try {
          // Parse and process blocks JSON
          const blocksJson = replaceVariables(typedParams.blocks, variables);
          const parsedBlocks = JSON.parse(blocksJson) as { blocks?: unknown[] };

          if (parsedBlocks.blocks && Array.isArray(parsedBlocks.blocks)) {
            payload.blocks = parsedBlocks.blocks;
          } else if (Array.isArray(parsedBlocks)) {
            payload.blocks = parsedBlocks;
          } else {
            throw new Error(
              "Invalid blocks format. Expected an array or object with 'blocks' property.",
            );
          }

          // Add fallback text if provided
          if (typedParams.text) {
            payload.text = replaceVariables(typedParams.text, variables);
          }
        } catch (error) {
          throw new Error(
            `Failed to parse blocks JSON: ${error instanceof Error ? error.message : "Invalid JSON"}`,
          );
        }
      } else if (typedParams.text) {
        payload.text = replaceVariables(typedParams.text, variables);
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
