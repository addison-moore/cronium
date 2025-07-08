import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for Adaptive Card elements
const adaptiveCardSchema = z.object({
  type: z.literal("AdaptiveCard"),
  $schema: z
    .string()
    .optional()
    .default("http://adaptivecards.io/schemas/adaptive-card.json"),
  version: z.string().optional().default("1.4"),
  body: z.array(
    z.union([
      // TextBlock
      z.object({
        type: z.literal("TextBlock"),
        text: z.string(),
        size: z
          .enum(["small", "default", "medium", "large", "extraLarge"])
          .optional(),
        weight: z.enum(["lighter", "default", "bolder"]).optional(),
        color: z
          .enum([
            "default",
            "dark",
            "light",
            "accent",
            "good",
            "warning",
            "attention",
          ])
          .optional(),
        wrap: z.boolean().optional(),
      }),
      // Image
      z.object({
        type: z.literal("Image"),
        url: z.string().url(),
        altText: z.string().optional(),
        size: z
          .enum(["auto", "stretch", "small", "medium", "large"])
          .optional(),
      }),
      // Container
      z.object({
        type: z.literal("Container"),
        items: z.array(z.any()).optional(),
        style: z
          .enum(["default", "emphasis", "good", "attention", "warning"])
          .optional(),
      }),
      // ColumnSet
      z.object({
        type: z.literal("ColumnSet"),
        columns: z.array(
          z.object({
            type: z.literal("Column"),
            width: z.union([z.string(), z.number()]).optional(),
            items: z.array(z.any()).optional(),
          }),
        ),
      }),
      // FactSet
      z.object({
        type: z.literal("FactSet"),
        facts: z.array(
          z.object({
            title: z.string(),
            value: z.string(),
          }),
        ),
      }),
    ]),
  ),
  actions: z
    .array(
      z.union([
        // OpenUrl action
        z.object({
          type: z.literal("Action.OpenUrl"),
          title: z.string(),
          url: z.string().url(),
        }),
        // Submit action
        z.object({
          type: z.literal("Action.Submit"),
          title: z.string(),
          data: z.record(z.any()).optional(),
        }),
        // ShowCard action
        z.object({
          type: z.literal("Action.ShowCard"),
          title: z.string(),
          card: z.any(),
        }),
      ]),
    )
    .optional(),
});

// Schema for send-card action parameters
export const sendCardSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .describe("The Microsoft Teams webhook URL for the channel"),
  card: adaptiveCardSchema.describe("The Adaptive Card to send"),
  fallbackText: z
    .string()
    .optional()
    .describe("Fallback text for clients that don't support Adaptive Cards"),
});

export type SendCardParams = z.infer<typeof sendCardSchema>;

export const sendCardAction: ToolAction = {
  id: "send-card",
  name: "Send Adaptive Card",
  description:
    "Send an Adaptive Card to a Microsoft Teams channel using a webhook",
  category: "Messaging",
  actionType: "notification",
  developmentMode: "visual",
  inputSchema: sendCardSchema,
  parameters: zodToParameters(sendCardSchema),
  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Simple Card",
      description: "Send a basic Adaptive Card",
      input: {
        webhookUrl: "https://outlook.office.com/webhook/YOUR_WEBHOOK_URL",
        card: {
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: "Hello from Adaptive Cards!",
              size: "large",
              weight: "bolder",
            },
            {
              type: "TextBlock",
              text: "This is a simple adaptive card with some text.",
              wrap: true,
            },
          ],
        },
      },
      output: {
        success: true,
      },
    },
    {
      name: "Card with Facts",
      description: "Send a card with a fact set",
      input: {
        webhookUrl: "https://outlook.office.com/webhook/YOUR_WEBHOOK_URL",
        card: {
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: "Server Status Report",
              size: "large",
              weight: "bolder",
            },
            {
              type: "FactSet",
              facts: [
                { title: "CPU Usage", value: "45%" },
                { title: "Memory", value: "8.2 GB / 16 GB" },
                { title: "Disk Space", value: "120 GB free" },
                { title: "Uptime", value: "14 days" },
              ],
            },
          ],
          actions: [
            {
              type: "Action.OpenUrl",
              title: "View Dashboard",
              url: "https://example.com/dashboard",
            },
          ],
        },
      },
      output: {
        success: true,
      },
    },
    {
      name: "Card with Columns",
      description: "Send a card with column layout",
      input: {
        webhookUrl: "https://outlook.office.com/webhook/YOUR_WEBHOOK_URL",
        card: {
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: "User Profile",
              size: "large",
              weight: "bolder",
            },
            {
              type: "ColumnSet",
              columns: [
                {
                  type: "Column",
                  width: "auto",
                  items: [
                    {
                      type: "Image",
                      url: "https://example.com/avatar.png",
                      size: "medium",
                    },
                  ],
                },
                {
                  type: "Column",
                  width: "stretch",
                  items: [
                    {
                      type: "TextBlock",
                      text: "John Doe",
                      weight: "bolder",
                    },
                    {
                      type: "TextBlock",
                      text: "Software Engineer",
                      color: "accent",
                    },
                    {
                      type: "TextBlock",
                      text: "john.doe@example.com",
                      color: "light",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      output: {
        success: true,
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as SendCardParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing Adaptive Card...", percentage: 10 });
      }

      // Replace variables in webhook URL
      const webhookUrl = replaceVariables(typedParams.webhookUrl, variables);

      // Process card body to replace variables
      const processedCard = JSON.parse(
        replaceVariables(JSON.stringify(typedParams.card), variables),
      ) as typeof typedParams.card;

      // Build the Teams message payload
      const payload: Record<string, unknown> = {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            contentUrl: null,
            content: processedCard,
          },
        ],
      };

      if (typedParams.fallbackText) {
        payload.text = replaceVariables(typedParams.fallbackText, variables);
      }

      logger.info("Sending Teams Adaptive Card", { webhookUrl });

      if (isTest) {
        // Test mode - simulate sending
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating send...",
            percentage: 50,
          });
        }

        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return { success: true };
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Sending to Teams webhook...", percentage: 50 });
      }

      // Send card via webhook
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 80 });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Teams webhook error: ${response.status} - ${errorText}`,
        );
      }

      // Teams webhooks return "1" on success
      const responseText = await response.text();
      if (responseText !== "1") {
        throw new Error(`Unexpected Teams response: ${responseText}`);
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Card sent successfully!", percentage: 100 });
      }

      logger.info("Teams Adaptive Card sent successfully");
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Teams send card error: ${errorMessage}`);
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
  variables: { get: (key: string) => unknown },
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = variables.get(key);
    if (value === null || value === undefined) return match;
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    // At this point, value is a primitive (string, number, boolean)
    return String(value);
  });
}
