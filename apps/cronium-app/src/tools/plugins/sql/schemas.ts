import { z } from "zod";

/**
 * Supported SQL engines. Postgres and MySQL share the same host/port/user model,
 * so the credential schema is a single flat object today. Snowflake (account /
 * warehouse / role, no host) diverges enough that adding it will turn this into
 * a `z.discriminatedUnion("dialect", ...)`; the driver interface already fits.
 */
export const SQL_DIALECTS = ["postgres", "mysql"] as const;
export type SqlDialectValue = (typeof SQL_DIALECTS)[number];

export const SSL_MODES = ["disable", "require", "verify-full"] as const;

// `password` is intentionally named to match the secret-key redaction pattern
// (lib/tools/credential-redaction.ts), so it is blanked in API responses and a
// blank submit on edit keeps the stored value.
export const sqlCredentialsSchema = z.object({
  dialect: z.enum(SQL_DIALECTS).default("postgres"),
  host: z.string().min(1, "Host is required"),
  port: z.coerce.number().int().positive().max(65535).optional(),
  database: z.string().min(1, "Database is required"),
  user: z.string().min(1, "User is required"),
  password: z.string().optional().default(""),
  ssl: z.enum(SSL_MODES).default("require"),
});

export type SqlCredentials = z.infer<typeof sqlCredentialsSchema>;

/** Default port per dialect when the user leaves the port field blank. */
export function defaultPort(dialect: SqlDialectValue): number {
  return dialect === "mysql" ? 3306 : 5432;
}

// ---- Action input schemas -------------------------------------------------

// The bind map is `params` (not `parameters`) to avoid nesting under the tool
// config's own `parameters` wrapper. Values may be `{{cronium.input.*}}` /
// `{{cronium.getVariables.*}}` templates; the platform renders them before
// execute(), and the driver binds them safely. Accepts either an object or a
// JSON-string (the generic action form renders a record as a text field);
// `coerceBindParams` normalizes it in execute().
const paramsMap = z
  .union([z.record(z.string(), z.unknown()), z.string()])
  .optional()
  .describe(
    'Optional. JSON object of values for the query\'s :name placeholders, e.g. {"id": "{{cronium.input.orderId}}"}. Values are bound safely (never concatenated into the SQL). Leave blank if the query has no placeholders.',
  );

// Row guardrail. Tool actions run in-process in the app, and the result is held
// in memory, written to job.result (jsonb), and handed to the next step — so an
// unbounded SELECT is a real risk to the app, not just to the query. Exceeding
// the limit FAILS the action rather than silently truncating: quietly returning
// 10k of 15k rows would be data loss an ETL could not detect. Users who need
// more can raise `maxRows` (bounded by MAX_ROWS_CEILING and, ultimately, by the
// Unified I/O byte limit). The statement timeout comes from the event's Timeout
// setting (context.timeoutMs), not a per-action field.
export const DEFAULT_MAX_ROWS = 10_000;
export const MAX_ROWS_CEILING = 1_000_000;
export const DEFAULT_SQL_TIMEOUT_MS = 30_000;

export const runQuerySchema = z.object({
  query: z
    .string()
    .min(1, "Query is required")
    .describe(
      "The SQL query to run (read-only: SELECT/WITH). Use :name placeholders for values and supply them in Parameters. Add LIMIT to cap the number of rows.",
    ),
  params: paramsMap,
  maxRows: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_ROWS_CEILING)
    .optional()
    .describe(
      "Optional. Maximum rows to return (default 10,000). The action fails if the query returns more, rather than silently dropping rows — add a LIMIT or raise this. Very large extracts should use Execute Statement (INSERT ... SELECT) or a Script event instead of passing rows between events.",
    ),
});
export type RunQueryParams = z.infer<typeof runQuerySchema>;

export const executeStatementSchema = z.object({
  statement: z
    .string()
    .min(1, "Statement is required")
    .describe(
      "A single SQL write statement (INSERT/UPDATE/DELETE/DDL). Use :name placeholders for values and supply them in Parameters.",
    ),
  params: paramsMap,
});
export type ExecuteStatementParams = z.infer<typeof executeStatementSchema>;
