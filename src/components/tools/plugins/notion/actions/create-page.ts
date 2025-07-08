import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";

// Schema for Notion block objects
const blockSchema = z.object({
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
  ]),
  content: z.string().optional(),
  checked: z.boolean().optional(),
  language: z.string().optional(),
  children: z.array(z.any()).optional(),
});

// Schema for create-page action parameters
export const createPageSchema = z.object({
  parentId: z.string().describe("The ID of the parent page or database"),
  title: z.string().min(1).describe("The title of the page"),
  icon: z
    .object({
      type: z.enum(["emoji", "external"]),
      emoji: z.string().optional(),
      url: z.string().url().optional(),
    })
    .optional()
    .describe("Optional icon for the page"),
  cover: z
    .object({
      type: z.enum(["external"]),
      url: z.string().url(),
    })
    .optional()
    .describe("Optional cover image for the page"),
  properties: z
    .record(
      z.union([
        z.object({
          type: z.literal("title"),
          title: z.array(
            z.object({
              text: z.object({ content: z.string() }),
            }),
          ),
        }),
        z.object({
          type: z.literal("rich_text"),
          rich_text: z.array(
            z.object({
              text: z.object({ content: z.string() }),
            }),
          ),
        }),
        z.object({
          type: z.literal("number"),
          number: z.number(),
        }),
        z.object({
          type: z.literal("select"),
          select: z.object({ name: z.string() }),
        }),
        z.object({
          type: z.literal("multi_select"),
          multi_select: z.array(z.object({ name: z.string() })),
        }),
        z.object({
          type: z.literal("checkbox"),
          checkbox: z.boolean(),
        }),
        z.object({
          type: z.literal("url"),
          url: z.string().url().nullable(),
        }),
        z.object({
          type: z.literal("email"),
          email: z.string().email().nullable(),
        }),
        z.object({
          type: z.literal("date"),
          date: z
            .object({
              start: z.string(),
              end: z.string().optional(),
            })
            .nullable(),
        }),
      ]),
    )
    .optional()
    .describe("Properties for database pages"),
  children: z
    .array(blockSchema)
    .optional()
    .describe("Content blocks for the page"),
});

export type CreatePageParams = z.infer<typeof createPageSchema>;

