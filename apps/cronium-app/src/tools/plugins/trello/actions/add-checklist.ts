import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";

// Schema for add-checklist action parameters
export const addChecklistSchema = z.object({
  cardId: z.string().describe("The ID of the card"),
  name: z.string().min(1).describe("The name of the checklist"),
  idChecklistSource: z
    .string()
    .optional()
    .describe("ID of a checklist to copy"),
  pos: z
    .enum(["top", "bottom"])
    .or(z.number())
    .optional()
    .default("bottom")
    .describe("Position of the checklist"),
  checkItems: z
    .array(
      z.object({
        name: z.string().min(1),
        pos: z.enum(["top", "bottom"]).or(z.number()).optional(),
        checked: z.boolean().optional().default(false),
      }),
    )
    .optional()
    .describe("Items to add to the checklist"),
});

export type AddChecklistParams = z.infer<typeof addChecklistSchema>;

export const addChecklistAction: ToolAction = {
  id: "add-checklist",
  name: "Add Checklist",
  description: "Add a checklist to a Trello card",
  category: "Task Management",
  actionType: "update",
  actionTypeColor: "yellow",
  developmentMode: "visual",
  inputSchema: addChecklistSchema,
  parameters: safeZodToParameters(addChecklistSchema),
  outputSchema: z.object({
    success: z.boolean(),
    checklistId: z.string().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Simple Checklist",
      description: "Add a basic checklist to a card",
      input: {
        cardId: "card-123",
        name: "Pre-launch Checklist",
        checkItems: [
          { name: "Run all tests", checked: true },
          { name: "Update documentation", checked: false },
          { name: "Deploy to staging", checked: false },
          { name: "Get approval from PM", checked: false },
        ],
      },
      output: {
        success: true,
        checklistId: "checklist-abc",
      },
    },
    {
      name: "Definition of Done",
      description: "Add a standard DoD checklist",
      input: {
        cardId: "card-456",
        name: "Definition of Done",
        checkItems: [
          { name: "Code reviewed", pos: "top" },
          { name: "Unit tests written" },
          { name: "Integration tests passed" },
          { name: "Documentation updated" },
          { name: "Deployed to production" },
        ],
      },
      output: {
        success: true,
        checklistId: "checklist-def",
      },
    },
    {
      name: "Copy Checklist",
      description: "Copy an existing checklist template",
      input: {
        cardId: "card-789",
        name: "Sprint Planning",
        idChecklistSource: "checklist-template-123",
      },
      output: {
        success: true,
        checklistId: "checklist-ghi",
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as AddChecklistParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing checklist data...", percentage: 10 });
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
      const name = replaceVariables(typedParams.name, variables);

      // Build checklist data
      const checklistData: Record<string, unknown> = {
        idCard: cardId,
        name,
        pos: typedParams.pos,
      };

      if (typedParams.idChecklistSource) {
        checklistData.idChecklistSource = typedParams.idChecklistSource;
      }

      logger.info(`Adding checklist to Trello card ${cardId}: ${name}`);

      if (isTest) {
        // Test mode - simulate creation
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating checklist creation...",
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          checklistId: "test-checklist-id",
        };
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Creating checklist...", percentage: 30 });
      }

      // Build URL with query parameters
      const url = new URL("https://api.trello.com/1/checklists");
      url.searchParams.append("key", apiKey);
      url.searchParams.append("token", apiToken);

      // Create checklist
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(checklistData),
      });

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

      const checklistId = data.id;

      // Add checklist items if provided
      if (typedParams.checkItems && typedParams.checkItems.length > 0) {
        if (onProgress) {
          onProgress({ step: "Adding checklist items...", percentage: 60 });
        }

        for (let i = 0; i < typedParams.checkItems.length; i++) {
          const item = typedParams.checkItems[i];
          if (!item) continue; // Guard against undefined

          const itemUrl = new URL(
            `https://api.trello.com/1/checklists/${checklistId ?? "undefined"}/checkItems`,
          );
          itemUrl.searchParams.append("key", apiKey);
          itemUrl.searchParams.append("token", apiToken);

          const itemData: Record<string, unknown> = {
            name: replaceVariables(item.name, variables),
            checked: item.checked,
          };

          if (item.pos !== undefined) {
            itemData.pos = item.pos;
          }

          const itemResponse = await fetch(itemUrl.toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(itemData),
          });

          if (!itemResponse.ok) {
            logger.warn(`Failed to add checklist item: ${item.name}`);
          }

          // Update progress for items
          if (onProgress) {
            const itemProgress =
              60 + (30 * (i + 1)) / typedParams.checkItems.length;
            onProgress({
              step: `Added ${i + 1} of ${typedParams.checkItems.length} items`,
              percentage: itemProgress,
            });
          }
        }
      }

      // Update progress
      if (onProgress) {
        onProgress({
          step: "Checklist created successfully!",
          percentage: 100,
        });
      }

      logger.info(
        `Trello checklist created successfully - ID: ${checklistId ?? "unknown"}`,
      );

      return {
        success: true,
        checklistId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Trello add checklist error: ${errorMessage}`);
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
