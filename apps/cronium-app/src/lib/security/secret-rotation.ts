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
 *   - Each row is updated independently; a single unreadable row is recorded as
 *     an error and skipped rather than aborting the whole run.
 *   - Decryption is authenticated (AES-GCM + AAD binding), so a wrong key or
 *     binding throws — it can never write mis-bound ciphertext.
 *
 * Operator runbook:
 *   1. ENCRYPTION_KEY=<new>, ENCRYPTION_KEYS_RETIRED=["<old>"]
 *   2. run this driver until it reports 0 remaining
 *   3. remove <old> from ENCRYPTION_KEYS_RETIRED
 */
import { eq } from "drizzle-orm";
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
} from "@/lib/webhooks/webhook-secret";
import {
  credentialEncryption,
  type EncryptedData,
} from "@/lib/security/credential-encryption";

export interface SurfaceResult {
  surface: string;
  scanned: number;
  reencrypted: number;
  skipped: number;
  errors: number;
  // Non-null values in an always-secret column that are NOT vault envelopes,
  // i.e. legacy static-AAD ciphertext still bound to the CURRENT ENCRYPTION_KEY.
  // The driver cannot rotate these (it would orphan them under the retired key);
  // they must be migrated to vault envelopes first (lazy passthrough on write,
  // or a dedicated legacy-migration pass) BEFORE the key is rotated.
  legacy: number;
}

export interface RotationReport {
  dryRun: boolean;
  surfaces: SurfaceResult[];
  totalReencrypted: number;
  totalErrors: number;
  totalLegacy: number;
  remaining: number;
}

/**
 * A non-null, always-secret value that is NOT a vault envelope — i.e. legacy
 * static-AAD ciphertext bound to the current ENCRYPTION_KEY. Counting these lets
 * the driver warn that a key rotation would orphan them (they must be migrated
 * to vault envelopes first).
 */
function isLegacyValue(value: string | null | undefined): boolean {
  return !!value && !isSecretEnvelope(value);
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

function parseEncrypted(
  stored: string | null | undefined,
): EncryptedData | null {
  if (!stored) return null;
  try {
    const o = JSON.parse(stored) as Partial<EncryptedData>;
    if (o?.encrypted && o.iv && o.authTag && o.keyDerivation) {
      return o as EncryptedData;
    }
  } catch {
    // Not JSON → legacy plaintext, nothing to rotate.
  }
  return null;
}

async function rotateServers(dryRun: boolean): Promise<SurfaceResult> {
  const r: SurfaceResult = {
    surface: "servers.sshKey/password",
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    legacy: 0,
  };
  const rows = await db
    .select({
      id: servers.id,
      userId: servers.userId,
      sshKey: servers.sshKey,
      password: servers.password,
    })
    .from(servers);
  for (const row of rows) {
    for (const col of ["sshKey", "password"] as const) {
      const value = row[col];
      r.scanned++;
      if (isLegacyValue(value)) {
        r.legacy++;
        continue;
      }
      if (!vaultNeedsReencrypt(value)) {
        r.skipped++;
        continue;
      }
      try {
        const pt = decryptServerSecret(value, col, row.userId);
        const next = encryptServerSecret(pt, col, row.userId);
        if (!dryRun) {
          await db
            .update(servers)
            .set({ [col]: next })
            .where(eq(servers.id, row.id));
        }
        r.reencrypted++;
      } catch (e) {
        r.errors++;
        logRowError(r.surface, String(row.id), col, e);
      }
    }
  }
  return r;
}

async function rotateEnvVars(dryRun: boolean): Promise<SurfaceResult> {
  const r: SurfaceResult = {
    surface: "env_vars.value",
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    legacy: 0,
  };
  const rows = await db
    .select({
      id: envVars.id,
      eventId: envVars.eventId,
      key: envVars.key,
      value: envVars.value,
    })
    .from(envVars);
  for (const row of rows) {
    r.scanned++;
    if (isLegacyValue(row.value)) {
      r.legacy++;
      continue;
    }
    if (!vaultNeedsReencrypt(row.value)) {
      r.skipped++;
      continue;
    }
    try {
      const pt = decryptEnvVarValue(row.value, row.eventId, row.key);
      const next = encryptEnvVarValue(pt, row.eventId, row.key);
      if (!dryRun) {
        await db
          .update(envVars)
          .set({ value: next })
          .where(eq(envVars.id, row.id));
      }
      r.reencrypted++;
    } catch (e) {
      r.errors++;
      logRowError(r.surface, String(row.id), "value", e);
    }
  }
  return r;
}

async function rotateSystemSettings(dryRun: boolean): Promise<SurfaceResult> {
  const r: SurfaceResult = {
    surface: "system_settings.value",
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    legacy: 0,
  };
  const rows = await db
    .select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings);
  for (const row of rows) {
    r.scanned++;
    if (!vaultNeedsReencrypt(row.value)) {
      r.skipped++;
      continue;
    }
    try {
      const pt = decryptSystemSetting(row.value, row.key);
      const next = encryptSystemSetting(pt, row.key);
      if (!dryRun) {
        await db
          .update(systemSettings)
          .set({ value: next })
          .where(eq(systemSettings.key, row.key));
      }
      r.reencrypted++;
    } catch (e) {
      r.errors++;
      logRowError(r.surface, row.key, "value", e);
    }
  }
  return r;
}

