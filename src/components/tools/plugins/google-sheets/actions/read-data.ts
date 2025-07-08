import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for read-data action parameters
export const readDataSchema = z.object({
  spreadsheetId: z
    .string()
    .describe("The ID of the spreadsheet (from the URL)"),
  range: z
    .string()
    .describe("The A1 notation of the range to read (e.g., 'Sheet1!A1:C10')"),
  valueRenderOption: z
    .enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"])
    .optional()
    .default("FORMATTED_VALUE")
    .describe("How values should be represented"),
  dateTimeRenderOption: z
    .enum(["SERIAL_NUMBER", "FORMATTED_STRING"])
    .optional()
    .default("FORMATTED_STRING")
    .describe("How dates should be represented"),
  majorDimension: z
    .enum(["ROWS", "COLUMNS"])
    .optional()
    .default("ROWS")
    .describe("The major dimension of the values"),
});

export type ReadDataParams = z.infer<typeof readDataSchema>;

export const readDataAction: ToolAction = {
  id: "read-data",
  name: "Read Data",
  description: "Read data from a Google Sheets spreadsheet",
  category: "Data Operations",
  actionType: "search",
  developmentMode: "visual",
  inputSchema: readDataSchema,
  parameters: zodToParameters(readDataSchema),
  outputSchema: z.object({
    success: z.boolean(),
    range: z.string().optional(),
    majorDimension: z.string().optional(),
    values: z.array(z.array(z.any())).optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Read Basic Range",
      description: "Read data from a simple range",
      input: {
        spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
        range: "Sheet1!A1:C10",
      },
      output: {
        success: true,
        range: "Sheet1!A1:C10",
        majorDimension: "ROWS",
        values: [
          ["Name", "Age", "City"],
          ["John Doe", "30", "New York"],
          ["Jane Smith", "25", "Los Angeles"],
        ],
      },
    },
    {
      name: "Read with Formulas",
      description: "Read formulas instead of values",
      input: {
        spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
        range: "Sheet1!D1:D10",
        valueRenderOption: "FORMULA",
      },
      output: {
        success: true,
        range: "Sheet1!D1:D10",
        majorDimension: "ROWS",
        values: [["=SUM(B:B)"], ['=A2&" - "&C2']],
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as ReadDataParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing to read data...", percentage: 10 });
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
      const range = replaceVariables(typedParams.range, variables);

      if (isTest) {
        // Test mode - return sample data
        if (onProgress) {
          onProgress({
            step: "Test mode - returning sample data...",
            percentage: 50,
          });
        }

        const sampleData = [
          ["Name", "Sales", "Date"],
          ["Product A", "1500", "2024-01-15"],
          ["Product B", "2300", "2024-01-16"],
          ["Product C", "1800", "2024-01-17"],
        ];

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          range,
          majorDimension: typedParams.majorDimension,
          values: sampleData,
        };
      }

      // Update progress
      if (onProgress) {
        onProgress({
          step: "Connecting to Google Sheets API...",
          percentage: 30,
        });
      }

      // Build API URL
      const url = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId,
        )}/values/${encodeURIComponent(range)}`,
      );

      // Add query parameters
      url.searchParams.append(
        "valueRenderOption",
        typedParams.valueRenderOption || "FORMATTED_VALUE",
      );
      url.searchParams.append(
        "dateTimeRenderOption",
        typedParams.dateTimeRenderOption || "FORMATTED_STRING",
      );
      url.searchParams.append(
        "majorDimension",
        typedParams.majorDimension || "ROWS",
      );

      // Make API request
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
      });

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 70 });
      }

      const data = (await response.json()) as {
        range?: string;
        majorDimension?: string;
        values?: unknown[][];
        error?: { message?: string };
      };

      if (!response.ok) {
        const errorMessage =
          data.error?.message ?? `API error: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Data retrieved successfully!", percentage: 100 });
      }

      logger.info(
        `Retrieved ${data.values?.length ?? 0} rows from ${spreadsheetId}`,
      );

      return {
        success: true,
        range: data.range,
        majorDimension: data.majorDimension,
        values: data.values ?? [],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Google Sheets read error: ${errorMessage}`);
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
