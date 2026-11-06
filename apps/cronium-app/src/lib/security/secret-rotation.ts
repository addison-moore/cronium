/**
 * Secret key-rotation driver (security plan Phase 2.1: 559/565).
 *
 * Re-encrypts every at-rest secret from a retired key onto the active key. It is
 * SAFE and RESUMABLE by construction:
 *
 *   - Both keys stay in the ring during rotation (active = ENCRYPTION_KEY,
 *     retired = ENCRYPTION_KEYS_RETIRED), so every row decrypts throughout —
 *     the app keeps working while rotation runs.
 *   - It is idempotent: a row already under the active key is skipped
 *     (vault: `needsReencryption`; credentials: `isUnderActiveKey`). Re-running
 *     after an interruption simply finishes the remainder — that is the
 *     interrupted-rotation recovery. To ROLL BACK, run again with the keys
 *     swapped (old active, new retired).
 *   - Each row is one UPDATE; a row that can't be read or written is recorded as an
 *     error and skipped rather than aborting the whole run.
 *   - It never overwrites a newer value. The app keeps running during this, so each
 *     UPDATE only applies to the row version it read. A row changed in between, such
 *     as a secret someone just regenerated, is left as they saved it, counted as
 *     neither re-encrypted nor an error, and picked up by a later run.
 *   - Decryption is authenticated (AES-GCM + AAD binding), so a wrong key or
 *     binding throws — it can never write mis-bound ciphertext.
 *
 * Operator runbook:
 *   1. ENCRYPTION_KEY=<new>, ENCRYPTION_KEYS_RETIRED=["<old>"]
 *   2. run this driver until it reports 0 remaining
 *   3. remove <old> from ENCRYPTION_KEYS_RETIRED
 *
 * Values from before the vault are not this driver's job, though it counts them as
 * `legacy`: `legacy-secrets.ts` moves them into it.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import {
  servers,
  envVars,
  systemSettings,
  users,
  userVariables,
  webhooks,
  toolCredentials,
  oauthTokens,
} from "@/shared/schema";
import {
  isRowVersion,
  rowVersion,
  secretRowFailureReason,
} from "@/lib/security/secret-row";
import { getSecretVault, isSecretEnvelope } from "@/lib/security/secret-vault";
import {
  encryptServerSecret,
  decryptServerSecret,
  encryptEnvVarValue,
  decryptEnvVarValue,
  encryptSystemSetting,
  decryptSystemSetting,
  encryptMfaSecret,
  decryptMfaSecret,
  looksLikeLegacyCiphertext,
} from "@/lib/security/field-secret";
import {
  encryptVariableValue,
  decryptVariableValue,
} from "@/lib/security/variable-secret";
import {
  encryptWebhookSecret,
  decryptWebhookSecret,
  encryptWebhookHeaders,
  decryptWebhookHeaders,
  isLegacyWebhookHeaders,
} from "@/lib/webhooks/webhook-secret";
import {
  credentialEncryption,
  parseEncryptedData,
  toolCredentialsHoldNothing,
} from "@/lib/security/credential-encryption";

export interface SurfaceResult {
  surface: string;
  scanned: number;
  reencrypted: number;
  skipped: number;
  errors: number;
  /**
   * Values left as they were because their row changed between this run's read and
   * its write. They're neither re-encrypted nor errors: a later run picks them up. Like
   * the other counts this is per value, so a row with two values to move counts twice.
   */
  changedDuringRun: number;
  // Values in an always-secret column that `legacy-secrets.ts` still has to deal with
  // and this driver can't. On servers, env vars and MFA secrets they are static-AAD
  // ciphertext or plaintext. Elsewhere they're plaintext, or on tool credentials a row
  // whose `encrypted` flag doesn't match what it holds.
  legacy: number;
  /**
   * The part of `legacy` that has the shape of static-AAD ciphertext, which only opens
   * under the key it was written with, so a key change can orphan it. A key change
   * can't orphan the rest.
   */
  legacyCiphertext: number;
}

export interface RotationReport {
  dryRun: boolean;
  surfaces: SurfaceResult[];
  totalReencrypted: number;
  totalErrors: number;
  totalLegacy: number;
  /** The part of totalLegacy that a key change can't orphan. */
  plaintextLegacy: number;
  totalChangedDuringRun: number;
  /**
   * In a dry run, what a real run would re-encrypt. In a real run, what it couldn't:
   * values that failed, and values whose row changed under it.
   */
  remaining: number;
}

