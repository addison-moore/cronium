import type { ConnectionTestResult } from "@/lib/tools/connection-test";
import type { SqlCredentials } from "../schemas";

/** Engines the SQL tool supports. Snowflake is a planned later increment. */
export type SqlDialect = "postgres" | "mysql";

/** A driver-normalized query result, JSON-safe and ready for Unified I/O. */
export interface NormalizedQueryResult {
  /** Column names in result order (empty for write statements). */
  columns: string[];
  /** Result rows as JSON-safe objects (empty for write statements). */
  rows: Record<string, unknown>[];
  /**
   * For reads: the number of rows returned (after any cap). For writes: the
   * number of affected rows.
   */
  rowCount: number;
  /** True if a row cap was hit and `rows` was truncated. */
  truncated: boolean;
}

export interface SqlRunOptions {
  /** Maximum rows to return; extras are dropped and `truncated` is set. */
  maxRows: number;
  /** Statement timeout in milliseconds. */
  timeoutMs: number;
}

/**
 * A per-dialect adapter. Implementations `await import()` their driver lazily so
 * the heavy/native module never enters a static (client) bundle, open a
 * short-lived connection per call, and close it in `finally`.
 */
export interface SqlDriver {
  dialect: SqlDialect;
  /** Verify credentials with a lightweight `SELECT 1`. */
  testConnection(credentials: SqlCredentials): Promise<ConnectionTestResult>;
  /**
   * Run `sql` (with `:name` placeholders) binding `params`, normalizing the
   * result. Callers enforce read-only/single-statement guards before this.
   */
  run(
    credentials: SqlCredentials,
    sql: string,
    params: Record<string, unknown>,
    opts: SqlRunOptions,
  ): Promise<NormalizedQueryResult>;
}
