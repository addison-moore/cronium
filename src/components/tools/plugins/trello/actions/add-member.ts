import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for add-member action parameters
export const addMemberSchema = z.object({
  cardId: z.string().describe("The ID of the card"),
  memberId: z.string().describe("The ID of the member to add"),
});

export type AddMemberParams = z.infer<typeof addMemberSchema>;

export const addMemberAction: ToolAction = {
  id: "add-member",
  name: "Add Member to Card",
  description: "Add a member to a Trello card",
  category: "Task Management",
  actionType: "update",
  developmentMode: "visual",
  inputSchema: addMemberSchema,
  parameters: zodToParameters(addMemberSchema),
  outputSchema: z.object({
    success: z.boolean(),
    members: z
      .array(
        z.object({
          id: z.string(),
          fullName: z.string(),
          username: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Assign Member",
      description: "Assign a team member to a card",
      input: {
        cardId: "card-123",
        memberId: "member-abc",
      },
      output: {
        success: true,
        members: [
          {
            id: "member-abc",
            fullName: "John Doe",
            username: "johndoe",
          },
        ],
      },
    },
    {
      name: "Add Additional Member",
      description: "Add another member to a card with existing assignees",
      input: {
        cardId: "card-456",
        memberId: "member-def",
      },
      output: {
        success: true,
        members: [
          {
            id: "member-xyz",
            fullName: "Jane Smith",
            username: "janesmith",
          },
          {
            id: "member-def",
            fullName: "Bob Johnson",
            username: "bobjohnson",
          },
        ],
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as AddMemberParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing to add member...", percentage: 10 });
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
      const memberId = replaceVariables(typedParams.memberId, variables);

      logger.info(`Adding member ${memberId} to Trello card ${cardId}`);

      if (isTest) {
        // Test mode - simulate adding member
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating member addition...",
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 800));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          members: [
            {
              id: memberId,
              fullName: "Test User",
              username: "testuser",
            },
          ],
        };
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Calling Trello API...", percentage: 30 });
      }

      // Build URL with query parameters
      const url = new URL(`https://api.trello.com/1/cards/${cardId}/idMembers`);
      url.searchParams.append("key", apiKey);
      url.searchParams.append("token", apiToken);
      url.searchParams.append("value", memberId);

      // Make API request
      const response = await fetch(url.toString(), {
        method: "POST",
      });

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 70 });
      }

      const data = (await response.json()) as
        | Array<{
            id: string;
            fullName: string;
            username: string;
          }>
        | {
            error?: string;
            message?: string;
          };

      if (!response.ok) {
        const errorData = data as { error?: string; message?: string };
        const errorMessage =
          errorData.message ??
          errorData.error ??
          `API error: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Member added successfully!", percentage: 100 });
      }

      logger.info("Member added to Trello card successfully");

      const members = data as Array<{
        id: string;
        fullName: string;
        username: string;
      }>;

      return {
        success: true,
        members,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Trello add member error: ${errorMessage}`);
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
