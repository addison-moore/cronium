import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for manage-blocks action parameters
export const manageBlocksSchema = z.object({
  operation: z
    .enum(["append", "update", "delete", "retrieve"])
    .describe("The operation to perform on blocks"),
  pageId: z.string().optional().describe("Page ID (for append operation)"),
  blockId: z
    .string()
    .optional()
    .describe("Block ID (for update/delete/retrieve operations)"),
  blocks: z
    .array(
      z.object({
        type: z.enum([
          "paragraph",
          "heading_1",
          "heading_2",
          "heading_3",
          "bulleted_list_item",
          "numbered_list_item",
          "toggle",
          "to_do",
          "quote",
          "divider",
          "code",
          "callout",
          "bookmark",
          "equation",
          "table_of_contents",
        ]),
        content: z.string().optional(),
        checked: z.boolean().optional(),
        language: z.string().optional(),
        icon: z
          .object({
            type: z.enum(["emoji"]),
            emoji: z.string(),
          })
          .optional(),
        color: z
          .enum([
            "default",
            "gray",
            "brown",
            "orange",
            "yellow",
            "green",
            "blue",
            "purple",
            "pink",
            "red",
            "gray_background",
            "brown_background",
            "orange_background",
            "yellow_background",
            "green_background",
            "blue_background",
            "purple_background",
            "pink_background",
            "red_background",
          ])
          .optional(),
        url: z.string().url().optional(),
        caption: z.string().optional(),
        expression: z.string().optional(),
      }),
    )
    .optional()
    .describe("Blocks to append or update"),
  after: z.string().optional().describe("Block ID to insert new blocks after"),
});

export type ManageBlocksParams = z.infer<typeof manageBlocksSchema>;

