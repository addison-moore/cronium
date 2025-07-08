import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for create-sheet action parameters
export const createSheetSchema = z.object({
  spreadsheetId: z
    .string()
    .describe("The ID of the spreadsheet to add the sheet to"),
  title: z.string().describe("The name of the new sheet"),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("The index where the sheet should be inserted"),
  gridProperties: z
    .object({
      rowCount: z.number().int().min(1).optional().default(1000),
      columnCount: z.number().int().min(1).optional().default(26),
      frozenRowCount: z.number().int().min(0).optional(),
      frozenColumnCount: z.number().int().min(0).optional(),
    })
    .optional()
    .describe("Grid properties for the new sheet"),
  tabColor: z
    .object({
      red: z.number().min(0).max(1).optional(),
      green: z.number().min(0).max(1).optional(),
      blue: z.number().min(0).max(1).optional(),
    })
    .optional()
    .describe("RGB color for the sheet tab (values 0-1)"),
});

export type CreateSheetParams = z.infer<typeof createSheetSchema>;

export const createSheetAction: ToolAction = {
  id: "create-sheet",
  name: "Create Sheet",
  description: "Create a new sheet within a Google Sheets spreadsheet",
  category: "Sheet Management",
  actionType: "create",
  developmentMode: "visual",
  inputSchema: createSheetSchema,
  parameters: zodToParameters(createSheetSchema),
  outputSchema: z.object({
    success: z.boolean(),
    sheetId: z.number().optional(),
    title: z.string().optional(),
    index: z.number().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Create Basic Sheet",
      description: "Create a new sheet with default settings",
      input: {
        spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
        title: "Q1 Sales Data",
      },
      output: {
        success: true,
        sheetId: 123456789,
        title: "Q1 Sales Data",
        index: 1,
      },
    },
    {
      name: "Create Custom Sheet",
      description: "Create a sheet with custom properties",
      input: {
        spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
        title: "Financial Summary",
        index: 0,
        gridProperties: {
          rowCount: 500,
          columnCount: 20,
          frozenRowCount: 2,
          frozenColumnCount: 1,
        },
        tabColor: {
          red: 0.2,
          green: 0.8,
          blue: 0.2,
        },
      },
      output: {
        success: true,
        sheetId: 987654321,
        title: "Financial Summary",
        index: 0,
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as CreateSheetParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing to create sheet...", percentage: 10 });
      }

      // Check for OAuth token
      const oauthToken = (credentials as { oauthToken?: string }).oauthToken;
      if (!oauthToken) {
        throw new Error(
          "OAuth authentication required. This action requires Google OAuth with Sheets API access.",
        );
      }

      // Replace variables in parameters
      const spreadsheetId = replaceVariables(
        typedParams.spreadsheetId,
        variables,
      );
      const title = replaceVariables(typedParams.title, variables);

      if (isTest) {
        // Test mode - simulate success
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating sheet creation...",
            percentage: 50,
          });
        }

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          sheetId: Math.floor(Math.random() * 1000000000),
          title,
          index: typedParams.index ?? 1,
        };
      }

      // Update progress
      if (onProgress) {
        onProgress({
          step: "Connecting to Google Sheets API...",
          percentage: 30,
        });
      }

      // Build request body
      const requestBody = {
        requests: [
          {
            addSheet: {
              properties: {
                title,
                ...(typedParams.index !== undefined && {
                  index: typedParams.index,
                }),
                ...(typedParams.gridProperties && {
                  gridProperties: typedParams.gridProperties,
                }),
                ...(typedParams.tabColor && {
                  tabColor: typedParams.tabColor,
                }),
              },
            },
          },
        ],
      };

      // Update progress
      if (onProgress) {
        onProgress({ step: "Creating new sheet...", percentage: 50 });
      }

      // Make API request
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId,
        )}:batchUpdate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${oauthToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
      );

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 80 });
      }

      const data = (await response.json()) as {
        replies?: Array<{
          addSheet?: {
            properties?: {
              sheetId?: number;
              title?: string;
              index?: number;
            };
          };
        }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        const errorMessage =
          data.error?.message ?? `API error: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Extract sheet properties from response
      const addSheetReply = data.replies?.[0]?.addSheet;
      const sheetProperties = addSheetReply?.properties;

      // Update progress
      if (onProgress) {
        onProgress({ step: "Sheet created successfully!", percentage: 100 });
      }

      logger.info(`Created sheet "${title}" in spreadsheet ${spreadsheetId}`);

      return {
        success: true,
        sheetId: sheetProperties?.sheetId,
        title: sheetProperties?.title ?? title,
        index: sheetProperties?.index,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Google Sheets create sheet error: ${errorMessage}`);
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
    // At this point, we know value is a primitive type (string, number, boolean, etc.)
    return String(value as string | number | boolean);
  });
}