async function rotateMfaSecrets(dryRun: boolean): Promise<SurfaceResult> {
  const r: SurfaceResult = {
    surface: "users.mfaSecret",
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    legacy: 0,
  };
  const rows = await db
    .select({ id: users.id, mfaSecret: users.mfaSecret })
    .from(users);
  for (const row of rows) {
    r.scanned++;
    if (isLegacyValue(row.mfaSecret)) {
      r.legacy++;
      continue;
    }
    if (!vaultNeedsReencrypt(row.mfaSecret)) {
      r.skipped++;
      continue;
    }
    try {
      const pt = decryptMfaSecret(row.mfaSecret, row.id);
      const next = encryptMfaSecret(pt, row.id);
      if (!dryRun) {
        await db
          .update(users)
          .set({ mfaSecret: next })
          .where(eq(users.id, row.id));
      }
      r.reencrypted++;
    } catch (e) {
      r.errors++;
      logRowError(r.surface, row.id, "mfaSecret", e);
    }
  }
  return r;
}

async function rotateUserVariables(dryRun: boolean): Promise<SurfaceResult> {
  const r: SurfaceResult = {
    surface: "user_variables.value",
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    legacy: 0,
  };
  const rows = await db
    .select({
      id: userVariables.id,
      userId: userVariables.userId,
      key: userVariables.key,
      value: userVariables.value,
    })
    .from(userVariables);
  for (const row of rows) {
    r.scanned++;
    if (isLegacyValue(row.value)) {
      r.legacy++;
      continue;
    }
    if (!vaultNeedsReencrypt(row.value)) {
      r.skipped++;
      continue;
    }
    try {
      const pt = decryptVariableValue(row.value, row.userId, row.key);
      const next = encryptVariableValue(pt, row.userId, row.key);
      if (!dryRun) {
        await db
          .update(userVariables)
          .set({ value: next })
          .where(eq(userVariables.id, row.id));
      }
      r.reencrypted++;
    } catch (e) {
      r.errors++;
      logRowError(r.surface, String(row.id), "value", e);
    }
  }
  return r;
}

