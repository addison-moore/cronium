import type { ConnectionTestResult } from "@/lib/tools/connection-test";
import type { SqlCredentials } from "../schemas";

/** Engines the SQL tool supports. Snowflake is a planned later increment. */
export type SqlDialect = "postgres" | "mysql";

/** A driver-normalized read result, JSON-safe and ready for Unified I/O. */
export interface NormalizedQueryResult {
  /** Column names in result order. */
  columns: string[];
  /** Result rows as JSON-safe objects, bounded by the read options. */
  rows: Record<string, unknown>[];
  /** Number of rows returned. */
  rowCount: number;
  /** The read stopped because more rows existed than `maxRows` allowed. */
  truncated: boolean;
  /** The read stopped because `maxBytes` would have been exceeded. */
  bytesExceeded: boolean;
}

export interface SqlReadOptions {
  /** Stop after this many rows; one extra row is read to detect overflow. */
  maxRows: number;
  /** Stop once the accumulated JSON payload would exceed this many bytes. */
  maxBytes: number;
  /** Statement timeout in milliseconds. */
  timeoutMs: number;
}

export interface SqlWriteOptions {
  /** Statement timeout in milliseconds. */
  timeoutMs: number;
}

/**
 * A per-dialect adapter. Implementations `await import()` their driver lazily so
 * the heavy/native module never enters a static (client) bundle, open a
 * short-lived connection per call, and close it in `finally`.
 *
 * Reads and writes are separate because they have different shapes and
 * different risks: a read must be *streamed* and bounded (an unbounded SELECT
 * would otherwise be buffered whole into the app's heap — tool actions run
 * in-process), while a write returns only an affected-row count and has nothing
 * to stream.
 */
export interface SqlDriver {
  dialect: SqlDialect;

  /** Verify credentials with a lightweight `SELECT 1`-style probe. */
  testConnection(credentials: SqlCredentials): Promise<ConnectionTestResult>;

  /**
   * Streamed, bounded read. Pulls rows incrementally (server-side cursor on
   * Postgres, row stream on MySQL) and stops as soon as either limit is hit, so
   * peak memory is bounded by `maxBytes` no matter how large the result would
   * have been. Callers enforce read-only/single-statement guards beforehand.
   */
  query(
    credentials: SqlCredentials,
    sql: string,
    params: Record<string, unknown>,
    opts: SqlReadOptions,
  ): Promise<NormalizedQueryResult>;

  /** Buffered write. Returns the affected (or returned) row count. */
  execute(
    credentials: SqlCredentials,
    sql: string,
    params: Record<string, unknown>,
    opts: SqlWriteOptions,
  ): Promise<{ rowCount: number }>;
}
