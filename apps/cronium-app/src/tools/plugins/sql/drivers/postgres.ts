import {
  type ConnectionTestResult,
  testFailure,
} from "@/lib/tools/connection-test";
import type { SqlCredentials } from "../schemas";
import { defaultPort } from "../schemas";
import type { NormalizedQueryResult, SqlDriver, SqlRunOptions } from "./types";
import { normalizeRows, rewriteNamedPlaceholders } from "./sql-helpers";

// `pg` is imported dynamically inside each method so the driver never enters a
// static bundle; it is only ever reached server-side (tool actions run
// in-process in the app). Typed loosely to avoid a static type dependency.
async function connect(credentials: SqlCredentials, timeoutMs: number) {
  const { Client } = await import("pg");
  const client = new Client({
    host: credentials.host,
    port: credentials.port ?? defaultPort("postgres"),
    database: credentials.database,
    user: credentials.user,
    password: credentials.password || undefined,
    ssl: sslConfig(credentials.ssl),
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs,
    connectionTimeoutMillis: Math.min(timeoutMs, 10_000),
    application_name: "cronium",
  });
  await client.connect();
  return client;
}

function sslConfig(
  ssl: SqlCredentials["ssl"],
): false | { rejectUnauthorized: boolean } {
  if (ssl === "disable") return false;
  return { rejectUnauthorized: ssl === "verify-full" };
}

export const postgresDriver: SqlDriver = {
  dialect: "postgres",

  async testConnection(
    credentials: SqlCredentials,
  ): Promise<ConnectionTestResult> {
    let client: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      client = await connect(credentials, 10_000);
      const res = await client.query("SELECT version() AS version");
      const version =
        (res.rows[0] as { version?: string } | undefined)?.version ?? "unknown";
      return {
        success: true,
        message: "Connected to PostgreSQL",
        details: {
          database: credentials.database,
          server: version.split(" ").slice(0, 2).join(" "),
        },
      };
    } catch (error) {
      return testFailure(
        `PostgreSQL connection failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    } finally {
      await client?.end().catch(() => undefined);
    }
  },

  async run(
    credentials: SqlCredentials,
    sql: string,
    params: Record<string, unknown>,
    opts: SqlRunOptions,
  ): Promise<NormalizedQueryResult> {
    const { text, values } = rewriteNamedPlaceholders(sql, params, "dollar");
    let client: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      client = await connect(credentials, opts.timeoutMs);
      const res = await client.query({ text, values });
      const rawRows = (res.rows ?? []) as Record<string, unknown>[];
      const columns = (res.fields ?? []).map((f) => f.name);
      const truncated = rawRows.length > opts.maxRows;
      const capped = truncated ? rawRows.slice(0, opts.maxRows) : rawRows;
      const isRead = columns.length > 0 || capped.length > 0;
      return {
        columns,
        rows: normalizeRows(capped),
        rowCount: isRead ? capped.length : (res.rowCount ?? 0),
        truncated,
      };
    } finally {
      await client?.end().catch(() => undefined);
    }
  },
};
