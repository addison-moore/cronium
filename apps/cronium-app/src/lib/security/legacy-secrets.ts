/**
 * Encrypts what's still stored the way it was before the vault.
 *
 *   - `webhooks.secret`, `webhooks.headers` and `user_variables.value` were plaintext
 *     until encryption at rest (HI-09, July 2026).
 *   - `servers.ssh_key`, `servers.password`, `env_vars.value`, `users.mfa_secret` and
 *     sensitive `system_settings` values can hold static-AAD ciphertext from before the
 *     vault, which isn't bound to its row and which a key change orphans, or plaintext.
 *   - `tool_credentials.credentials` and `oauth_tokens` were plaintext until HI-08.
 *     These stay in the format their read paths use, with no record binding.
 *
 * Their read paths still accept all of this, and nothing rewrites a value unless someone
 * changes that exact field, so a row nobody edited stays as it is in every copy of the
 * database. Fixing that needs the vault, so it can't be a SQL migration.
 * `rotate:secrets --encrypt-legacy` runs this pass.
 *
 *   - Readers don't change. What's written decrypts to the string they read now, so
 *     signatures, SSH logins and scripts behave as before. The exception is a value under
 *     a retired key, which a read can't open at all and which starts working.
 *   - It doesn't guess. `legacyDecrypt` goes by a value's shape, and here that's only a
 *     first look: what looks like ciphertext has to pass its GCM tag. If nothing opens
 *     it, it's reported, because it could be plaintext or ciphertext under a lost key,
 *     and encrypting the second as if it were the first would turn a failed read into a
 *     wrong value.
 *   - Safe to stop and repeat. Each row is one UPDATE, and a row with nothing left
 *     to encrypt isn't written, so a second run changes nothing and a run after an
 *     interruption only does the rest.
 *   - A row is all or nothing. If any value in it can't be read the way the app
 *     would read it, the row is reported and left exactly as it was.
 *   - Never overwrites a newer value. The app keeps running during this, so each
 *     UPDATE only applies to the row version it read. A secret regenerated or a
 *     variable renamed in between is left alone.
 *   - Reports never hold a value. A failure gives the row id, the column and one of
 *     a fixed set of reasons: vault errors can quote parts of what they were given,
 *     which here could be a plaintext secret.
 */
import { asc, and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  envVars,
  oauthTokens,
  servers,
  systemSettings,
  toolCredentials,
  users,
  userVariables,
  webhooks,
} from "@/shared/schema";
import { SENSITIVE_SYSTEM_SETTINGS } from "@/lib/encryption-service";
import {
  decryptSecret as decryptOAuthToken,
  encryptSecret as encryptOAuthToken,
} from "@/lib/oauth/TokenManager";
import {
  credentialEncryption,
  type EncryptedData,
  parseEncryptedData,
  toolCredentialsHoldNothing,
} from "@/lib/security/credential-encryption";
import {
  decryptEnvVarValue,
  decryptMfaSecret,
  decryptServerSecret,
  decryptSystemSetting,
  encryptEnvVarValue,
  encryptMfaSecret,
  encryptServerSecret,
  encryptSystemSetting,
  isLegacyCiphertextUnderKey,
  looksLikeLegacyCiphertext,
  readLegacyValue,
  readsAsLegacyCiphertext,
} from "@/lib/security/field-secret";
import {
  isRowVersion,
  rowVersion,
  secretRowFailureReason,
} from "@/lib/security/secret-row";
import { getSecretVault, isSecretEnvelope } from "@/lib/security/secret-vault";
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
  surface:
    | "webhooks"
    | "user_variables"
    | "servers"
    | "env_vars"
    | "users"
    | "system_settings"
    | "tool_credentials"
    | "oauth_tokens";
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
  id: number | string;
  column: string;
  reason: string;
}

/** Where a value is. Never the value. */
export interface LegacyValueLocation {
  surface: LegacySurfaceResult["surface"];
  id: number | string;
  column: string;
}

