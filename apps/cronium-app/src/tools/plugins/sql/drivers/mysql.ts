import {
  type ConnectionTestResult,
  testFailure,
} from "@/lib/tools/connection-test";
import type { SqlCredentials } from "../schemas";
import { defaultPort } from "../schemas";
import type { NormalizedQueryResult, SqlDriver, SqlRunOptions } from "./types";
import { normalizeRows, rewriteNamedPlaceholders } from "./sql-helpers";

// `mysql2` is imported dynamically inside each method so the driver stays out of
// static bundles; it is only reached server-side.
async function connect(credentials: SqlCredentials, timeoutMs: number) {
  const mysql = await import("mysql2/promise");
  return mysql.createConnection({
    host: credentials.host,
    port: credentials.port ?? defaultPort("mysql"),
    database: credentials.database,
    user: credentials.user,
    // Preserve precision: return BIGINT/DECIMAL as strings so nothing is lost
    // and everything is JSON-safe for Unified I/O.
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    connectTimeout: Math.min(timeoutMs, 10_000),
    ...(credentials.password ? { password: credentials.password } : {}),
    ...(credentials.ssl === "disable"
      ? {}
      : { ssl: { rejectUnauthorized: credentials.ssl === "verify-full" } }),
  });
}

export const mysqlDriver: SqlDriver = {
  dialect: "mysql",

  async testConnection(
    credentials: SqlCredentials,
  ): Promise<ConnectionTestResult> {
    let conn: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      conn = await connect(credentials, 10_000);
      const [rows] = await conn.query("SELECT VERSION() AS version");
      const version =
        (Array.isArray(rows) ? (rows[0] as { version?: string }) : undefined)
          ?.version ?? "unknown";
      return {
        success: true,
        message: "Connected to MySQL",
        details: { database: credentials.database, server: version },
      };
    } catch (error) {
      return testFailure(
        `MySQL connection failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    } finally {
      await conn?.end().catch(() => undefined);
    }
  },

  async run(
    credentials: SqlCredentials,
    sql: string,
    params: Record<string, unknown>,
    opts: SqlRunOptions,
  ): Promise<NormalizedQueryResult> {
    const { text, values } = rewriteNamedPlaceholders(sql, params, "question");
    let conn: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      conn = await connect(credentials, opts.timeoutMs);
      const [result, fields] = await conn.query({
        sql: text,
        values,
        timeout: opts.timeoutMs,
      });

      // SELECT-like statements return an array of row objects; writes return a
      // ResultSetHeader with affectedRows.
      if (Array.isArray(result)) {
        const rawRows = result as Record<string, unknown>[];
        const columns = (fields ?? []).map((f) => f.name);
        const truncated = rawRows.length > opts.maxRows;
        const capped = truncated ? rawRows.slice(0, opts.maxRows) : rawRows;
        return {
          columns,
          rows: normalizeRows(capped),
          rowCount: capped.length,
          truncated,
        };
      }

      const header = result as { affectedRows?: number };
      return {
        columns: [],
        rows: [],
        rowCount: header.affectedRows ?? 0,
        truncated: false,
      };
    } finally {
      await conn?.end().catch(() => undefined);
    }
  },
};
