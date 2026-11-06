/**
 * What the two passes that rewrite stored secrets share: key rotation and
 * `--encrypt-legacy`. Both run while the app is up, one row at a time.
 */
import { sql } from "drizzle-orm";
import { driverError } from "@/lib/pg-errors";
import { SecretDecryptionError } from "@/lib/security/secret-vault";

/**
 * Selected alongside a row so its UPDATE can require the same version, which leaves a
 * row changed in between alone. Comparing `xmin` rather than the old value also keeps
 * that value out of the statement, and so out of Postgres's logs and Drizzle's error
 * messages.
 */
export const rowVersion = sql<string>`xmin::text`;
export const isRowVersion = (version: string) => sql`xmin::text = ${version}`;

/**
 * Why a row failed, safe to print. An error's own message isn't: a vault error can quote
 * part of what it was given, which may be a plaintext secret, JSON.parse quotes its
 * input, and Drizzle's message repeats every parameter of the statement.
 */
export function secretRowFailureReason(error: unknown): string {
  if (error instanceof SecretDecryptionError) {
    return "looks encrypted, but this keyring can't decrypt it for this row";
  }
  const { code } = driverError(error);
  if (code) return `database error ${code}`;
  return error instanceof Error ? error.name : "unknown error";
}