function emptyResult(surface: string): SurfaceResult {
  return {
    surface,
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    changedDuringRun: 0,
    legacy: 0,
    legacyCiphertext: 0,
  };
}

/**
 * A non-null, always-secret value that is NOT a vault envelope. Counting these lets
 * the driver warn about them: see `SurfaceResult.legacy` for what they are.
 */
function isLegacyValue(value: string | null | undefined): value is string {
  return !!value && !isSecretEnvelope(value);
}

function countLegacy(r: SurfaceResult, value: string): void {
  r.legacy++;
  if (looksLikeLegacyCiphertext(value)) r.legacyCiphertext++;
}

/**
 * The one write a row gets, holding every value this run moved in it. It applies only
 * to the version `isRowVersion` was given, so it has to be one write: a second would
 * miss because of the first.
 */
async function writeRow(
  r: SurfaceResult,
  dryRun: boolean,
  id: string,
  moved: string[],
  write: () => Promise<{ rowCount: number | null }>,
): Promise<void> {
  if (moved.length === 0) return;
  if (dryRun) {
    r.reencrypted += moved.length;
    return;
  }
  try {
    const { rowCount } = await write();
    if ((rowCount ?? 0) > 0) r.reencrypted += moved.length;
    else r.changedDuringRun += moved.length;
  } catch (e) {
    r.errors += moved.length;
    logRowError(r.surface, id, moved.join("+"), e);
  }
}

/** A stored vault value that was written under a retired (non-active) key. */
function vaultNeedsReencrypt(
  value: string | null | undefined,
): value is string {
  return (
    !!value &&
    isSecretEnvelope(value) &&
    getSecretVault().needsReencryption(value)
  );
}

async function rotateServers(dryRun: boolean): Promise<SurfaceResult> {
  const r = emptyResult("servers.sshKey/password");
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
    const set: Record<string, string> = {};
    for (const col of ["sshKey", "password"] as const) {
      const value = row[col];
      r.scanned++;
      if (isLegacyValue(value)) {
        countLegacy(r, value);
        continue;
      }
      if (!vaultNeedsReencrypt(value)) {
        r.skipped++;
        continue;
      }
      try {
        const pt = decryptServerSecret(value, col, row.userId);
        set[col] = encryptServerSecret(pt, col, row.userId);
      } catch (e) {
        r.errors++;
        logRowError(r.surface, String(row.id), col, e);
      }
    }
    await writeRow(r, dryRun, String(row.id), Object.keys(set), () =>
      db
        .update(servers)
        .set(set)
        .where(and(eq(servers.id, row.id), isRowVersion(row.version))),
    );
  }
  return r;
}

async function rotateEnvVars(dryRun: boolean): Promise<SurfaceResult> {
  const r = emptyResult("env_vars.value");
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
    r.scanned++;
    if (isLegacyValue(row.value)) {
      countLegacy(r, row.value);
      continue;
    }
    if (!vaultNeedsReencrypt(row.value)) {
      r.skipped++;
      continue;
    }
    let next: string;
    try {
      const pt = decryptEnvVarValue(row.value, row.eventId, row.key);
      next = encryptEnvVarValue(pt, row.eventId, row.key);
    } catch (e) {
      r.errors++;
      logRowError(r.surface, String(row.id), "value", e);
      continue;
    }
    await writeRow(r, dryRun, String(row.id), ["value"], () =>
      db
        .update(envVars)
        .set({ value: next })
        .where(and(eq(envVars.id, row.id), isRowVersion(row.version))),
    );
  }
  return r;
}

