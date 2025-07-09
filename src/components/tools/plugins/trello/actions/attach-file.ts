import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for attach-file action parameters
export const attachFileSchema = z.object({
  cardId: z.string().describe("The ID of the card"),
  url: z.string().url().describe("URL of the file to attach"),
  name: z.string().optional().describe("Name for the attachment"),
  setCover: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to set this as the card cover (for images)"),
});

export type AttachFileParams = z.infer<typeof attachFileSchema>;

export const attachFileAction: ToolAction = {
  id: "attach-file",
  name: "Attach File",
  description: "Attach a file or URL to a Trello card",
  category: "Task Management",
  actionType: "update",
  developmentMode: "visual",
  inputSchema: attachFileSchema,
  parameters: zodToParameters(attachFileSchema),
  outputSchema: z.object({
    success: z.boolean(),
    attachmentId: z.string().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Attach Document",
      description: "Attach a document URL to a card",
      input: {
        cardId: "card-123",
        url: "https://docs.google.com/document/d/abc123/edit",
        name: "Project Specification",
      },
      output: {
        success: true,
        attachmentId: "attachment-abc",
      },
    },
    {
      name: "Attach Image as Cover",
      description: "Attach an image and set it as card cover",
      input: {
        cardId: "card-456",
        url: "https://example.com/mockup.png",
        name: "UI Mockup",
        setCover: true,
      },
      output: {
        success: true,
        attachmentId: "attachment-def",
      },
    },
    {
      name: "Attach GitHub Link",
      description: "Attach a GitHub pull request",
      input: {
        cardId: "card-789",
        url: "https://github.com/user/repo/pull/123",
        name: "PR #123: Feature Implementation",
      },
      output: {
        success: true,
        attachmentId: "attachment-ghi",
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as AttachFileParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing attachment data...", percentage: 10 });
      }

      // Check for API credentials
      const apiKey = (credentials as { apiKey?: string }).apiKey;
      const apiToken = (credentials as { apiToken?: string }).apiToken;

      if (!apiKey || !apiToken) {
        throw new Error(
          "Trello API key and token required. Get them from https://trello.com/app-key",
        );
      }

      // Replace variables in parameters
      const cardId = replaceVariables(typedParams.cardId, variables);
      const url = replaceVariables(typedParams.url, variables);
      const name = typedParams.name
        ? replaceVariables(typedParams.name, variables)
        : undefined;

      logger.info(`Attaching file to Trello card ${cardId}: ${url}`);

      if (isTest) {
        // Test mode - simulate attachment
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating file attachment...",
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 800));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          attachmentId: "test-attachment-id",
        };
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Calling Trello API...", percentage: 30 });
      }

      // Build URL with query parameters
      const apiUrl = new URL(
        `https://api.trello.com/1/cards/${cardId}/attachments`,
      );
      apiUrl.searchParams.append("key", apiKey);
      apiUrl.searchParams.append("token", apiToken);
      apiUrl.searchParams.append("url", url);

      if (name) {
        apiUrl.searchParams.append("name", name);
      }

      if (typedParams.setCover) {
        apiUrl.searchParams.append("setCover", "true");
      }

      // Make API request
      const response = await fetch(apiUrl.toString(), {
        method: "POST",
      });

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 70 });
      }

      const data = (await response.json()) as {
        id?: string;
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        const errorMessage =
          data.message ?? data.error ?? `API error: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "File attached successfully!", percentage: 100 });
      }

      logger.info(
        `File attached to Trello card successfully - Attachment ID: ${data.id}`,
      );

      return {
        success: true,
        attachmentId: data.id,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Trello attach file error: ${errorMessage}`);
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
