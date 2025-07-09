import { z } from "zod";
import type {
  ToolAction,
  ExecutionContext,
} from "@/components/tools/types/tool-plugin";
import { zodToParameters } from "@/components/tools/utils/zod-to-parameters";

// Schema for write-data action parameters
export const writeDataSchema = z.object({
  spreadsheetId: z
    .string()
    .describe("The ID of the spreadsheet (from the URL)"),
  range: z
    .string()
    .describe("The A1 notation of the range to write (e.g., 'Sheet1!A1')"),
  values: z.array(z.array(z.any())).describe("The data to write as a 2D array"),
  valueInputOption: z
    .enum(["RAW", "USER_ENTERED"])
    .optional()
    .default("USER_ENTERED")
    .describe("How the input data should be interpreted"),
  insertDataOption: z
    .enum(["OVERWRITE", "INSERT_ROWS"])
    .optional()
    .default("OVERWRITE")
    .describe("How the input data should be inserted"),
  includeValuesInResponse: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to return the values that were written"),
});

export type WriteDataParams = z.infer<typeof writeDataSchema>;

export const writeDataAction: ToolAction = {
  id: "write-data",
  name: "Write Data",
  description: "Write data to a Google Sheets spreadsheet",
  category: "Data Operations",
  actionType: "update",
  developmentMode: "visual",
  inputSchema: writeDataSchema,
  parameters: zodToParameters(writeDataSchema),
  outputSchema: z.object({
    success: z.boolean(),
    updatedRange: z.string().optional(),
    updatedRows: z.number().optional(),
    updatedColumns: z.number().optional(),
    updatedCells: z.number().optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Write Simple Data",
      description: "Write a simple data table",
      input: {
        spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
        range: "Sheet1!A1",
        values: [
          ["Product", "Price", "Stock"],
          ["Widget A", 19.99, 150],
          ["Widget B", 29.99, 75],
        ],
      },
      output: {
        success: true,
        updatedRange: "Sheet1!A1:C3",
        updatedRows: 3,
        updatedColumns: 3,
        updatedCells: 9,
      },
    },
    {
      name: "Append Data",
      description: "Append new rows to existing data",
      input: {
        spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
        range: "Sheet1!A:C",
        values: [["Widget C", 39.99, 50]],
        insertDataOption: "INSERT_ROWS",
      },
      output: {
        success: true,
        updatedRange: "Sheet1!A4:C4",
        updatedRows: 1,
        updatedColumns: 3,
        updatedCells: 3,
      },
    },
    {
      name: "Write Formulas",
      description: "Write formulas using USER_ENTERED option",
      input: {
        spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
        range: "Sheet1!D2",
        values: [["=B2*C2"], ["=B3*C3"], ["=SUM(D2:D3)"]],
        valueInputOption: "USER_ENTERED",
      },
      output: {
        success: true,
        updatedRange: "Sheet1!D2:D4",
        updatedRows: 3,
        updatedColumns: 1,
        updatedCells: 3,
      },
    },
  ],
  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const typedParams = params as WriteDataParams;
    const { variables, logger, onProgress, isTest } = context;

    try {
      // Update progress
      if (onProgress) {
        onProgress({ step: "Preparing to write data...", percentage: 10 });
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

      // Process values array to replace variables
      const processedValues = typedParams.values.map((row) =>
        row.map((cell): unknown => {
          if (typeof cell === "string") {
            return replaceVariables(cell, variables);
          }
          return cell;
        }),
      );

      if (isTest) {
        // Test mode - simulate success
        if (onProgress) {
          onProgress({
            step: "Test mode - simulating data write...",
            percentage: 50,
          });
        }

        const rows = processedValues.length;
        const cols = processedValues[0]?.length ?? 0;
        const cells = rows * cols;

        if (onProgress) {
          onProgress({ step: "Test completed successfully!", percentage: 100 });
        }

        return {
          success: true,
          updatedRange: `${range}:${calculateEndRange(range, rows, cols)}`,
          updatedRows: rows,
          updatedColumns: cols,
          updatedCells: cells,
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
        "valueInputOption",
        typedParams.valueInputOption || "USER_ENTERED",
      );
      url.searchParams.append(
        "insertDataOption",
        typedParams.insertDataOption || "OVERWRITE",
      );
      url.searchParams.append(
        "includeValuesInResponse",
        String(typedParams.includeValuesInResponse || false),
      );

      // Update progress
      if (onProgress) {
        onProgress({ step: "Writing data to spreadsheet...", percentage: 50 });
      }

      // Make API request
      const response = await fetch(url.toString(), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: processedValues,
        }),
      });

      // Update progress
      if (onProgress) {
        onProgress({ step: "Processing response...", percentage: 80 });
      }

      const data = (await response.json()) as {
        updatedRange?: string;
        updatedRows?: number;
        updatedColumns?: number;
        updatedCells?: number;
        error?: { message?: string };
      };

      if (!response.ok) {
        const errorMessage =
          data.error?.message ?? `API error: ${response.status}`;
        throw new Error(errorMessage);
      }

      // Update progress
      if (onProgress) {
        onProgress({ step: "Data written successfully!", percentage: 100 });
      }

      logger.info(
        `Updated ${data.updatedCells ?? 0} cells in ${spreadsheetId}`,
      );

      return {
        success: true,
        updatedRange: data.updatedRange,
        updatedRows: data.updatedRows,
        updatedColumns: data.updatedColumns,
        updatedCells: data.updatedCells,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      logger.error(`Google Sheets write error: ${errorMessage}`);
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

// Helper function to calculate end range
function calculateEndRange(
  startRange: string,
  rows: number,
  cols: number,
): string {
  // Simple implementation - can be enhanced
  const match = /([A-Z]+)(\d+)/.exec(startRange);
  if (!match) return startRange;

  const startCol = match[1];
  const startRowStr = match[2];
  
  if (!startCol || !startRowStr) return startRange;
  
  const startRow = parseInt(startRowStr);

  // Convert column letter to number and back
  const colNum = startCol.charCodeAt(0) - 65 + cols - 1;
  const endCol = String.fromCharCode(65 + colNum);
  const endRow = startRow + rows - 1;

  return `${endCol}${endRow}`;
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
    return String(value);
  });
}
