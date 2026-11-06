/**
 * Encrypts values saved before encryption at rest (HI-09, July 2026).
 *
 * `webhooks.secret`, `webhooks.headers` and `user_variables.value` were plaintext
 * until then. Their read paths still pass such a value through, and nothing
 * rewrites it unless someone changes that exact field, so a row nobody edited
 * stays readable in every copy of the database. Fixing that needs the vault, so
 * it can't be a SQL migration. `rotate:secrets --encrypt-legacy` runs this pass.
 *
 *   - Readers don't change. An envelope decrypts to the string they used to read
 *     directly, so signatures, custom headers and variables behave as before.
 *   - Safe to stop and repeat. Each row is one UPDATE, and a row with nothing left
 *     to encrypt isn't written, so a second run changes nothing and a run after an
 *     interruption only does the rest.
 *   - A row is all or nothing. If any value in it can't be read the way the app
 *     would read it, the row is reported and left exactly as it was.
 *   - Never overwrites a newer value. The app keeps running during this, so each
 *     UPDATE only applies to the row version it read. A secret regenerated or a
 *     variable renamed in between is left alone. Comparing `xmin` rather than the
 *     old value also keeps the plaintext out of the statement, and so out of
 *     Postgres's logs and Drizzle's error messages.
 *   - Reports never hold a value. A failure gives the row id, the column and one of
 *     a fixed set of reasons: vault errors can quote parts of what they were given,
 *     which here could be a plaintext secret.
 */
import { asc, and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { userVariables, webhooks } from "@/shared/schema";
import { driverError } from "@/lib/pg-errors";
import {
  getSecretVault,
  isSecretEnvelope,
  SecretDecryptionError,
} from "@/lib/security/secret-vault";
import {
  decryptVariableValue,
  encryptVariableValue,
} from "@/lib/security/variable-secret";
import {
  decryptWebhookHeaders,
  decryptWebhookSecret,
  encryptWebhookHeaders,
  encryptWebhookSecret,
  isLegacyWebhookHeaders,
} from "@/lib/webhooks/webhook-secret";

export interface LegacySurfaceResult {
  surface: "webhooks" | "user_variables";
  scanned: number;
  /** Rows written, or in a dry run, rows that would be. */
  encrypted: number;
  /** Rows with nothing to encrypt. */
  upToDate: number;
  /** Rows someone else changed between this run's read and its write. */
  changedDuringRun: number;
  /** Rows left as they were because a value or the write failed. */
  failed: number;
}

export interface LegacyRowFailure {
  surface: LegacySurfaceResult["surface"];
  id: number;
  column: string;
  reason: string;
}

export interface LegacySecretsReport {
  dryRun: boolean;
  surfaces: LegacySurfaceResult[];
  failures: LegacyRowFailure[];
  totalEncrypted: number;
  /**
   * Rows that still hold a plaintext value or one the app can't read. After a real
   * run this is counted again from the database rather than from this run's tallies,
   * so it also covers rows that changed while the run was going.
   */
  remaining: number;
}

/** Thrown before anything is written when this keyring looks like the wrong one. */
export class LegacySecretsRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacySecretsRefusedError";
  }
}

class NotAHeaderObjectError extends Error {}

class DoesNotReadBackError extends Error {}

function failureReason(error: unknown): string {
  if (error instanceof SecretDecryptionError) {
    return "looks encrypted, but this keyring can't decrypt it for this row";
  }
  if (error instanceof NotAHeaderObjectError) {
    return "not a JSON object of headers";
  }
  if (error instanceof DoesNotReadBackError) {
    return "did not read back unchanged after encrypting";
  }
  const { code } = driverError(error);
  if (code) return `database error ${code}`;
  return error instanceof Error ? error.name : "unknown error";
}

/** The new stored value for a text column, or undefined if it needs none. */
function encryptedText(
  stored: string,
  encrypt: (plaintext: string) => string,
  decrypt: (stored: string) => string,
): string | undefined {
  if (!stored) return undefined; // nothing to protect
  if (isSecretEnvelope(stored)) {
    // Throws if the app couldn't read it either. That includes a plaintext value
    // that merely starts with `crn.`, which the read path also treats as an
    // envelope, so it has to be fixed by whoever owns it rather than guessed at.
    decrypt(stored);
    return undefined;
  }
  const next = encrypt(stored);
  if (decrypt(next) !== stored) throw new DoesNotReadBackError();
  return next;
}