async function rotateSystemSettings(dryRun: boolean): Promise<SurfaceResult> {
  const r = emptyResult("system_settings.value");
  const rows = await db
    .select({
      key: systemSettings.key,
      value: systemSettings.value,
      version: rowVersion,
    })
    .from(systemSettings)
    .orderBy(asc(systemSettings.id));
  for (const row of rows) {
    r.scanned++;
    if (!vaultNeedsReencrypt(row.value)) {
      r.skipped++;
      continue;
    }
    let next: string;
    try {
      const pt = decryptSystemSetting(row.value, row.key);
      next = encryptSystemSetting(pt, row.key);
    } catch (e) {
      r.errors++;
      logRowError(r.surface, row.key, "value", e);
      continue;
    }
    await writeRow(r, dryRun, row.key, ["value"], () =>
      db
        .update(systemSettings)
        .set({ value: next })
        .where(and(eq(systemSettings.key, row.key), isRowVersion(row.version))),
    );
  }
  return r;
}

async function rotateMfaSecrets(dryRun: boolean): Promise<SurfaceResult> {
  const r = emptyResult("users.mfaSecret");
  const rows = await db
    .select({ id: users.id, mfaSecret: users.mfaSecret, version: rowVersion })
    .from(users)
    .orderBy(asc(users.id));
  for (const row of rows) {
    r.scanned++;
    if (isLegacyValue(row.mfaSecret)) {
      countLegacy(r, row.mfaSecret);
      continue;
    }
    if (!vaultNeedsReencrypt(row.mfaSecret)) {
      r.skipped++;
      continue;
    }
    let next: string;
    try {
      const pt = decryptMfaSecret(row.mfaSecret, row.id);
      next = encryptMfaSecret(pt, row.id);
    } catch (e) {
      r.errors++;
      logRowError(r.surface, row.id, "mfaSecret", e);
      continue;
    }
    await writeRow(r, dryRun, row.id, ["mfaSecret"], () =>
      db
        .update(users)
        .set({ mfaSecret: next })
        .where(and(eq(users.id, row.id), isRowVersion(row.version))),
    );
  }
  return r;
}

async function rotateUserVariables(dryRun: boolean): Promise<SurfaceResult> {
  const r = emptyResult("user_variables.value");
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
    r.scanned++;
    if (isLegacyValue(row.value)) {
      countLegacy(r, row.value);
      continue;
    }
    if (!vaultNeedsReencrypt(row.value)) {
      r.skipped++;
      continue;
    }
    let next: string;
    try {
      const pt = decryptVariableValue(row.value, row.userId, row.key);
      next = encryptVariableValue(pt, row.userId, row.key);
    } catch (e) {
      r.errors++;
      logRowError(r.surface, String(row.id), "value", e);
      continue;
    }
    await writeRow(r, dryRun, String(row.id), ["value"], () =>
      db
        .update(userVariables)
        .set({ value: next })
        .where(and(eq(userVariables.id, row.id), isRowVersion(row.version))),
    );
  }
  return r;
}

async function rotateWebhooks(dryRun: boolean): Promise<SurfaceResult> {
  const r = emptyResult("webhooks.secret/headers");
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
    const set: Record<string, unknown> = {};
    // secret (vault envelope string)
    r.scanned++;
    if (isLegacyValue(row.secret)) {
      r.legacy++;
    } else if (vaultNeedsReencrypt(row.secret)) {
      try {
        const pt = decryptWebhookSecret(row.secret, row.key, row.userId);
        set.secret = encryptWebhookSecret(pt, row.key, row.userId);
      } catch (e) {
        r.errors++;
        logRowError(r.surface, String(row.id), "secret", e);
      }
    } else {
      r.skipped++;
    }
    // headers ({ __enc: envelope } jsonb)
    r.scanned++;
    const enc = (row.headers as { __enc?: unknown } | null)?.__enc;
    if (isLegacyWebhookHeaders(row.headers)) {
      r.legacy++;
    } else if (typeof enc === "string" && vaultNeedsReencrypt(enc)) {
      try {
        const decoded = decryptWebhookHeaders(row.headers, row.key, row.userId);
        set.headers = encryptWebhookHeaders(decoded, row.key, row.userId);
      } catch (e) {
        r.errors++;
        logRowError(r.surface, String(row.id), "headers", e);
      }
    } else {
      r.skipped++;
    }
    await writeRow(r, dryRun, String(row.id), Object.keys(set), () =>
      db
        .update(webhooks)
        .set(set)
        .where(and(eq(webhooks.id, row.id), isRowVersion(row.version))),
    );
  }
  return r;
}

