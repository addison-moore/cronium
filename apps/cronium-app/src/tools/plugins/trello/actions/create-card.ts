import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";

// Schema for create-card action parameters
export const createCardSchema = z.object({
  listId: z.string().describe("The ID of the list to add the card to"),
  name: z.string().min(1).describe("The name of the card"),
  desc: z.string().optional().describe("The description of the card"),
  pos: z
    .enum(["top", "bottom"])
    .or(z.number())
    .optional()
    .default("bottom")
    .describe("Position of the card in the list"),
  due: z.string().optional().describe("Due date (ISO 8601 format)"),
  dueComplete: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether the due date is marked as complete"),
  idMembers: z
    .array(z.string())
    .optional()
    .describe("Array of member IDs to assign to the card"),
  idLabels: z
    .array(z.string())
    .optional()
    .describe("Array of label IDs to add to the card"),
  urlSource: z.string().url().optional().describe("URL to attach to the card"),
  idCardSource: z
    .string()
    .optional()
    .describe("ID of a card to copy into the new card"),
  keepFromSource: z
    .enum([
      "all",
      "attachments",
      "checklists",
      "comments",
      "due",
      "labels",
      "members",
      "stickers",
    ])
    .or(z.array(z.string()))
    .optional()
    .describe("Properties to copy from source card"),
});

export type CreateCardParams = z.infer<typeof createCardSchema>;

export const createCardAction: ToolAction = {
  id: "create-card",
  name: "Create Card",
  description: "Create a new card in a Trello list",
  category: "Task Management",
  actionType: "create",
  actionTypeColor: "blue",
  developmentMode: "visual",
  inputSchema: createCardSchema,
  parameters: safeZodToParameters(createCardSchema),
  outputSchema: z.object({
    success: z.boolean(),
    cardId: z.string().optional(),
    url: z.string().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Simple Card",
      description: "Create a basic card with name and description",
      input: {
        listId: "list-id-123",
        name: "Fix login bug",
        desc: "Users are unable to login with Google OAuth. Need to investigate the callback URL configuration.",
      },
      output: {
        success: true,
        cardId: "card-abc-123",
        url: "https://trello.com/c/abc123/fix-login-bug",
      },
    },
    {
      name: "Card with Due Date",
      description: "Create a card with due date and assignees",
      input: {
        listId: "list-id-456",
        name: "Prepare Q1 Report",
        desc: "Compile metrics and prepare presentation for Q1 board meeting",
        due: "2024-01-31T17:00:00.000Z",
        idMembers: ["member-id-1", "member-id-2"],
        pos: "top",
      },
      output: {
        success: true,
        cardId: "card-def-456",
        url: "https://trello.com/c/def456/prepare-q1-report",
      },
    },
    {
      name: "Card with Labels",
      description: "Create a card with multiple labels",
      input: {
        listId: "list-id-789",
        name: "Implement dark mode",
        desc: "Add dark mode support to the application",
        idLabels: ["label-urgent", "label-feature", "label-frontend"],
        idMembers: ["member-id-3"],
      },
      output: {
        success: true,
        cardId: "card-ghi-789",
        url: "https://trello.com/c/ghi789/implement-dark-mode",
      },
    },
    {
      name: "Copy Card",
      description: "Create a card by copying an existing one",
      input: {
        listId: "list-id-new",
        name: "Sprint 2: User Authentication",
        idCardSource: "card-template-123",
        keepFromSource: ["checklists", "labels", "members"],
      },
      output: {
        success: true,
        cardId: "card-jkl-012",
        url: "https://trello.com/c/jkl012/sprint-2-user-authentication",
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as CreateCardParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing card data...", percentage: 10 });
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
      const listId = replaceVariables(typedParams.listId, variables);
      const name = replaceVariables(typedParams.name, variables);
      const desc = typedParams.desc
        ? replaceVariables(typedParams.desc, variables)
        : undefined;

      // Build card data
      const cardData: Record<string, unknown> = {
        idList: listId,
        name,
        pos: typedParams.pos,
      };

      if (desc) {
        cardData.desc = desc;
      }

      if (typedParams.due) {
        cardData.due = typedParams.due;
        cardData.dueComplete = typedParams.dueComplete;
      }

      if (typedParams.idMembers && typedParams.idMembers.length > 0) {
        cardData.idMembers = typedParams.idMembers.join(",");
      }

      if (typedParams.idLabels && typedParams.idLabels.length > 0) {
        cardData.idLabels = typedParams.idLabels.join(",");
      }

      if (typedParams.urlSource) {
        cardData.urlSource = replaceVariables(typedParams.urlSource, variables);
      }

      if (typedParams.idCardSource) {
        cardData.idCardSource = typedParams.idCardSource;
        if (typedParams.keepFromSource) {
          cardData.keepFromSource = Array.isArray(typedParams.keepFromSource)
            ? typedParams.keepFromSource.join(",")
            : typedParams.keepFromSource;
        }
      }

      logger.info(`Creating Trello card in list ${listId}: ${name}`);

      if (isTest) {
        // Test mode - simulate creation
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating card creation...",
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          cardId: "test-card-id",
          url: "https://trello.com/c/testcard/test-card",
        };
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Calling Trello API...", percentage: 30 });
      }

      // Build URL with query parameters
      const url = new URL("https://api.trello.com/1/cards");
      url.searchParams.append("key", apiKey);
      url.searchParams.append("token", apiToken);

      // Make API request
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cardData),
      });

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 70 });
      }

      const data = (await response.json()) as {
        id?: string;
        url?: string;
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
        onProgress({ step: "Card created successfully!", percentage: 100 });
      }

      logger.info(
        `Trello card created successfully - Card ID: ${data.id ?? "unknown"}`,
      );

      return {
        success: true,
        cardId: data.id,
        url: data.url,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Trello create card error: ${errorMessage}`);
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
