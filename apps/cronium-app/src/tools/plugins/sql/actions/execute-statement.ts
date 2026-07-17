import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";
import {
  sqlCredentialsSchema,
  executeStatementSchema,
  DEFAULT_SQL_TIMEOUT_MS,
} from "../schemas";
import { getDriver } from "../drivers";
import {
  assertSingleStatement,
  coerceBindParams,
} from "../drivers/sql-helpers";

export const executeStatementAction: ToolAction = {
  id: "execute-statement",
  name: "Execute Statement",
  description:
    "Run a write statement (INSERT/UPDATE/DELETE/DDL) and return the number of " +
    "affected rows. Runs once (not retried).",
  category: "Data Operations",
  actionType: "update",
  actionTypeColor: "orange",
  developmentMode: "visual",
  inputSchema: executeStatementSchema,
  parameters: safeZodToParameters(executeStatementSchema),
  outputSchema: z.object({
    rowCount: z.number().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
  }),
  // A write's affected-row count is not workflow input data.
  producesOutput: false,
  helpText:
    "Use :named placeholders and supply values in Parameters (JSON). Only a " +
    "single statement is allowed. This is the explicit write path; Run Query " +
    "rejects mutations.",
  examples: [
    {
      name: "Update a row by id",
      description: "Parameterized UPDATE returning the affected row count",
      input: {
        statement: "UPDATE orders SET status = :status WHERE id = :id",
        params: { status: "shipped", id: "1001" },
      },
      output: { rowCount: 1 },
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
      const parsed = executeStatementSchema.parse(params);
      const bindParams = coerceBindParams(parsed.params);

      assertSingleStatement(parsed.statement);

      const driver = getDriver(creds.dialect);
      // Writes are buffered, not streamed: they return an affected-row count,
      // not rows, so there is nothing to bound.
      const result = await driver.execute(creds, parsed.statement, bindParams, {
        timeoutMs: context.timeoutMs ?? DEFAULT_SQL_TIMEOUT_MS,
      });

      logger.info(
        `SQL statement affected ${result.rowCount} row(s) on ${creds.dialect}`,
      );
      return { rowCount: result.rowCount };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown SQL error";
      logger.error(`SQL execute-statement failed: ${message}`);
      return { success: false, error: message };
    }
  },
};