/** The new stored value for `webhooks.headers`, or undefined if it needs none. */
function encryptedHeaders(
  stored: unknown,
  webhookKey: string,
  userId: string,
): object | undefined {
  if (isLegacyWebhookHeaders(stored)) {
    const headers = stored as Record<string, string>;
    const next = encryptWebhookHeaders(headers, webhookKey, userId);
    const readBack = decryptWebhookHeaders(next, webhookKey, userId);
    if (JSON.stringify(readBack) !== JSON.stringify(headers)) {
      throw new DoesNotReadBackError();
    }
    return next;
  }
  if (!stored) return undefined; // nothing to protect
  if (
    typeof stored !== "object" ||
    (Array.isArray(stored) && stored.length > 0)
  ) {
    // No code path writes this and deliveries can't use it, but it could still hold
    // a credential, so it isn't skipped as if it were empty.
    throw new NotAHeaderObjectError();
  }
  decryptWebhookHeaders(stored, webhookKey, userId); // throws if unreadable
  return undefined;
}

/** Selected alongside a row so its UPDATE can require the same version. */
const rowVersion = sql<string>`xmin::text`;
const isRowVersion = (version: string) => sql`xmin::text = ${version}`;

async function upgradeRow(
  result: LegacySurfaceResult,
  failures: LegacyRowFailure[],
  dryRun: boolean,
  id: number,
  columns: Record<string, () => unknown>,
  write: (set: Record<string, unknown>) => Promise<number>,
): Promise<void> {
  result.scanned++;
  const fail = (column: string, error: unknown) =>
    failures.push({
      surface: result.surface,
      id,
      column,
      reason: failureReason(error),
    });

  const set: Record<string, unknown> = {};
  let readable = true;
  for (const [column, encrypted] of Object.entries(columns)) {
    try {
      const next = encrypted();
      if (next !== undefined) set[column] = next;
    } catch (error) {
      readable = false;
      fail(column, error);
    }
  }
  if (!readable) {
    result.failed++;
    return;
  }
  if (Object.keys(set).length === 0) {
    result.upToDate++;
    return;
  }
  if (dryRun) {
    result.encrypted++;
    return;
  }
  try {
    if ((await write(set)) > 0) result.encrypted++;
    else result.changedDuringRun++;
  } catch (error) {
    result.failed++;
    fail(Object.keys(set).join("+"), error);
  }
}

function emptyResult(
  surface: LegacySurfaceResult["surface"],
): LegacySurfaceResult {
  return {
    surface,
    scanned: 0,
    encrypted: 0,
    upToDate: 0,
    changedDuringRun: 0,
    failed: 0,
  };
}

async function upgradeWebhooks(
  dryRun: boolean,
  failures: LegacyRowFailure[],
): Promise<LegacySurfaceResult> {
  const result = emptyResult("webhooks");
  const rows = await db
    .select({
      id: webhooks.id,
      userId: webhooks.userId,
      key: webhooks.key,
      secret: webhooks.secret,
      headers: webhooks.headers,
      version: rowVersion,
    })
    .from(webhooks)
    .orderBy(asc(webhooks.id));

  for (const row of rows) {
    await upgradeRow(
      result,
      failures,
      dryRun,
      row.id,
      {
        secret: () =>
          encryptedText(
            row.secret,
            (value) => encryptWebhookSecret(value, row.key, row.userId),
            (value) => decryptWebhookSecret(value, row.key, row.userId),
          ),
        headers: () => encryptedHeaders(row.headers, row.key, row.userId),
      },
      async (set) => {
        const written = await db
          .update(webhooks)
          .set(set)
          .where(and(eq(webhooks.id, row.id), isRowVersion(row.version)));
        return written.rowCount ?? 0;
      },
    );
  }
  return result;
}

