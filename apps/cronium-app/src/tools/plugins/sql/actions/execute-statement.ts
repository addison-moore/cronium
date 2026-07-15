import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";
import { sqlCredentialsSchema, executeStatementSchema } from "../schemas";
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
      const result = await driver.run(creds, parsed.statement, bindParams, {
        // High cap so a RETURNING clause isn't truncated; we only surface the
        // affected/returned row count, not the rows themselves.
        maxRows: 1_000_000,
        timeoutMs: parsed.timeoutMs,
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