export const manageBlocksAction: ToolAction = {
  id: "manage-blocks",
  name: "Manage Blocks",
  description: "Append, update, delete, or retrieve blocks in Notion pages",
  category: "Content Management",
  actionType: "update",
  developmentMode: "visual",
  inputSchema: manageBlocksSchema,
  parameters: zodToParameters(manageBlocksSchema),
  outputSchema: z.object({
    success: z.boolean(),
    blocks: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Append Blocks",
      description: "Add new blocks to the end of a page",
      input: {
        operation: "append",
        pageId: "page-id",
        blocks: [
          {
            type: "heading_2",
            content: "New Section",
          },
          {
            type: "paragraph",
            content:
              "This is a new paragraph added to the page with some **bold** text.",
          },
          {
            type: "to_do",
            content: "Complete this task",
            checked: false,
          },
        ],
      },
      output: {
        success: true,
        blocks: [
          { id: "block-1", type: "heading_2" },
          { id: "block-2", type: "paragraph" },
          { id: "block-3", type: "to_do" },
        ],
      },
    },
    {
      name: "Update Block",
      description: "Update an existing block's content",
      input: {
        operation: "update",
        blockId: "existing-block-id",
        blocks: [
          {
            type: "paragraph",
            content: "Updated content for this paragraph",
            color: "blue_background",
          },
        ],
      },
      output: {
        success: true,
      },
    },
    {
      name: "Add Callout",
      description: "Add a callout block with an icon",
      input: {
        operation: "append",
        pageId: "page-id",
        blocks: [
          {
            type: "callout",
            content:
              "Important: Remember to review this section before publishing.",
            icon: {
              type: "emoji",
              emoji: "⚠️",
            },
            color: "yellow_background",
          },
        ],
      },
      output: {
        success: true,
        blocks: [{ id: "callout-block-id", type: "callout" }],
      },
    },
    {
      name: "Add Code Block",
      description: "Add a code block with syntax highlighting",
      input: {
        operation: "append",
        pageId: "page-id",
        blocks: [
          {
            type: "code",
            content: 'function hello() {\n  console.log("Hello, World!");\n}',
            language: "javascript",
          },
        ],
      },
      output: {
        success: true,
        blocks: [{ id: "code-block-id", type: "code" }],
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as ManageBlocksParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing block operation...", percentage: 10 });
      }

      // Check for API key
      const apiKey = (credentials as { apiKey?: string }).apiKey;
      if (!apiKey) {
        throw new Error(
          "Notion API key required. Get your integration token from https://www.notion.so/my-integrations",
        );
      }

      logger.info(`Performing block operation: ${typedParams.operation}`);

      if (isTest) {
        // Test mode - simulate operation
        if (onProgress) {
          onProgress({
            step: `Test mode - simulating ${typedParams.operation}...`,
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 800));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        if (typedParams.operation === "append" && typedParams.blocks) {
          return {
            success: true,
            blocks: typedParams.blocks.map((block, index) => ({
              id: `test-block-${index}`,
              type: block.type,
            })),
          };
        }

        return { success: true };
      }

      let response: Response;
      let result: { success: boolean; blocks?: unknown[]; error?: string } = {
        success: false,
      };

      // Update progress
      if (onProgress) {
        onProgress({ step: "Calling Notion API...", percentage: 30 });
      }

      switch (typedParams.operation) {
        case "append": {
          if (!typedParams.pageId || !typedParams.blocks) {
            throw new Error(
              "Page ID and blocks are required for append operation",
            );
          }

          const pageId = replaceVariables(typedParams.pageId, variables);
          const children = typedParams.blocks.map((block) =>
            processBlock(block, variables),
          );

          response = await fetch(
            `https://api.notion.com/v1/blocks/${pageId}/children`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28",
              },
              body: JSON.stringify({
                children,
                after: typedParams.after,
              }),
            },
          );

          if (response.ok) {
            const data = (await response.json()) as {
              results?: Array<{ id: string; type: string }>;
            };
            result = {
              success: true,
              blocks: data.results,
            };
          }
          break;
        }

        case "update": {
          if (!typedParams.blockId || !typedParams.blocks?.[0]) {
            throw new Error(
              "Block ID and block data are required for update operation",
            );
          }

          const blockId = replaceVariables(typedParams.blockId, variables);
          const blockData = processBlock(typedParams.blocks[0], variables);

          response = await fetch(
            `https://api.notion.com/v1/blocks/${blockId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "Notion-Version": "2022-06-28",
              },
              body: JSON.stringify(blockData),
            },
          );

          if (response.ok) {
            result = { success: true };
          }
          break;
        }

        case "delete": {
          if (!typedParams.blockId) {
            throw new Error("Block ID is required for delete operation");
          }

          const blockId = replaceVariables(typedParams.blockId, variables);

          response = await fetch(
            `https://api.notion.com/v1/blocks/${blockId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Notion-Version": "2022-06-28",
              },
            },
          );

          if (response.ok) {
            result = { success: true };
          }
          break;
        }

        case "retrieve": {
          if (!typedParams.blockId) {
            throw new Error("Block ID is required for retrieve operation");
          }

          const blockId = replaceVariables(typedParams.blockId, variables);

          response = await fetch(
            `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`,
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Notion-Version": "2022-06-28",
              },
            },
          );

          if (response.ok) {
            const data = (await response.json()) as { results?: unknown[] };
            result = {
              success: true,
              blocks: data.results,
            };
          }
          break;
        }

        default:
          throw new Error(`Unknown operation: ${typedParams.operation}`);
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 80 });
      }

      if (!result.success && response!) {
        const errorData = (await response.json()) as {
          error?: string;
          message?: string;
        };
        throw new Error(
          errorData.message ??
            errorData.error ??
            `API error: ${response.status}`,
        );
      }

      // Update progress
      if (onProgress) {
        onProgress({
          step: "Block operation completed successfully!",
          percentage: 100,
        });
      }

      logger.info("Notion block operation completed successfully");
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Notion block operation error: ${errorMessage}`);
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

// Helper function to process blocks
function processBlock(
  block: z.infer<typeof manageBlocksSchema>["blocks"][0],
  variables: { get: (key: string) => unknown },
): Record<string, unknown> {
  const processedBlock: Record<string, unknown> = {
    object: "block",
    type: block.type,
  };

  const blockContent: Record<string, unknown> = {};

  // Handle text content for most block types
  if (
    block.type !== "divider" &&
    block.type !== "table_of_contents" &&
    block.content
  ) {
    blockContent.rich_text = [
      {
        type: "text",
        text: {
          content: replaceVariables(block.content, variables),
        },
      },
    ];
  }

  // Handle special properties
  switch (block.type) {
    case "to_do":
      if (block.checked !== undefined) {
        blockContent.checked = block.checked;
      }
      break;

    case "code":
      if (block.language) {
        blockContent.language = block.language;
      }
      break;

    case "callout":
      if (block.icon) {
        blockContent.icon = block.icon;
      }
      break;

    case "bookmark":
      if (block.url) {
        blockContent.url = replaceVariables(block.url, variables);
      }
      if (block.caption) {
        blockContent.caption = [
          {
            type: "text",
            text: {
              content: replaceVariables(block.caption, variables),
            },
          },
        ];
      }
      break;

    case "equation":
      if (block.expression) {
        blockContent.expression = replaceVariables(block.expression, variables);
      }
      break;
  }

  // Handle color for applicable block types
  if (block.color) {
    blockContent.color = block.color;
  }

  processedBlock[block.type] = blockContent;
  return processedBlock;
}

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
