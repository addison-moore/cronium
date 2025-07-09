import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for update-database action parameters
export const updateDatabaseSchema = z.object({
  databaseId: z.string().describe("The ID of the database to update"),
  pageId: z.string().describe("The ID of the page/entry to update"),
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
          select: z.object({ name: z.string() }).nullable(),
        }),
        z.object({
          type: z.literal("multi_select"),
          multi_select: z.array(z.object({ name: z.string() })),
        }),
        z.object({
          type: z.literal("status"),
          status: z.object({ name: z.string() }).nullable(),
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
          type: z.literal("phone_number"),
          phone_number: z.string().nullable(),
        }),
        z.object({
          type: z.literal("date"),
          date: z
            .object({
              start: z.string(),
              end: z.string().optional(),
              time_zone: z.string().optional(),
            })
            .nullable(),
        }),
        z.object({
          type: z.literal("people"),
          people: z.array(
            z.object({
              object: z.literal("user"),
              id: z.string(),
            }),
          ),
        }),
        z.object({
          type: z.literal("relation"),
          relation: z.array(
            z.object({
              id: z.string(),
            }),
          ),
        }),
      ]),
    )
    .describe("Properties to update"),
  archived: z
    .boolean()
    .optional()
    .describe("Whether to archive/unarchive the entry"),
});

export type UpdateDatabaseParams = z.infer<typeof updateDatabaseSchema>;

export const updateDatabaseAction: ToolAction = {
  id: "update-database",
  name: "Update Database Entry",
  description: "Update an existing entry in a Notion database",
  category: "Content Management",
  actionType: "update",
  developmentMode: "visual",
  inputSchema: updateDatabaseSchema,
  parameters: zodToParameters(updateDatabaseSchema),
  outputSchema: z.object({
    success: z.boolean(),
    lastEditedTime: z.string().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Update Task Status",
      description: "Update the status of a task in a project database",
      input: {
        databaseId: "database-id",
        pageId: "page-id",
        properties: {
          Status: {
            type: "status",
            status: { name: "Completed" },
          },
          "Completion Date": {
            type: "date",
            date: { start: "2024-01-15" },
          },
        },
      },
      output: {
        success: true,
        lastEditedTime: "2024-01-15T10:30:00.000Z",
      },
    },
    {
      name: "Update Multiple Properties",
      description: "Update multiple properties of a database entry",
      input: {
        databaseId: "crm-database-id",
        pageId: "contact-page-id",
        properties: {
          "Company Name": {
            type: "title",
            title: [{ text: { content: "Acme Corporation" } }],
          },
          "Deal Value": {
            type: "number",
            number: 50000,
          },
          Stage: {
            type: "select",
            select: { name: "Negotiation" },
          },
          Tags: {
            type: "multi_select",
            multi_select: [{ name: "Enterprise" }, { name: "High Priority" }],
          },
          "Last Contact": {
            type: "date",
            date: { start: "2024-01-10" },
          },
        },
      },
      output: {
        success: true,
        lastEditedTime: "2024-01-15T14:45:00.000Z",
      },
    },
    {
      name: "Archive Entry",
      description: "Archive a database entry",
      input: {
        databaseId: "database-id",
        pageId: "old-page-id",
        properties: {
          Status: {
            type: "select",
            select: { name: "Archived" },
          },
        },
        archived: true,
      },
      output: {
        success: true,
        lastEditedTime: "2024-01-15T16:00:00.000Z",
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as UpdateDatabaseParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing update data...", percentage: 10 });
      }

      // Check for API key
      const apiKey = (credentials as { apiKey?: string }).apiKey;
      if (!apiKey) {
        throw new Error(
          "Notion API key required. Get your integration token from https://www.notion.so/my-integrations",
        );
      }

      // Replace variables in parameters
      const pageId = replaceVariables(typedParams.pageId, variables);

      // Build update object
      const updateData: Record<string, unknown> = {
        properties: {},
      };

      // Process properties
      const properties = updateData.properties as Record<string, unknown>;
      for (const [key, value] of Object.entries(typedParams.properties)) {
        properties[key] = processProperty(value, variables);
      }

      // Add archived status if specified
      if (typedParams.archived !== undefined) {
        updateData.archived = typedParams.archived;
      }

      logger.info(`Updating Notion database entry: ${pageId}`);

      if (isTest) {
        // Test mode - simulate update
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating database update...",
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 800));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          lastEditedTime: new Date().toISOString(),
        };
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Calling Notion API...", percentage: 30 });
      }

      // Update page via Notion API
      const response = await fetch(
        `https://api.notion.com/v1/pages/${pageId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
          },
          body: JSON.stringify(updateData),
        },
      );

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 70 });
      }

      const data = (await response.json()) as {
        last_edited_time?: string;
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
        onProgress({
          step: "Database entry updated successfully!",
          percentage: 100,
        });
      }

      logger.info(`Notion database entry updated successfully: ${pageId}`);

      return {
        success: true,
        lastEditedTime: data.last_edited_time,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Notion update database error: ${errorMessage}`);
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
        type: "text",
        text: {
          content: replaceVariables(textItem.text.content, variables),
        },
      };
    });
  } else if (prop.type === "title" && Array.isArray(prop.title)) {
    processed.title = prop.title.map((item) => {
      const textItem = item as { text: { content: string } };
      return {
        type: "text",
        text: {
          content: replaceVariables(textItem.text.content, variables),
        },
      };
    });
  } else if (prop.type === "url" && typeof prop.url === "string") {
    processed.url = replaceVariables(prop.url, variables);
  } else if (prop.type === "email" && typeof prop.email === "string") {
    processed.email = replaceVariables(prop.email, variables);
  } else if (
    prop.type === "phone_number" &&
    typeof prop.phone_number === "string"
  ) {
    processed.phone_number = replaceVariables(prop.phone_number, variables);
  } else if (prop.type === "select" && prop.select) {
    const select = prop.select as { name: string };
    processed.select = {
      name: replaceVariables(select.name, variables),
    };
  } else if (prop.type === "status" && prop.status) {
    const status = prop.status as { name: string };
    processed.status = {
      name: replaceVariables(status.name, variables),
    };
  } else if (prop.type === "multi_select" && Array.isArray(prop.multi_select)) {
    processed.multi_select = prop.multi_select.map((item) => {
      const selectItem = item as { name: string };
      return {
        name: replaceVariables(selectItem.name, variables),
      };
    });
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
    // Use explicit conversion for primitives to satisfy the linter
    if (typeof value === "string") return value;
    if (typeof value === "number") return value.toString();
    if (typeof value === "boolean") return value.toString();
    // This should never be reached, but satisfies TypeScript
    return String(value);
  });
}
