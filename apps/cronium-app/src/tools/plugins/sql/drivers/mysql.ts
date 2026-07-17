import {
  type ConnectionTestResult,
  testFailure,
} from "@/lib/tools/connection-test";
import type { SqlCredentials } from "../schemas";
import { defaultPort } from "../schemas";
import type {
  NormalizedQueryResult,
  SqlDriver,
  SqlReadOptions,
  SqlWriteOptions,
} from "./types";
import { createRowAccumulator, rewriteNamedPlaceholders } from "./sql-helpers";

// `mysql2` is imported dynamically inside each method so it stays out of static
// bundles; it is only reached server-side.
function baseConfig(credentials: SqlCredentials, timeoutMs: number) {
  return {
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
  };
}

async function connectPromise(credentials: SqlCredentials, timeoutMs: number) {
  const mysql = await import("mysql2/promise");
  return mysql.createConnection(baseConfig(credentials, timeoutMs));
}

export const mysqlDriver: SqlDriver = {
  dialect: "mysql",

  async testConnection(
    credentials: SqlCredentials,
  ): Promise<ConnectionTestResult> {
    let conn: Awaited<ReturnType<typeof connectPromise>> | undefined;
    try {
      conn = await connectPromise(credentials, 10_000);
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

  async query(
    credentials: SqlCredentials,
    sql: string,
    params: Record<string, unknown>,
    opts: SqlReadOptions,
  ): Promise<NormalizedQueryResult> {
    const { text, values } = rewriteNamedPlaceholders(sql, params, "question");
    // The core (callback) API is used here rather than mysql2/promise: only it
    // exposes Query.stream(), and streaming is the whole point — we stop pulling
    // as soon as a limit is hit instead of buffering the result.
    const mysql = await import("mysql2");
    const conn = mysql.createConnection(
      baseConfig(credentials, opts.timeoutMs),
    );
    // A connection 'error' with no listener would be an unhandled EventEmitter
    // error and take down the app process. The real error still surfaces via
    // connect()/the stream below, which is what we report.
    conn.on("error", () => undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        conn.connect((err) => (err ? reject(err) : resolve()));
      });

      const acc = createRowAccumulator(opts.maxRows, opts.maxBytes);
      let columns: string[] = [];
      const q = conn.query({ sql: text, values, timeout: opts.timeoutMs });
      q.on("fields", (fields: { name: string }[] | undefined) => {
        if (columns.length === 0) columns = (fields ?? []).map((f) => f.name);
      });

      const stream = q.stream({ highWaterMark: 256 });
      for await (const row of stream) {
        if (!acc.push(row as Record<string, unknown>)) break; // destroys the stream
      }

      return {
        columns,
        rows: acc.rows,
        rowCount: acc.rows.length,
        truncated: acc.truncated,
        bytesExceeded: acc.bytesExceeded,
      };
    } finally {
      // destroy() rather than end(): on an early stop we do not want to wait for
      // the server to finish sending the rest of the result.
      conn.destroy();
    }
  },

  async execute(
    credentials: SqlCredentials,
    sql: string,
    params: Record<string, unknown>,
    opts: SqlWriteOptions,
  ): Promise<{ rowCount: number }> {
    const { text, values } = rewriteNamedPlaceholders(sql, params, "question");
    let conn: Awaited<ReturnType<typeof connectPromise>> | undefined;
    try {
      conn = await connectPromise(credentials, opts.timeoutMs);
      const [result] = await conn.query({
        sql: text,
        values,
        timeout: opts.timeoutMs,
      });
      // SELECT-like returns an array of rows; a write returns a ResultSetHeader.
      if (Array.isArray(result)) return { rowCount: result.length };
      return {
        rowCount: (result as { affectedRows?: number }).affectedRows ?? 0,
      };
    } finally {
      await conn?.end().catch(() => undefined);
    }
  },
};