export const createPageAction: ToolAction = {
  id: "create-page",
  name: "Create Page",
  description: "Create a new page in Notion",
  category: "Content Management",
  actionType: "create",
  developmentMode: "visual",
  inputSchema: createPageSchema,
  outputSchema: z.object({
    success: z.boolean(),
    pageId: z.string().optional(),
    url: z.string().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Simple Page",
      description: "Create a basic page with title and content",
      input: {
        parentId: "parent-page-id",
        title: "Meeting Notes - January 15",
        children: [
          {
            type: "heading_1",
            content: "Agenda",
          },
          {
            type: "bulleted_list_item",
            content: "Review Q4 results",
          },
          {
            type: "bulleted_list_item",
            content: "Plan Q1 objectives",
          },
          {
            type: "heading_2",
            content: "Action Items",
          },
          {
            type: "to_do",
            content: "Send report to team",
            checked: false,
          },
        ],
      },
      output: {
        success: true,
        pageId: "new-page-id",
        url: "https://notion.so/Meeting-Notes-January-15-abc123",
      },
    },
    {
      name: "Database Entry",
      description: "Create a new entry in a database",
      input: {
        parentId: "database-id",
        title: "Feature: User Authentication",
        properties: {
          Status: {
            type: "select",
            select: { name: "In Progress" },
          },
          Priority: {
            type: "select",
            select: { name: "High" },
          },
          Assignee: {
            type: "rich_text",
            rich_text: [{ text: { content: "John Doe" } }],
          },
          Due: {
            type: "date",
            date: { start: "2024-01-31" },
          },
        },
        children: [
          {
            type: "paragraph",
            content:
              "Implement OAuth2 authentication flow with support for Google and GitHub providers.",
          },
        ],
      },
      output: {
        success: true,
        pageId: "task-page-id",
        url: "https://notion.so/Feature-User-Authentication-def456",
      },
    },
    {
      name: "Page with Icon and Cover",
      description: "Create a page with custom icon and cover image",
      input: {
        parentId: "parent-page-id",
        title: "Project Documentation",
        icon: {
          type: "emoji",
          emoji: "📚",
        },
        cover: {
          type: "external",
          url: "https://example.com/cover-image.jpg",
        },
        children: [
          {
            type: "paragraph",
            content:
              "Welcome to the project documentation. This page contains all the important information about our project.",
          },
          {
            type: "toggle",
            content: "Quick Links",
            children: [
              {
                type: "bulleted_list_item",
                content: "API Documentation",
              },
              {
                type: "bulleted_list_item",
                content: "Setup Guide",
              },
              {
                type: "bulleted_list_item",
                content: "Contributing Guidelines",
              },
            ],
          },
        ],
      },
      output: {
        success: true,
        pageId: "doc-page-id",
        url: "https://notion.so/Project-Documentation-ghi789",
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as CreatePageParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing page data...", percentage: 10 });
      }

      // Check for API key
      const apiKey = (credentials as { apiKey?: string }).apiKey;
      if (!apiKey) {
        throw new Error(
          "Notion API key required. Get your integration token from https://www.notion.so/my-integrations",
        );
      }

      // Replace variables in parameters
      const parentId = replaceVariables(typedParams.parentId, variables);
      const title = replaceVariables(typedParams.title, variables);

      // Build page object
      const pageData: Record<string, unknown> = {
        parent: {
          type: "page_id",
          page_id: parentId,
        },
      };

      // Handle properties (for database pages)
      if (typedParams.properties) {
        pageData.properties = {};
        const properties = pageData.properties as Record<string, unknown>;

        // Always add title
        properties.title = {
          title: [
            {
              text: {
                content: title,
              },
            },
          ],
        };

        // Add other properties
        for (const [key, value] of Object.entries(typedParams.properties)) {
          if (key !== "title") {
            properties[key] = processProperty(value, variables);
          }
        }
      } else {
        // For regular pages, use properties with title
        pageData.properties = {
          title: {
            title: [
              {
                text: {
                  content: title,
                },
              },
            ],
          },
        };
      }

      // Add icon if provided
      if (typedParams.icon) {
        pageData.icon = typedParams.icon;
      }

      // Add cover if provided
      if (typedParams.cover) {
        pageData.cover = {
          type: "external",
          external: {
            url: replaceVariables(typedParams.cover.url, variables),
          },
        };
      }

      // Process children blocks
      if (typedParams.children) {
        pageData.children = typedParams.children.map((block) =>
          processBlock(block, variables),
        );
      }

      logger.info("Creating Notion page", { parentId, title });

      if (isTest) {
        // Test mode - simulate creation
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating page creation...",
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          pageId: "test-page-id",
          url: "https://notion.so/Test-Page-123456",
        };
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Calling Notion API...", percentage: 30 });
      }

      // Create page via Notion API
      const response = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify(pageData),
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
        onProgress({ step: "Page created successfully!", percentage: 100 });
      }

      logger.info("Notion page created successfully", { pageId: data.id });

      return {
        success: true,
        pageId: data.id,
        url: data.url,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Notion create page error: ${errorMessage}`);
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
  block: z.infer<typeof blockSchema>,
  variables: { get: (key: string) => unknown },
): Record<string, unknown> {
  const processedBlock: Record<string, unknown> = {
    object: "block",
    type: block.type,
  };

  const blockContent: Record<string, unknown> = {};

  switch (block.type) {
    case "paragraph":
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "bulleted_list_item":
    case "numbered_list_item":
    case "quote":
      blockContent.rich_text = [
        {
          type: "text",
          text: {
            content: block.content
              ? replaceVariables(block.content, variables)
              : "",
          },
        },
      ];
      break;

    case "to_do":
      blockContent.rich_text = [
        {
          type: "text",
          text: {
            content: block.content
              ? replaceVariables(block.content, variables)
              : "",
          },
        },
      ];
      blockContent.checked = block.checked ?? false;
      break;

    case "toggle":
      blockContent.rich_text = [
        {
          type: "text",
          text: {
            content: block.content
              ? replaceVariables(block.content, variables)
              : "",
          },
        },
      ];
      if (block.children) {
        blockContent.children = block.children.map((child) =>
          processBlock(child as z.infer<typeof blockSchema>, variables),
        );
      }
      break;

    case "code":
      blockContent.rich_text = [
        {
          type: "text",
          text: {
            content: block.content
              ? replaceVariables(block.content, variables)
              : "",
          },
        },
      ];
      blockContent.language = block.language ?? "plain text";
      break;

    case "divider":
      // Divider has no content
      break;
  }

  processedBlock[block.type] = blockContent;
  return processedBlock;
}

// Helper function to process properties
function processProperty(
  property: unknown,
  variables: { get: (key: string) => unknown },
): unknown {
  const prop = property as Record<string, unknown>;
  const processed = { ...prop };

  if (prop.type === "rich_text" && Array.isArray(prop.rich_text)) {
    processed.rich_text = prop.rich_text.map((item) => {
      const textItem = item as { text: { content: string } };
      return {
        text: {
          content: replaceVariables(textItem.text.content, variables),
        },
      };
    });
  } else if (prop.type === "title" && Array.isArray(prop.title)) {
    processed.title = prop.title.map((item) => {
      const textItem = item as { text: { content: string } };
      return {
        text: {
          content: replaceVariables(textItem.text.content, variables),
        },
      };
    });
  } else if (prop.type === "url" && typeof prop.url === "string") {
    processed.url = replaceVariables(prop.url, variables);
  } else if (prop.type === "email" && typeof prop.email === "string") {
    processed.email = replaceVariables(prop.email, variables);
  }

  return processed;
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