async function upgradeUserVariables(
  dryRun: boolean,
  failures: LegacyRowFailure[],
): Promise<LegacySurfaceResult> {
  const result = emptyResult("user_variables");
  const rows = await db
    .select({
      id: userVariables.id,
      userId: userVariables.userId,
      key: userVariables.key,
      value: userVariables.value,
      version: rowVersion,
    })
    .from(userVariables)
    .orderBy(asc(userVariables.id));

  for (const row of rows) {
    await upgradeRow(
      result,
      failures,
      dryRun,
      row.id,
      {
        value: () =>
          encryptedText(
            row.value,
            (value) => encryptVariableValue(value, row.userId, row.key),
            (value) => decryptVariableValue(value, row.userId, row.key),
          ),
      },
      async (set) => {
        const written = await db
          .update(userVariables)
          .set(set)
          .where(and(eq(userVariables.id, row.id), isRowVersion(row.version)));
        return written.rowCount ?? 0;
      },
    );
  }
  return result;
}

/**
 * Encrypting under a key the app doesn't have would lock it out of these rows, and
 * unlike a failed read, nothing would show until someone needed one. A database
 * restored next to a freshly generated `.env` gets here easily. So if the database
 * holds envelopes and this keyring has none of their keys, stop before writing.
 * With no envelopes anywhere there is nothing to compare against, which is why the
 * docs say to back up first.
 */
async function assertKeyringFitsDatabase(): Promise<void> {
  const keyring = getSecretVault()
    .keyIds()
    .map((entry) => entry.keyId);

  const { rows } = await db.execute<{ key_id: string }>(sql`
    SELECT DISTINCT split_part(stored, '.', 3) AS key_id
    FROM (
      SELECT secret AS stored FROM webhooks
      UNION ALL SELECT headers->>'__enc' FROM webhooks
      UNION ALL SELECT value FROM user_variables
      UNION ALL SELECT ssh_key FROM servers
      UNION ALL SELECT password FROM servers
      UNION ALL SELECT value FROM env_vars
      UNION ALL SELECT value FROM system_settings
      UNION ALL SELECT mfa_secret FROM users
    ) AS all_stored
    WHERE stored LIKE 'crn.1.%'
  `);
  if (rows.length === 0) return;
  if (rows.some((row) => keyring.includes(row.key_id))) return;

  throw new LegacySecretsRefusedError(
    `This database holds encrypted values, but none of them use a key in this keyring (active key ${String(keyring[0])}). ` +
      "ENCRYPTION_KEY is probably not the one the app runs with, and encrypting with it would lock the app out of these rows. Nothing was changed.",
  );
}

async function runPass(
  dryRun: boolean,
  failures: LegacyRowFailure[],
): Promise<LegacySurfaceResult[]> {
  return [
    await upgradeWebhooks(dryRun, failures),
    await upgradeUserVariables(dryRun, failures),
  ];
}

/**
 * Encrypt every legacy plaintext webhook secret, webhook header set and user
 * variable under its record binding. See the file header for what makes this safe
 * to run on a live instance. Throws before reading a row if the vault has no usable
 * key or the keyring doesn't fit the database.
 */
export async function encryptLegacySecrets(
  opts: { dryRun?: boolean } = {},
): Promise<LegacySecretsReport> {
  const dryRun = opts.dryRun ?? false;
  await assertKeyringFitsDatabase();

  const failures: LegacyRowFailure[] = [];
  const surfaces = await runPass(dryRun, failures);
  const after = dryRun ? surfaces : await runPass(true, []);

  return {
    dryRun,
    surfaces,
    failures,
    totalEncrypted: surfaces.reduce((n, s) => n + s.encrypted, 0),
    remaining: after.reduce((n, s) => n + s.encrypted + s.failed, 0),
  };
}

/**
 * A line for the worker's boot log when rows still need `--encrypt-legacy`, or null.
 * The worker only reports. Encrypting rewrites secrets with whatever key the process
 * has, and a dev worker points at a shared database, so an operator starts it.
 */
export async function legacySecretsBootWarning(): Promise<string | null> {
  const { remaining } = await encryptLegacySecrets({ dryRun: true });
  if (remaining === 0) return null;
  return (
    `${String(remaining)} webhook or user-variable row(s) still hold plaintext from before encryption at rest. ` +
    "To encrypt them, run: node apps/cronium-app/dist/rotate-secrets.cjs --encrypt-legacy (docs/ENVIRONMENT_VARIABLES.md)"
  );
}
