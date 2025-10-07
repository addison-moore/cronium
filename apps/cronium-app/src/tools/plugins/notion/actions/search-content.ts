import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";

// Schema for search-content action parameters
export const searchContentSchema = z.object({
  query: z.string().min(1).describe("The search query"),
  filter: z
    .object({
      property: z.enum(["object", "database", "page"]).optional(),
      databases: z
        .array(z.string())
        .optional()
        .describe("Filter by specific database IDs"),
    })
    .optional()
    .describe("Optional filters for the search"),
  sort: z
    .object({
      direction: z.enum(["ascending", "descending"]),
      timestamp: z.enum(["last_edited_time"]),
    })
    .optional()
    .describe("Sort order for results"),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .describe("Number of results to return"),
});

export type SearchContentParams = z.infer<typeof searchContentSchema>;

export const searchContentAction: ToolAction = {
  id: "search-content",
  name: "Search Content",
  description: "Search for pages and databases in Notion",
  category: "Search",
  actionType: "search",
  developmentMode: "visual",
  inputSchema: searchContentSchema,
  parameters: safeZodToParameters(searchContentSchema),
  outputSchema: z.object({
    success: z.boolean(),
    results: z
      .array(
        z.object({
          id: z.string(),
          type: z.enum(["page", "database"]),
          title: z.string(),
          url: z.string(),
          lastEditedTime: z.string(),
          parentId: z.string().optional(),
          parentType: z.string().optional(),
        }),
      )
      .optional(),
    hasMore: z.boolean().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Simple Search",
      description: "Search for content containing a keyword",
      input: {
        query: "project roadmap",
        pageSize: 5,
      },
      output: {
        success: true,
        results: [
          {
            id: "page-id-1",
            type: "page",
            title: "Q1 Project Roadmap",
            url: "https://notion.so/Q1-Project-Roadmap-123",
            lastEditedTime: "2024-01-14T10:30:00.000Z",
            parentId: "parent-page-id",
            parentType: "page_id",
          },
          {
            id: "page-id-2",
            type: "page",
            title: "Product Roadmap 2024",
            url: "https://notion.so/Product-Roadmap-2024-456",
            lastEditedTime: "2024-01-10T15:45:00.000Z",
            parentId: "database-id",
            parentType: "database_id",
          },
        ],
        hasMore: false,
      },
    },
    {
      name: "Search in Database",
      description: "Search for pages within specific databases",
      input: {
        query: "bug",
        filter: {
          property: "page",
          databases: ["bugs-database-id", "issues-database-id"],
        },
        sort: {
          direction: "descending",
          timestamp: "last_edited_time",
        },
        pageSize: 10,
      },
      output: {
        success: true,
        results: [
          {
            id: "bug-1",
            type: "page",
            title: "Login bug on mobile",
            url: "https://notion.so/Login-bug-on-mobile-789",
            lastEditedTime: "2024-01-15T09:00:00.000Z",
            parentId: "bugs-database-id",
            parentType: "database_id",
          },
          {
            id: "bug-2",
            type: "page",
            title: "API timeout bug",
            url: "https://notion.so/API-timeout-bug-abc",
            lastEditedTime: "2024-01-14T16:30:00.000Z",
            parentId: "bugs-database-id",
            parentType: "database_id",
          },
        ],
        hasMore: true,
      },
    },
    {
      name: "Search Databases",
      description: "Search for databases by name",
      input: {
        query: "CRM",
        filter: {
          property: "database",
        },
      },
      output: {
        success: true,
        results: [
          {
            id: "crm-db-id",
            type: "database",
            title: "CRM Database",
            url: "https://notion.so/crm-database-def",
            lastEditedTime: "2024-01-12T11:00:00.000Z",
          },
          {
            id: "crm-contacts-id",
            type: "database",
            title: "CRM Contacts",
            url: "https://notion.so/crm-contacts-ghi",
            lastEditedTime: "2024-01-08T14:20:00.000Z",
          },
        ],
        hasMore: false,
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as SearchContentParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing search query...", percentage: 10 });
      }

      // Check for API key
      const apiKey = (credentials as { apiKey?: string }).apiKey;
      if (!apiKey) {
        throw new Error(
          "Notion API key required. Get your integration token from https://www.notion.so/my-integrations",
        );
      }

      // Replace variables in query
      const query = replaceVariables(typedParams.query, variables);

      // Build search request
      const searchRequest: Record<string, unknown> = {
        query,
        page_size: typedParams.pageSize,
      };

      // Add filter if provided
      if (typedParams.filter) {
        const filter: Record<string, unknown> = {};
        if (typedParams.filter.property) {
          filter.property = typedParams.filter.property;
        }
        if (typedParams.filter.databases) {
          filter.value = typedParams.filter.databases;
        }
        searchRequest.filter = filter;
      }

      // Add sort if provided
      if (typedParams.sort) {
        searchRequest.sort = typedParams.sort;
      }

      logger.info(`Searching Notion content with query: ${query}`);

      if (isTest) {
        // Test mode - return sample results
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating search...",
            percentage: 50,
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 800));

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          results: [
            {
              id: "test-page-1",
              type: "page" as const,
              title: `Test Page: ${query}`,
              url: "https://notion.so/test-page-1",
              lastEditedTime: new Date().toISOString(),
              parentId: "test-parent",
              parentType: "page_id",
            },
            {
              id: "test-page-2",
              type: "page" as const,
              title: `Another Result for: ${query}`,
              url: "https://notion.so/test-page-2",
              lastEditedTime: new Date(Date.now() - 86400000).toISOString(),
              parentId: "test-database",
              parentType: "database_id",
            },
          ],
          hasMore: false,
        };
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Calling Notion API...", percentage: 30 });
      }

      // Search via Notion API
      const response = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify(searchRequest),
      });

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing results...", percentage: 70 });
      }

      const data = (await response.json()) as {
        results?: Array<{
          id: string;
          object: string;
          properties?: Record<string, unknown>;
          title?: Array<{ plain_text: string }>;
          url?: string;
          last_edited_time?: string;
          parent?: {
            type?: string;
            page_id?: string;
            database_id?: string;
            workspace?: boolean;
          };
        }>;
        has_more?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        const errorMessage =
          data.message ?? data.error ?? `API error: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Process results
      const results = (data.results ?? []).map((item) => {
        // Extract title
        let title = "Untitled";
        if (item.object === "page" && item.properties) {
          // Look for title property
          const titleProp = Object.values(item.properties).find(
            (prop) => (prop as { type?: string }).type === "title",
          );
          if (titleProp) {
            const titleArray = (
              titleProp as { title?: Array<{ plain_text: string }> }
            ).title;
            if (titleArray && titleArray.length > 0) {
              const firstTitle = titleArray[0];
              if (firstTitle) {
                title = firstTitle.plain_text;
              }
            }
          }
        } else if (item.object === "database" && item.title) {
          title = item.title.map((t) => t.plain_text).join("");
        }

        return {
          id: item.id,
          type: item.object as "page" | "database",
          title,
          url: item.url ?? `https://notion.so/${item.id.replace(/-/g, "")}`,
          lastEditedTime: item.last_edited_time ?? new Date().toISOString(),
          parentId: item.parent?.page_id ?? item.parent?.database_id,
          parentType: item.parent?.type,
        };
      });

      // Update progress
      if (onProgress) {
        onProgress({
          step: `Found ${results.length} results!`,
          percentage: 100,
        });
      }

      logger.info(`Notion search completed: ${results.length} results`);

      return {
        success: true,
        results,
        hasMore: data.has_more,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Notion search error: ${errorMessage}`);
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
