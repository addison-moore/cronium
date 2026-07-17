import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";
import {
  sqlCredentialsSchema,
  runQuerySchema,
  DEFAULT_MAX_ROWS,
  DEFAULT_SQL_TIMEOUT_MS,
} from "../schemas";
import { MAX_UNIFIED_IO_OUTPUT_BYTES, toMb } from "@/lib/unified-io/limits";
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
    success: z.boolean().optional(),
    error: z.string().optional(),
  }),
  // Read action: its rows flow into Unified I/O so the next event's
  // cronium.input() receives { columns, rows, rowCount }.
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

      const maxRows = parsed.maxRows ?? DEFAULT_MAX_ROWS;
      const driver = getDriver(creds.dialect);
      // The driver streams and stops at whichever limit is hit first, so peak
      // memory is bounded by maxBytes regardless of how large the result set is.
      const result = await driver.query(creds, parsed.query, bindParams, {
        maxRows,
        maxBytes: MAX_UNIFIED_IO_OUTPUT_BYTES,
        timeoutMs: context.timeoutMs ?? DEFAULT_SQL_TIMEOUT_MS,
      });

      // Never hand back a silently-shortened result: an ETL that received 10k of
      // 15k rows would look successful while dropping data. Fail with the fix.
      if (result.bytesExceeded) {
        throw new Error(
          `Query result exceeds the ${toMb(MAX_UNIFIED_IO_OUTPUT_BYTES)} MB limit for data passed between events. ` +
            `Select fewer columns or rows, or move bulk work to a server-side INSERT ... SELECT (Execute Statement) ` +
            `or a Script event that streams.`,
        );
      }
      if (result.truncated) {
        throw new Error(
          `Query returned more than ${maxRows} rows. Add a LIMIT to the query, or raise Max Rows. ` +
            `For large extracts, prefer a server-side INSERT ... SELECT (Execute Statement) or a Script event that streams, ` +
            `rather than passing every row between events.`,
        );
      }

      logger.info(
        `SQL query returned ${result.rowCount} row(s) from ${creds.dialect}`,
      );

      return {
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown SQL error";
      logger.error(`SQL run-query failed: ${message}`);
      return { success: false, error: message };
    }
  },
};
