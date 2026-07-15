import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";
import { sqlCredentialsSchema, runQuerySchema } from "../schemas";
import { getDriver } from "../drivers";
import {
  assertReadOnlyStatement,
  coerceBindParams,
} from "../drivers/sql-helpers";

export const runQueryAction: ToolAction = {
  id: "run-query",
  name: "Run Query",
  description:
    "Run a read-only SQL query (SELECT/WITH) and return the rows. The result " +
    "is passed to the next workflow step via cronium.input().",
  category: "Data Operations",
  actionType: "search",
  actionTypeColor: "purple",
  developmentMode: "visual",
  inputSchema: runQuerySchema,
  parameters: safeZodToParameters(runQuerySchema),
  outputSchema: z.object({
    columns: z.array(z.string()).optional(),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    rowCount: z.number().optional(),
    truncated: z.boolean().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
  }),
  // Read action: its rows flow into Unified I/O so the next event's
  // cronium.input() receives { columns, rows, rowCount, truncated }.
  producesOutput: true,
  helpText:
    "Use :named placeholders in the query and supply values in Parameters " +
    "(JSON), e.g. query `SELECT * FROM orders WHERE id = :id` with parameters " +
    '`{ "id": "{{cronium.input.orderId}}" }`. Values are bound safely (no ' +
    "string concatenation). Downstream events read {{cronium.input.rows}}.",
  examples: [
    {
      name: "Fetch rows by id",
      description: "Parameterized SELECT feeding the next workflow step",
      input: {
        query: "SELECT id, email FROM users WHERE id = :id",
        params: { id: "42" },
      },
      output: {
        columns: ["id", "email"],
        rows: [{ id: 42, email: "a@b.com" }],
        rowCount: 1,
        truncated: false,
      },
    },
  ],

  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const { logger } = context;
    try {
      const creds = sqlCredentialsSchema.parse(credentials);
      const parsed = runQuerySchema.parse(params);
      const bindParams = coerceBindParams(parsed.params);

      assertReadOnlyStatement(parsed.query);

      const driver = getDriver(creds.dialect);
      const result = await driver.run(creds, parsed.query, bindParams, {
        maxRows: parsed.maxRows,
        timeoutMs: parsed.timeoutMs,
      });

      logger.info(
        `SQL query returned ${result.rowCount} row(s)${
          result.truncated ? ` (truncated to ${parsed.maxRows})` : ""
        } from ${creds.dialect}`,
      );

      return {
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.truncated,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown SQL error";
      logger.error(`SQL run-query failed: ${message}`);
      return { success: false, error: message };
    }
  },
};