export interface LegacySecretsReport {
  dryRun: boolean;
  surfaces: LegacySurfaceResult[];
  failures: LegacyRowFailure[];
  /**
   * Values whose reads get ciphertext rather than what someone saved, before this run
   * and after it. See `readsAsLegacyCiphertext`. They don't count as remaining: a run
   * encrypts them as they read, and only saving the value again fixes them.
   */
  readsAsCiphertext: LegacyValueLocation[];
  totalEncrypted: number;
  /**
   * Rows that still hold a legacy value or one the app can't read. After a real
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

/** A failure whose message is one of a fixed set, and so safe to print. */
class RowFailure extends Error {}

const NOT_A_HEADER_OBJECT = "not a JSON object of headers";
const DOES_NOT_READ_BACK = "did not read back unchanged after encrypting";
const CANT_TELL =
  "has the shape of old ciphertext, but no key in this keyring opens it, so it can't be told from plaintext";
const MARKED_ENCRYPTED_BUT_ISNT =
  "marked as encrypted, but isn't in the encrypted format";
const MARKED_PLAINTEXT_BUT_ISNT =
  "marked as not encrypted, but holds encrypted data";
const NOT_JSON_CREDENTIALS = "not a JSON object of credentials";
const CANT_DECRYPT_CREDENTIAL = "encrypted, but this keyring can't decrypt it";

function failureReason(error: unknown): string {
  return error instanceof RowFailure
    ? error.message
    : secretRowFailureReason(error);
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
  if (decrypt(next) !== stored) throw new RowFailure(DOES_NOT_READ_BACK);
  return next;
}

/**
 * The new stored value for a column that can hold static-AAD ciphertext, or undefined
 * if it needs none. `read` is what the app reads this column with.
 */
function encryptedField(
  stored: string | null,
  encrypt: (plaintext: string) => string,
  read: (stored: string) => string,
  noteReadsAsCiphertext: () => void,
): string | undefined {
  if (!stored) return undefined; // nothing to protect
  if (isSecretEnvelope(stored)) {
    // Throws if the app couldn't read it either, as `encryptedText` says.
    if (readsAsLegacyCiphertext(read(stored))) noteReadsAsCiphertext();
    return undefined;
  }
  const value = readLegacyValue(stored);
  if (value === null) throw new RowFailure(CANT_TELL);
  if (readsAsLegacyCiphertext(value)) noteReadsAsCiphertext();
  const next = encrypt(value);
  if (read(next) !== value) throw new RowFailure(DOES_NOT_READ_BACK);
  return next;
}

/** The new stored value for `tool_credentials.credentials`, or undefined if it needs none. */
function encryptedToolCredentials(
  stored: string,
  markedEncrypted: boolean,
): string | undefined {
  if (toolCredentialsHoldNothing(stored)) return undefined;
  const encrypted = parseEncryptedData(stored);
  if (markedEncrypted) {
    // The app can't read either of these, and gets no credentials from them.
    if (!encrypted) throw new RowFailure(MARKED_ENCRYPTED_BUT_ISNT);
    assertCredentialDecrypts(encrypted);
    return undefined;
  }
  // The app reads this as a plain object of the ciphertext's fields, so it's broken
  // already, and it isn't plaintext to encrypt.
  if (encrypted) throw new RowFailure(MARKED_PLAINTEXT_BUT_ISNT);

  const credentials = parsedPlaintextCredentials(stored);
  // No code path writes this and tools can't use it, but it could still hold a
  // credential, so it isn't skipped as if it were empty.
  if (credentials === null) throw new RowFailure(NOT_JSON_CREDENTIALS);

  const next = credentialEncryption.encrypt(stored);
  const readBack = credentialEncryption.decrypt(next);
  if (JSON.stringify(readBack) !== JSON.stringify(credentials)) {
    throw new RowFailure(DOES_NOT_READ_BACK);
  }
  return JSON.stringify(next);
}

/** The new stored value for an OAuth token column, or undefined if it needs none. */
function encryptedToken(stored: string | null): string | undefined {
  if (!stored) return undefined; // nothing to protect
  const encrypted = parseEncryptedData(stored);
  if (encrypted) {
    assertCredentialDecrypts(encrypted);
    return undefined;
  }
  const next = encryptOAuthToken(stored);
  // A read parses what it decrypts as JSON, so a token like `1.0` wouldn't come back.
  if (decryptOAuthToken(next) !== stored) {
    throw new RowFailure(DOES_NOT_READ_BACK);
  }
  return next;
}

/** What the read paths get from a row marked as not encrypted, or null if nothing usable. */
function parsedPlaintextCredentials(stored: string): object | null {
  try {
    const parsed: unknown = JSON.parse(stored);
    return typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function assertCredentialDecrypts(encrypted: EncryptedData): void {
  if (!credentialDecrypts(encrypted)) {
    throw new RowFailure(CANT_DECRYPT_CREDENTIAL);
  }
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
      throw new RowFailure(DOES_NOT_READ_BACK);
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
    throw new RowFailure(NOT_A_HEADER_OBJECT);
  }
  decryptWebhookHeaders(stored, webhookKey, userId); // throws if unreadable
  return undefined;
}

interface PassFindings {
  failures: LegacyRowFailure[];
  readsAsCiphertext: LegacyValueLocation[];
}

async function upgradeRow(
  result: LegacySurfaceResult,
  failures: LegacyRowFailure[],
  dryRun: boolean,
  id: number | string,
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

async function upgradeServers(
  dryRun: boolean,
  { failures, readsAsCiphertext }: PassFindings,
): Promise<LegacySurfaceResult> {
  const result = emptyResult("servers");
  const rows = await db
    .select({
      id: servers.id,
      userId: servers.userId,
      sshKey: servers.sshKey,
      password: servers.password,
      version: rowVersion,
    })
    .from(servers)
    .orderBy(asc(servers.id));

  for (const row of rows) {
    const column = (name: "sshKey" | "password") => () =>
      encryptedField(
        row[name],
        (value) => encryptServerSecret(value, name, row.userId),
        (value) => decryptServerSecret(value, name, row.userId),
        () =>
          readsAsCiphertext.push({
            surface: result.surface,
            id: row.id,
            column: name,
          }),
      );
    await upgradeRow(
      result,
      failures,
      dryRun,
      row.id,
      { sshKey: column("sshKey"), password: column("password") },
      async (set) => {
        const written = await db
          .update(servers)
          .set(set)
          .where(and(eq(servers.id, row.id), isRowVersion(row.version)));
        return written.rowCount ?? 0;
      },
    );
  }
  return result;
}

async function upgradeEnvVars(
  dryRun: boolean,
  { failures, readsAsCiphertext }: PassFindings,
): Promise<LegacySurfaceResult> {
  const result = emptyResult("env_vars");
  const rows = await db
    .select({
      id: envVars.id,
      eventId: envVars.eventId,
      key: envVars.key,
      value: envVars.value,
      version: rowVersion,
    })
    .from(envVars)
    .orderBy(asc(envVars.id));

  for (const row of rows) {
    await upgradeRow(
      result,
      failures,
      dryRun,
      row.id,
      {
        value: () =>
          encryptedField(
            row.value,
            (value) => encryptEnvVarValue(value, row.eventId, row.key),
            (value) => decryptEnvVarValue(value, row.eventId, row.key),
            () =>
              readsAsCiphertext.push({
                surface: result.surface,
                id: row.id,
                column: "value",
              }),
          ),
      },
      async (set) => {
        const written = await db
          .update(envVars)
          .set(set)
          .where(and(eq(envVars.id, row.id), isRowVersion(row.version)));
        return written.rowCount ?? 0;
      },
    );
  }
  return result;
}

async function upgradeMfaSecrets(
  dryRun: boolean,
  { failures, readsAsCiphertext }: PassFindings,
): Promise<LegacySurfaceResult> {
  const result = emptyResult("users");
  const rows = await db
    .select({ id: users.id, mfaSecret: users.mfaSecret, version: rowVersion })
    .from(users)
    .orderBy(asc(users.id));

  for (const row of rows) {
    await upgradeRow(
      result,
      failures,
      dryRun,
      row.id,
      {
        mfaSecret: () =>
          encryptedField(
            row.mfaSecret,
            (value) => encryptMfaSecret(value, row.id),
            (value) => decryptMfaSecret(value, row.id),
            () =>
              readsAsCiphertext.push({
                surface: result.surface,
                id: row.id,
                column: "mfaSecret",
              }),
          ),
      },
      async (set) => {
        const written = await db
          .update(users)
          .set(set)
          .where(and(eq(users.id, row.id), isRowVersion(row.version)));
        return written.rowCount ?? 0;
      },
    );
  }
  return result;
}

async function upgradeSystemSettings(
  dryRun: boolean,
  { failures, readsAsCiphertext }: PassFindings,
): Promise<LegacySurfaceResult> {
  const result = emptyResult("system_settings");
  // The rest are plain by design, and the app reads them that way.
  const rows = await db
    .select({
      id: systemSettings.id,
      key: systemSettings.key,
      value: systemSettings.value,
      version: rowVersion,
    })
    .from(systemSettings)
    .where(inArray(systemSettings.key, [...SENSITIVE_SYSTEM_SETTINGS]))
    .orderBy(asc(systemSettings.id));

  for (const row of rows) {
    await upgradeRow(
      result,
      failures,
      dryRun,
      row.key, // What an operator will recognize, and a setting's name isn't secret.
      {
        value: () =>
          encryptedField(
            row.value,
            (value) => encryptSystemSetting(value, row.key),
            (value) => decryptSystemSetting(value, row.key),
            () =>
              readsAsCiphertext.push({
                surface: result.surface,
                id: row.key,
                column: "value",
              }),
          ),
      },
      async (set) => {
        const written = await db
          .update(systemSettings)
          .set(set)
          .where(and(eq(systemSettings.id, row.id), isRowVersion(row.version)));
        return written.rowCount ?? 0;
      },
    );
  }
  return result;
}

async function upgradeToolCredentials(
  dryRun: boolean,
  { failures }: PassFindings,
): Promise<LegacySurfaceResult> {
  const result = emptyResult("tool_credentials");
  const rows = await db
    .select({
      id: toolCredentials.id,
      credentials: toolCredentials.credentials,
      encrypted: toolCredentials.encrypted,
      version: rowVersion,
    })
    .from(toolCredentials)
    .orderBy(asc(toolCredentials.id));

  for (const row of rows) {
    await upgradeRow(
      result,
      failures,
      dryRun,
      row.id,
      {
        credentials: () =>
          encryptedToolCredentials(row.credentials, row.encrypted),
      },
      async (set) => {
        const { algorithm, keyDerivation } = parseEncryptedData(
          set.credentials as string,
        )!;
        const written = await db
          .update(toolCredentials)
          .set({
            ...set,
            // The read paths go by this flag, so it has to change with the value.
            encrypted: true,
            encryptionMetadata: { algorithm, keyDerivation },
          })
          .where(
            and(eq(toolCredentials.id, row.id), isRowVersion(row.version)),
          );
        return written.rowCount ?? 0;
      },
    );
  }
  return result;
}

async function upgradeOauthTokens(
  dryRun: boolean,
  { failures }: PassFindings,
): Promise<LegacySurfaceResult> {
  const result = emptyResult("oauth_tokens");
  const rows = await db
    .select({
      id: oauthTokens.id,
      accessToken: oauthTokens.accessToken,
      refreshToken: oauthTokens.refreshToken,
      version: rowVersion,
    })
    .from(oauthTokens)
    .orderBy(asc(oauthTokens.id));

  for (const row of rows) {
    await upgradeRow(
      result,
      failures,
      dryRun,
      row.id,
      {
        accessToken: () => encryptedToken(row.accessToken),
        refreshToken: () => encryptedToken(row.refreshToken),
      },
      async (set) => {
        const written = await db
          .update(oauthTokens)
          .set(set)
          .where(and(eq(oauthTokens.id, row.id), isRowVersion(row.version)));
        return written.rowCount ?? 0;
      },
    );
  }
  return result;
}

// A failed attempt costs an scrypt for each key in the ring, so these are capped per
// column, newest first. Legacy ciphertext is cheap to try, and only capped to bound
// what's loaded.
const CREDENTIAL_SAMPLE = 10;
const LEGACY_CIPHERTEXT_SAMPLE = 1000;

function credentialDecrypts(encrypted: EncryptedData): boolean {
  try {
    credentialEncryption.decrypt(encrypted);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypting under a key the app doesn't have would lock it out of these rows, and
 * unlike a failed read, nothing would show until someone needed one. A database
 * restored next to a freshly generated `.env` gets here easily, and the older the
 * database, the likelier it is to hold no envelopes at all. So this looks at
 * everything already encrypted that can be checked, and stops before writing if
 * some of it exists and none of it fits this keyring.
 *
 * Two things count in its favour: an envelope naming one of its keys, and ciphertext
 * that passes its GCM tag. One is enough, so a row under a key lost long ago doesn't
 * hold up the rest. A read can't tell us this, because the read paths guess by shape
 * and pass anything else through. With nothing encrypted anywhere there is nothing to
 * compare against, which is why the docs say to back up first.
 */
async function assertKeyringFitsDatabase(): Promise<void> {
  const keyring = getSecretVault().keyIds();

  // Column names and counts for the refusal. Stored values never go in here, not even
  // the key id in an envelope, because a plaintext can look like one.
  const unreadable = new Map<string, number>();
  const noteUnreadable = (source: string, count = 1) =>
    unreadable.set(source, (unreadable.get(source) ?? 0) + count);

  // Envelopes name their key, so these need no decryption.
  const envelopes = await db.execute<{
    source: string;
    key_id: string;
    count: number;
  }>(sql`
    SELECT source, split_part(stored, '.', 3) AS key_id, count(*)::int AS count
    FROM (
      SELECT 'webhooks.secret' AS source, secret AS stored FROM webhooks
      UNION ALL SELECT 'webhooks.headers', headers->>'__enc' FROM webhooks
      UNION ALL SELECT 'user_variables.value', value FROM user_variables
      UNION ALL SELECT 'servers.ssh_key', ssh_key FROM servers
      UNION ALL SELECT 'servers.password', password FROM servers
      UNION ALL SELECT 'env_vars.value', value FROM env_vars
      UNION ALL SELECT 'system_settings.value', value FROM system_settings
      UNION ALL SELECT 'users.mfa_secret', mfa_secret FROM users
    ) AS all_stored
    WHERE stored LIKE 'crn.1.%'
    GROUP BY 1, 2
  `);
  for (const { source, key_id: keyId, count } of envelopes.rows) {
    if (keyring.some((entry) => entry.keyId === keyId)) return;
    noteUnreadable(source, count);
  }

  const credentials = await db.execute<{ source: string; stored: string }>(sql`
    (SELECT 'tool_credentials.credentials' AS source, credentials AS stored
       FROM tool_credentials WHERE encrypted AND credentials LIKE '{%'
       ORDER BY updated_at DESC LIMIT ${CREDENTIAL_SAMPLE})
    UNION ALL
    (SELECT 'oauth_tokens.access_token', access_token
       FROM oauth_tokens WHERE access_token LIKE '{%'
       ORDER BY updated_at DESC LIMIT ${CREDENTIAL_SAMPLE})
    UNION ALL
    (SELECT 'oauth_tokens.refresh_token', refresh_token
       FROM oauth_tokens WHERE refresh_token LIKE '{%'
       ORDER BY updated_at DESC LIMIT ${CREDENTIAL_SAMPLE})
  `);
  for (const { source, stored } of credentials.rows) {
    const encrypted = parseEncryptedData(stored);
    if (!encrypted) continue; // plaintext, which proves nothing either way
    if (credentialDecrypts(encrypted)) return;
    noteUnreadable(source);
  }

  // Static-AAD ciphertext from before the vault. An API token that's been hashed is
  // 64 hex characters, which has the same shape, so it's left out the way the app's
  // own lookup leaves it out.
  const legacy = await db.execute<{ source: string; stored: string }>(sql`
    SELECT source, stored
    FROM (
      SELECT 'servers.ssh_key' AS source, ssh_key AS stored FROM servers
      UNION ALL SELECT 'servers.password', password FROM servers
      UNION ALL SELECT 'env_vars.value', value FROM env_vars
      UNION ALL SELECT 'users.mfa_secret', mfa_secret FROM users
      UNION ALL SELECT 'system_settings.value', value FROM system_settings
        WHERE key IN ${[...SENSITIVE_SYSTEM_SETTINGS]}
      UNION ALL SELECT 'api_tokens.token', token FROM api_tokens
        WHERE token !~ '^[0-9a-f]{64}$'
    ) AS all_stored
    WHERE stored ~ '^[A-Za-z0-9+/=]{50,}$'
    LIMIT ${LEGACY_CIPHERTEXT_SAMPLE}
  `);
  for (const { source, stored } of legacy.rows) {
    if (!looksLikeLegacyCiphertext(stored)) continue;
    if (keyring.some(({ key }) => isLegacyCiphertextUnderKey(stored, key))) {
      return;
    }
    noteUnreadable(source);
  }

  if (unreadable.size === 0) return;

  const found = [...unreadable]
    .map(([source, count]) => `${source} (${String(count)})`)
    .join(", ");
  throw new LegacySecretsRefusedError(
    `This database holds encrypted values, but this keyring (active key ${String(keyring[0]?.keyId)}) can't read any it checked: ${found}. ` +
      "ENCRYPTION_KEY is probably not the one the app runs with, and encrypting with it would lock the app out of these rows. Nothing was changed. See docs/ENVIRONMENT_VARIABLES.md.",
  );
}

async function runPass(
  dryRun: boolean,
  findings: PassFindings,
): Promise<LegacySurfaceResult[]> {
  return [
    await upgradeWebhooks(dryRun, findings.failures),
    await upgradeUserVariables(dryRun, findings.failures),
    await upgradeServers(dryRun, findings),
    await upgradeEnvVars(dryRun, findings),
    await upgradeMfaSecrets(dryRun, findings),
    await upgradeSystemSettings(dryRun, findings),
    await upgradeToolCredentials(dryRun, findings),
    await upgradeOauthTokens(dryRun, findings),
  ];
}

const noFindings = (): PassFindings => ({
  failures: [],
  readsAsCiphertext: [],
});

/**
 * Encrypt every legacy value under its record binding. See the file header for what
 * makes this safe to run on a live instance. Throws before reading a row if the vault
 * has no usable key or the keyring doesn't fit the database.
 */
export async function encryptLegacySecrets(
  opts: { dryRun?: boolean } = {},
): Promise<LegacySecretsReport> {
  const dryRun = opts.dryRun ?? false;
  await assertKeyringFitsDatabase();

  const findings = noFindings();
  const surfaces = await runPass(dryRun, findings);
  const after = dryRun ? surfaces : await runPass(true, noFindings());

  return {
    dryRun,
    surfaces,
    ...findings,
    totalEncrypted: surfaces.reduce((n, s) => n + s.encrypted, 0),
    remaining: after.reduce((n, s) => n + s.encrypted + s.failed, 0),
  };
}

/**
 * Rows holding a value `--encrypt-legacy` would encrypt, by the same rules as
 * `isSecretEnvelope`, `isLegacyWebhookHeaders` and `parseEncryptedData`. It decrypts
 * nothing, so it's cheap enough for every boot and needs no key.
 *
 * A run's `remaining` also counts rows it can't read. Those aren't counted here where
 * telling needs no key, because they need fixing rather than encrypting: a value
 * starting with `crn.` that doesn't decrypt, headers that aren't an object, or a tool
 * credential whose flag doesn't match what it holds. Plaintext next to one of those in
 * the same row is counted, and a run names that row instead of encrypting it. What
 * looks like old ciphertext is counted whether or not a key opens it, which takes a key.
 */
export async function countLegacyRows(): Promise<number> {
  const plaintextSecret = sql`(secret <> '' AND secret NOT LIKE 'crn.%')`;
  const { rows } = await db.execute<{ count: string }>(sql`
    SELECT (
      SELECT count(*) FROM webhooks
      WHERE ${plaintextSecret}
        OR (
          jsonb_typeof(headers) = 'object'
          AND headers <> '{}'::jsonb
          AND (headers->>'__enc' LIKE 'crn.%') IS NOT TRUE
        )
    ) + (
      SELECT count(*) FROM user_variables
      WHERE value <> '' AND value NOT LIKE 'crn.%'
    ) + (
      SELECT count(*) FROM servers
      WHERE (ssh_key <> '' AND ssh_key NOT LIKE 'crn.%')
        OR (password <> '' AND password NOT LIKE 'crn.%')
    ) + (
      SELECT count(*) FROM env_vars
      WHERE value <> '' AND value NOT LIKE 'crn.%'
    ) + (
      SELECT count(*) FROM users
      WHERE mfa_secret <> '' AND mfa_secret NOT LIKE 'crn.%'
    ) + (
      SELECT count(*) FROM system_settings
      WHERE key IN ${[...SENSITIVE_SYSTEM_SETTINGS]}
        AND value <> '' AND value NOT LIKE 'crn.%'
    ) AS count
  `);

  // Headers stored as a JSON string read as whatever that string parses to, and SQL
  // before Postgres 16 can't test that without an error on the ones that don't parse.
  // So the few rows like that are read the way a run reads them, and asked the same
  // question. The same goes for telling a credential's plaintext from its encrypted
  // format, and these tables are small.
  const stringHeaders = await db
    .select({ headers: webhooks.headers })
    .from(webhooks)
    .where(sql`jsonb_typeof(headers) = 'string' AND NOT ${plaintextSecret}`);
  const plaintextCredentials = await db
    .select({ credentials: toolCredentials.credentials })
    .from(toolCredentials)
    .where(eq(toolCredentials.encrypted, false));
  const tokens = await db
    .select({
      accessToken: oauthTokens.accessToken,
      refreshToken: oauthTokens.refreshToken,
    })
    .from(oauthTokens);

  const isPlaintextToken = (stored: string | null) =>
    !!stored && !parseEncryptedData(stored);

  return (
    Number(rows[0]?.count ?? 0) +
    stringHeaders.filter((row) => isLegacyWebhookHeaders(row.headers)).length +
    plaintextCredentials.filter(
      ({ credentials }) =>
        !toolCredentialsHoldNothing(credentials) &&
        !parseEncryptedData(credentials) &&
        parsedPlaintextCredentials(credentials) !== null,
    ).length +
    tokens.filter(
      (row) =>
        isPlaintextToken(row.accessToken) || isPlaintextToken(row.refreshToken),
    ).length
  );
}

/**
 * A line for the worker's boot log when rows hold legacy values, or null. The worker
 * only reports. Encrypting rewrites secrets with whatever key the process has, and a
 * dev worker points at a shared database, so an operator starts it.
 */
export async function legacySecretsBootWarning(): Promise<string | null> {
  const count = await countLegacyRows();
  if (count === 0) return null;
  return (
    `${String(count)} row(s) still hold secrets from before the vault, as plaintext or older ciphertext. ` +
    "Run node apps/cronium-app/dist/rotate-secrets.cjs --encrypt-legacy to encrypt them. It names any row it can't encrypt. See docs/ENVIRONMENT_VARIABLES.md."
  );
}
