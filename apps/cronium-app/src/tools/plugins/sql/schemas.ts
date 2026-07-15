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
  .optional();

const timeoutMs = z.coerce
  .number()
  .int()
  .positive()
  .max(600_000)
  .optional()
  .default(30_000);

export const runQuerySchema = z.object({
  query: z.string().min(1, "Query is required"),
  params: paramsMap,
  maxRows: z.coerce
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .optional()
    .default(10_000),
  timeoutMs,
});
export type RunQueryParams = z.infer<typeof runQuerySchema>;

export const executeStatementSchema = z.object({
  statement: z.string().min(1, "Statement is required"),
  params: paramsMap,
  timeoutMs,
});
export type ExecuteStatementParams = z.infer<typeof executeStatementSchema>;
