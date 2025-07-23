import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { zodToParameters } from "@/tools/utils/zod-to-parameters";

// Schema for send-message action parameters
export const sendMessageSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .describe("The Microsoft Teams webhook URL for the channel"),
  message: z
    .string()
    .min(1)
    .describe("The message text to send (supports markdown)"),
  title: z.string().optional().describe("Optional title for the message card"),
  color: z
    .string()
    .optional()
    .default("0078D4")
    .describe("Theme color in hex format (without #)"),
  sections: z
    .array(
      z.object({
        activityTitle: z.string().optional(),
        activitySubtitle: z.string().optional(),
        activityImage: z.string().url().optional(),
        facts: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
            }),
          )
          .optional(),
        text: z.string().optional(),
        images: z
          .array(
            z.object({
              image: z.string().url(),
              title: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional()
    .describe("Optional sections for more complex message cards"),
  potentialAction: z
    .array(
      z.object({
        "@type": z.enum(["OpenUri", "HttpPOST", "ActionCard"]),
        name: z.string(),
        targets: z
          .array(
            z.object({
              os: z.enum(["default", "iOS", "android", "windows"]).optional(),
              uri: z.string().url(),
            }),
          )
          .optional(),
        body: z.string().optional(),
        headers: z.record(z.string()).optional(),
      }),
    )
    .optional()
    .describe("Optional actions for the message card"),
});

export type SendMessageParams = z.infer<typeof sendMessageSchema>;

export const sendMessageAction: ToolAction = {
  id: "send-message",
  name: "Send Message",
  description: "Send a message to a Microsoft Teams channel using a webhook",
  category: "Messaging",
  actionType: "create",
  developmentMode: "visual",
  inputSchema: sendMessageSchema,
  parameters: zodToParameters(sendMessageSchema),
  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Simple Message",
      description: "Send a basic text message",
      input: {
        webhookUrl: "https://outlook.office.com/webhook/YOUR_WEBHOOK_URL",
        message: "Hello from Cronium! This is a test message.",
      },
      output: {
        success: true,
      },
    },
    {
      name: "Message Card with Title",
      description: "Send a formatted message card",
      input: {
        webhookUrl: "https://outlook.office.com/webhook/YOUR_WEBHOOK_URL",
        title: "System Notification",
        message: "Deployment completed successfully!",
        color: "00FF00",
      },
      output: {
        success: true,
      },
    },
    {
      name: "Complex Message Card",
      description: "Send a message with sections and facts",
      input: {
        webhookUrl: "https://outlook.office.com/webhook/YOUR_WEBHOOK_URL",
        title: "Build Status",
        message: "Build #123 completed",
        color: "0078D4",
        sections: [
          {
            activityTitle: "CI/CD Pipeline",
            activitySubtitle: "GitHub Actions",
            facts: [
              { name: "Status", value: "Success" },
              { name: "Duration", value: "3m 42s" },
              { name: "Commit", value: "abc123" },
            ],
            text: "All tests passed successfully.",
          },
        ],
        potentialAction: [
          {
            "@type": "OpenUri",
            name: "View Build",
            targets: [
              {
                os: "default",
                uri: "https://github.com/user/repo/actions/runs/123",
              },
            ],
          },
        ],
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
    const typedParams = params as SendMessageParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing message...", percentage: 10 });
      }

      // Replace variables in parameters
      const webhookUrl = replaceVariables(typedParams.webhookUrl, variables);
      const message = replaceVariables(typedParams.message, variables);
      const title = typedParams.title
        ? replaceVariables(typedParams.title, variables)
        : undefined;

      // Build message card payload
      const payload: Record<string, unknown> = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        themeColor: typedParams.color ?? "0078D4",
        summary: title ?? message.substring(0, 100),
        sections: [],
      };

      if (title) {
        payload.title = title;
      }

      // Add main message as first section
      const sections = payload.sections as Array<Record<string, unknown>>;
      sections.push({
        text: message,
      });

      // Add additional sections if provided
      if (typedParams.sections) {
        for (const section of typedParams.sections) {
          const processedSection: Record<string, unknown> = {};
          if (section.activityTitle) {
            processedSection.activityTitle = replaceVariables(
              section.activityTitle,
              variables,
            );
          }
          if (section.activitySubtitle) {
            processedSection.activitySubtitle = replaceVariables(
              section.activitySubtitle,
              variables,
            );
          }
          if (section.activityImage) {
            processedSection.activityImage = replaceVariables(
              section.activityImage,
              variables,
            );
          }
          if (section.text) {
            processedSection.text = replaceVariables(section.text, variables);
          }
          if (section.facts) {
            processedSection.facts = section.facts.map((fact) => ({
              name: replaceVariables(fact.name, variables),
              value: replaceVariables(fact.value, variables),
            }));
          }
          if (section.images) {
            processedSection.images = section.images.map((img) => ({
              image: replaceVariables(img.image, variables),
              title: img.title
                ? replaceVariables(img.title, variables)
                : undefined,
            }));
          }
          sections.push(processedSection);
        }
      }

      // Add actions if provided
      if (typedParams.potentialAction) {
        payload.potentialAction = typedParams.potentialAction;
      }

      logger.info(`Sending Teams message to webhook`);

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

      // Send message via webhook
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
        onProgress({ step: "Message sent successfully!", percentage: 100 });
      }

      logger.info("Teams message sent successfully");
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Teams send message error: ${errorMessage}`);
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
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(value);
  });
}
