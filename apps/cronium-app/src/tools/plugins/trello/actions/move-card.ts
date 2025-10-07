import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";

// Schema for move-card action parameters
export const moveCardSchema = z.object({
  cardId: z.string().describe("The ID of the card to move"),
  destinationListId: z
    .string()
    .optional()
    .describe("The ID of the list to move the card to"),
  destinationBoardId: z
    .string()
    .optional()
    .describe("The ID of the board to move the card to (if different)"),
  pos: z
    .enum(["top", "bottom"])
    .or(z.number())
    .optional()
    .describe("Position in the destination list"),
});

export type MoveCardParams = z.infer<typeof moveCardSchema>;

export const moveCardAction: ToolAction = {
  id: "move-card",
  name: "Move Card",
  description: "Move a card to a different list or board",
  category: "Task Management",
  actionType: "update",
  developmentMode: "visual",
  inputSchema: moveCardSchema,
  parameters: safeZodToParameters(moveCardSchema),
  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Move to Different List",
      description: "Move a card to another list on the same board",
      input: {
        cardId: "card-123",
        destinationListId: "list-done",
        pos: "bottom",
      },
      output: {
        success: true,
      },
    },
    {
      name: "Move to Top of List",
      description: "Move a card to the top of a specific list",
      input: {
        cardId: "card-456",
        destinationListId: "list-in-progress",
        pos: "top",
      },
      output: {
        success: true,
      },
    },
    {
      name: "Move to Different Board",
      description: "Move a card to a list on a different board",
      input: {
        cardId: "card-789",
        destinationBoardId: "board-archive",
        destinationListId: "list-completed-2024",
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
    const typedParams = params as MoveCardParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing to move card...", percentage: 10 });
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

      // Build update data
      const updateData: Record<string, unknown> = {};

      if (typedParams.destinationListId) {
        updateData.idList = replaceVariables(
          typedParams.destinationListId,
          variables,
        );
      }

      if (typedParams.destinationBoardId) {
        updateData.idBoard = replaceVariables(
          typedParams.destinationBoardId,
          variables,
        );
      }

      if (typedParams.pos !== undefined) {
        updateData.pos = typedParams.pos;
      }

      if (Object.keys(updateData).length === 0) {
        throw new Error("No destination specified for card move");
      }

      logger.info(`Moving Trello card ${cardId}`);

      if (isTest) {
        // Test mode - simulate move
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating card move...",
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 800));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return { success: true };
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Calling Trello API...", percentage: 30 });
      }

      // Build URL with query parameters
      const url = new URL(`https://api.trello.com/1/cards/${cardId}`);
      url.searchParams.append("key", apiKey);
      url.searchParams.append("token", apiToken);

      // Make API request
      const response = await fetch(url.toString(), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateData),
      });

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 70 });
      }

      if (!response.ok) {
        const data = (await response.json()) as {
          error?: string;
          message?: string;
        };
        const errorMessage =
          data.message ?? data.error ?? `API error: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Card moved successfully!", percentage: 100 });
      }

      logger.info("Trello card moved successfully");

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Trello move card error: ${errorMessage}`);
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
