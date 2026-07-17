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

// Rows pulled per cursor round-trip. Small enough to bound memory, large enough
// that a 10k-row read is ~10 round-trips rather than 10k.
const BATCH_SIZE = 1_000;

// `pg` / `pg-cursor` are imported dynamically inside each method so they never
// enter a static bundle; they are only ever reached server-side (tool actions
// run in-process in the app).
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

/**
 * Promisified `cursor.read` that also surfaces the result's field metadata (the
 * promise form of pg-cursor's read() returns rows only, and we need column
 * names — including for an empty result).
 */
function readBatch(
  cursor: {
    read: (
      n: number,
      cb: (
        err: Error | undefined,
        rows: Record<string, unknown>[],
        result: { fields?: { name: string }[] },
      ) => void,
    ) => void;
  },
  n: number,
): Promise<{ rows: Record<string, unknown>[]; fields: string[] }> {
  return new Promise((resolve, reject) => {
    cursor.read(n, (err, rows, result) => {
      if (err) reject(err);
      else resolve({ rows, fields: (result?.fields ?? []).map((f) => f.name) });
    });
  });
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

  async query(
    credentials: SqlCredentials,
    sql: string,
    params: Record<string, unknown>,
    opts: SqlReadOptions,
  ): Promise<NormalizedQueryResult> {
    const { text, values } = rewriteNamedPlaceholders(sql, params, "dollar");
    const Cursor = (await import("pg-cursor")).default;
    let client: Awaited<ReturnType<typeof connect>> | undefined;
    let cursor: InstanceType<typeof Cursor> | undefined;
    try {
      client = await connect(credentials, opts.timeoutMs);
      // A cursor streams the result: rows are pulled a batch at a time and we
      // stop the moment a limit is hit, so an unbounded SELECT never lands in
      // the app's heap.
      cursor = client.query(new Cursor(text, values));
      const acc = createRowAccumulator(opts.maxRows, opts.maxBytes);
      let columns: string[] = [];
      let exhausted = false;

      while (!exhausted) {
        // Read at most one row past the cap so overflow is detectable without
        // pulling the remainder of the result.
        const want = Math.min(BATCH_SIZE, opts.maxRows - acc.rows.length + 1);
        if (want <= 0) break;
        const { rows: batch, fields } = await readBatch(cursor, want);
        if (columns.length === 0 && fields.length > 0) columns = fields;
        if (batch.length === 0) break;
        for (const row of batch) {
          if (!acc.push(row)) {
            exhausted = true;
            break;
          }
        }
        if (batch.length < want) break;
      }

      return {
        columns,
        rows: acc.rows,
        rowCount: acc.rows.length,
        truncated: acc.truncated,
        bytesExceeded: acc.bytesExceeded,
      };
    } finally {
      await cursor?.close().catch(() => undefined);
      await client?.end().catch(() => undefined);
    }
  },

  async execute(
    credentials: SqlCredentials,
    sql: string,
    params: Record<string, unknown>,
    opts: SqlWriteOptions,
  ): Promise<{ rowCount: number }> {
    const { text, values } = rewriteNamedPlaceholders(sql, params, "dollar");
    let client: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      client = await connect(credentials, opts.timeoutMs);
      const res = await client.query({ text, values });
      // pg reports affected rows for INSERT/UPDATE/DELETE, and the returned row
      // count when RETURNING is used.
      return { rowCount: res.rowCount ?? res.rows?.length ?? 0 };
    } finally {
      await client?.end().catch(() => undefined);
    }
  },
};