async function rotateToolCredentials(dryRun: boolean): Promise<SurfaceResult> {
  const r = emptyResult("tool_credentials.credentials");
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
    r.scanned++;
    const enc = row.encrypted ? parseEncryptedData(row.credentials) : null;
    if (!enc) {
      if (toolCredentialsHoldNothing(row.credentials)) r.skipped++;
      else r.legacy++;
      continue;
    }
    if (credentialEncryption.isUnderActiveKey(enc)) {
      r.skipped++;
      continue;
    }
    let next: ReturnType<typeof credentialEncryption.encrypt>;
    try {
      next = credentialEncryption.encrypt(credentialEncryption.decrypt(enc));
    } catch (e) {
      r.errors++;
      logRowError(r.surface, String(row.id), "credentials", e);
      continue;
    }
    await writeRow(r, dryRun, String(row.id), ["credentials"], () =>
      db
        .update(toolCredentials)
        .set({
          credentials: JSON.stringify(next),
          encryptionMetadata: {
            algorithm: next.algorithm,
            keyDerivation: next.keyDerivation,
          },
        })
        .where(
          and(eq(toolCredentials.id, row.id), isRowVersion(row.version)),
        ),
    );
  }
  return r;
}

async function rotateOauthTokens(dryRun: boolean): Promise<SurfaceResult> {
  const r = emptyResult("oauth_tokens.access/refresh");
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
    const set: Record<string, string> = {};
    for (const col of ["accessToken", "refreshToken"] as const) {
      const stored = row[col];
      const enc = parseEncryptedData(stored);
      r.scanned++;
      if (!enc) {
        // Plaintext from before tokens were encrypted, which reads the same under any key.
        if (stored) r.legacy++;
        else r.skipped++;
        continue;
      }
      if (credentialEncryption.isUnderActiveKey(enc)) {
        r.skipped++;
        continue;
      }
      try {
        const data = credentialEncryption.decrypt(enc);
        set[col] = JSON.stringify(credentialEncryption.encrypt(data));
      } catch (e) {
        r.errors++;
        logRowError(r.surface, String(row.id), col, e);
      }
    }
    await writeRow(r, dryRun, String(row.id), Object.keys(set), () =>
      db
        .update(oauthTokens)
        .set(set)
        .where(and(eq(oauthTokens.id, row.id), isRowVersion(row.version))),
    );
  }
  return r;
}

function logRowError(
  surface: string,
  id: string,
  column: string,
  e: unknown,
): void {
  // Never log the secret value: only the location and a fixed reason.
  console.error(
    `[secret-rotation] ${surface} id=${id} column=${column} failed: ${secretRowFailureReason(e)}`,
  );
}

/**
 * Re-encrypt every at-rest secret onto the active key. Idempotent and resumable
 * (see file header). Set dryRun to report what would change without writing.
 */
export async function rotateAllSecrets(
  opts: { dryRun?: boolean } = {},
): Promise<RotationReport> {
  const dryRun = opts.dryRun ?? false;
  const surfaces: SurfaceResult[] = [];
  surfaces.push(await rotateServers(dryRun));
  surfaces.push(await rotateEnvVars(dryRun));
  surfaces.push(await rotateSystemSettings(dryRun));
  surfaces.push(await rotateMfaSecrets(dryRun));
  surfaces.push(await rotateUserVariables(dryRun));
  surfaces.push(await rotateWebhooks(dryRun));
  surfaces.push(await rotateToolCredentials(dryRun));
  surfaces.push(await rotateOauthTokens(dryRun));

  const totalReencrypted = surfaces.reduce((n, s) => n + s.reencrypted, 0);
  const totalErrors = surfaces.reduce((n, s) => n + s.errors, 0);
  const totalLegacy = surfaces.reduce((n, s) => n + s.legacy, 0);
  const totalChangedDuringRun = surfaces.reduce(
    (n, s) => n + s.changedDuringRun,
    0,
  );
  // In a dry run the "remaining" count is what still needs rotating.
  const remaining = dryRun
    ? totalReencrypted
    : totalErrors + totalChangedDuringRun;
  return {
    dryRun,
    surfaces,
    totalReencrypted,
    totalErrors,
    totalLegacy,
    plaintextLegacy:
      totalLegacy - surfaces.reduce((n, s) => n + s.legacyCiphertext, 0),
    totalChangedDuringRun,
    remaining,
  };
}