async function rotateWebhooks(dryRun: boolean): Promise<SurfaceResult> {
  const r: SurfaceResult = {
    surface: "webhooks.secret/headers",
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    legacy: 0,
  };
  const rows = await db
    .select({
      id: webhooks.id,
      userId: webhooks.userId,
      key: webhooks.key,
      secret: webhooks.secret,
      headers: webhooks.headers,
    })
    .from(webhooks);
  for (const row of rows) {
    // secret (vault envelope string)
    r.scanned++;
    let secretNext: string | undefined;
    let headersNext: unknown | undefined;
    if (isLegacyValue(row.secret)) {
      r.legacy++;
    } else if (vaultNeedsReencrypt(row.secret)) {
      try {
        const pt = decryptWebhookSecret(row.secret, row.key, row.userId);
        secretNext = encryptWebhookSecret(pt, row.key, row.userId);
      } catch (e) {
        r.errors++;
        logRowError(r.surface, String(row.id), "secret", e);
      }
    } else {
      r.skipped++;
    }
    // headers ({ __enc: envelope } jsonb)
    const enc = (row.headers as { __enc?: unknown } | null)?.__enc;
    if (typeof enc === "string" && vaultNeedsReencrypt(enc)) {
      try {
        const decoded = decryptWebhookHeaders(row.headers, row.key, row.userId);
        headersNext = encryptWebhookHeaders(decoded, row.key, row.userId);
      } catch (e) {
        r.errors++;
        logRowError(r.surface, String(row.id), "headers", e);
      }
    }
    if ((secretNext !== undefined || headersNext !== undefined) && !dryRun) {
      const set: Record<string, unknown> = {};
      if (secretNext !== undefined) set.secret = secretNext;
      if (headersNext !== undefined) set.headers = headersNext;
      await db.update(webhooks).set(set).where(eq(webhooks.id, row.id));
    }
    if (secretNext !== undefined) r.reencrypted++;
    if (headersNext !== undefined) r.reencrypted++;
  }
  return r;
}

async function rotateToolCredentials(dryRun: boolean): Promise<SurfaceResult> {
  const r: SurfaceResult = {
    surface: "tool_credentials.credentials",
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    legacy: 0,
  };
  const rows = await db
    .select({
      id: toolCredentials.id,
      credentials: toolCredentials.credentials,
      encrypted: toolCredentials.encrypted,
    })
    .from(toolCredentials);
  for (const row of rows) {
    r.scanned++;
    const enc = row.encrypted ? parseEncrypted(row.credentials) : null;
    if (!enc || credentialEncryption.isUnderActiveKey(enc)) {
      r.skipped++;
      continue;
    }
    try {
      const data = credentialEncryption.decrypt(enc);
      const next = credentialEncryption.encrypt(data);
      if (!dryRun) {
        await db
          .update(toolCredentials)
          .set({
            credentials: JSON.stringify(next),
            encryptionMetadata: {
              algorithm: next.algorithm,
              keyDerivation: next.keyDerivation,
            },
          })
          .where(eq(toolCredentials.id, row.id));
      }
      r.reencrypted++;
    } catch (e) {
      r.errors++;
      logRowError(r.surface, String(row.id), "credentials", e);
    }
  }
  return r;
}

async function rotateOauthTokens(dryRun: boolean): Promise<SurfaceResult> {
  const r: SurfaceResult = {
    surface: "oauth_tokens.access/refresh",
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    legacy: 0,
  };
  const rows = await db
    .select({
      id: oauthTokens.id,
      accessToken: oauthTokens.accessToken,
      refreshToken: oauthTokens.refreshToken,
    })
    .from(oauthTokens);
  for (const row of rows) {
    const set: Record<string, unknown> = {};
    for (const col of ["accessToken", "refreshToken"] as const) {
      const stored = row[col];
      const enc = parseEncrypted(stored);
      r.scanned++;
      if (!enc || credentialEncryption.isUnderActiveKey(enc)) {
        r.skipped++;
        continue;
      }
      try {
        const data = credentialEncryption.decrypt(enc);
        set[col] = JSON.stringify(credentialEncryption.encrypt(data));
        r.reencrypted++;
      } catch (e) {
        r.errors++;
        logRowError(r.surface, String(row.id), col, e);
      }
    }
    if (Object.keys(set).length > 0 && !dryRun) {
      await db.update(oauthTokens).set(set).where(eq(oauthTokens.id, row.id));
    }
  }
  return r;
}

function logRowError(
  surface: string,
  id: string,
  column: string,
  e: unknown,
): void {
  // Never log the secret value — only the location and error class.
  console.error(
    `[secret-rotation] ${surface} id=${id} column=${column} failed: ${
      e instanceof Error ? e.message : String(e)
    }`,
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
  // In a dry run the "remaining" count is what still needs rotating.
  const remaining = dryRun ? totalReencrypted : totalErrors;
  return {
    dryRun,
    surfaces,
    totalReencrypted,
    totalErrors,
    totalLegacy,
    remaining,
  };
}
