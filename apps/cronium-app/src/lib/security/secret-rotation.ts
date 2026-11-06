/**
 * Secret key-rotation driver (security plan Phase 2.1: 559/565).
 *
 * Re-encrypts every at-rest secret from a retired key onto the active key, along
 * with the env var copies held by jobs that haven't finished. It is SAFE and
 * RESUMABLE by construction:
 *
 *   - Both keys stay in the ring during rotation (active = ENCRYPTION_KEY,
 *     retired = ENCRYPTION_KEYS_RETIRED), so every row decrypts throughout, for a
 *     process holding both. A running service still on the old key can't read a
 *     row this driver has moved, so the services need both keys before it runs.
 *   - It is idempotent: a row already under the active key is skipped
 *     (vault: `needsReencryption`; credentials: `isUnderActiveKey`). Re-running
 *     after an interruption simply finishes the remainder — that is the
 *     interrupted-rotation recovery. To ROLL BACK, restart the services with the
 *     keys swapped (old active, new retired), then run again with the same keys.
 *   - Each row is updated independently; a single unreadable row is recorded as
 *     an error and skipped rather than aborting the whole run.
 *   - Decryption is authenticated (AES-GCM + AAD binding), so a wrong key or
 *     binding throws — it can never write mis-bound ciphertext.
 *
 * Operator runbook: "Key rotation" in docs/ENVIRONMENT_VARIABLES.md. The order
 * matters, because the wrong one loses data:
 *   1. restart the services with ENCRYPTION_KEY=<new>, ENCRYPTION_KEYS_RETIRED=["<old>"]
 *   2. run this driver until it reports 0 re-encrypted
 *   3. remove <old> and restart the services
 *
 * Plaintext from before encryption at rest is not this driver's job, though it
 * counts it as `legacy`: `legacy-secrets.ts` encrypts it.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { isSystemSettingSensitive } from "@/lib/encryption-service";
import { NON_TERMINAL_JOB_STATUSES } from "@/lib/scheduling/job-transition";
import { db } from "@/server/db";
import {
  apiTokens,
  servers,
  envVars,
  jobs,
  systemSettings,
  TokenStatus,
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
} from "@/lib/security/credential-encryption";
import { describeFailure } from "@/lib/pg-errors";

export interface SurfaceResult {
  surface: string;
  scanned: number;
  reencrypted: number;
  skipped: number;
  errors: number;
  // Non-null values in an always-secret column that are NOT vault envelopes. On
  // servers, env vars and MFA secrets these are legacy static-AAD ciphertext still
  // bound to the CURRENT ENCRYPTION_KEY: the driver cannot rotate them (it would
  // orphan them under the retired key), so they must be migrated to vault envelopes
  // first (lazy passthrough on write) BEFORE the key is rotated. On webhooks and
  // user variables they are plaintext, which a key change can't orphan and which
  // `legacy-secrets.ts` encrypts. Elsewhere `legacyAdvice` says what they are.
  legacy: number;
  /**
   * Where saving the record again isn't the fix: a sentence following the count,
   * saying what these are and what to do about them.
   */
  legacyAdvice?: string;
  /** Which rows `legacy` counts, for that advice. Never a stored value. */
  legacyNames?: string[];
}

export interface RotationReport {
  dryRun: boolean;
  surfaces: SurfaceResult[];
  totalReencrypted: number;
  totalErrors: number;
  totalLegacy: number;
  /** The part of totalLegacy that is plaintext `--encrypt-legacy` can encrypt. */
  plaintextLegacy: number;
  remaining: number;
}

/**
 * A non-null, always-secret value that is NOT a vault envelope. Counting these lets
 * the driver warn about them: see `SurfaceResult.legacy` for what they are.
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

/**
 * A job copies its event's env vars into `payload.environment` when it's queued and
 * reads that copy when it's claimed, under the same binding as `env_vars.value`. So a
 * job still waiting when the old key goes fails, however well its event's rows moved.
 *
 * Finished jobs are left out. Terminal states are absorbing, so nothing decrypts their
 * copies again, and there can be a lot of them.
 *
 * Job rows change constantly, with lease renewals and status changes, so a row version
 * would miss for no reason. This writes only the values it moved, and only if they're
 * still what it read. Nothing else writes `payload` after a job is created, so a miss
 * shouldn't happen. If one does, it counts as skipped and a later pass finishes it.
 */
async function rotateJobEnvironments(dryRun: boolean): Promise<SurfaceResult> {
  const legacyJobs: string[] = [];
  const r: SurfaceResult = {
    surface: "jobs.payload.environment",
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    legacy: 0,
    legacyAdvice:
      "env var value(s) copied into unfinished jobs aren't in the vault, so this driver can't move them, and those jobs fail with \"Could not prepare this job to run\" once ENCRYPTION_KEY isn't the key they were saved under. Let these jobs finish before the key changes, or cancel them and run their events again:",
    legacyNames: legacyJobs,
  };
  const rows = await db
    .select({
      id: jobs.id,
      eventId: jobs.eventId,
      environment: sql<Record<string, unknown>>`${jobs.payload}->'environment'`,
    })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, NON_TERMINAL_JOB_STATUSES),
        sql`jsonb_typeof(${jobs.payload}->'environment') = 'object'`,
      ),
    );
  for (const row of rows) {
    const read: [string, string][] = [];
    const moved: [string, string][] = [];
    for (const [key, value] of Object.entries(row.environment)) {
      r.scanned++;
      if (typeof value !== "string") {
        r.skipped++;
      } else if (!isSecretEnvelope(value) && looksLikeLegacyCiphertext(value)) {
        // Unlike `env_vars.value`, plaintext isn't counted: it reads back under any
        // key, and nothing will ever encrypt this copy.
        r.legacy++;
        if (legacyJobs.at(-1) !== row.id) legacyJobs.push(row.id);
      } else if (!vaultNeedsReencrypt(value)) {
        r.skipped++;
      } else {
        try {
          const pt = decryptEnvVarValue(value, row.eventId, key);
          moved.push([key, encryptEnvVarValue(pt, row.eventId, key)]);
          read.push([key, value]);
        } catch (e) {
          r.errors++;
          logRowError(r.surface, row.id, "environment", e);
        }
      }
    }
    if (moved.length === 0) continue;
    if (dryRun) {
      r.reencrypted += moved.length;
      continue;
    }
    try {
      const written = await db
        .update(jobs)
        .set({
          payload: sql`jsonb_set(${jobs.payload}, '{environment}', (${jobs.payload}->'environment') || ${JSON.stringify(Object.fromEntries(moved))}::jsonb)`,
        })
        .where(
          and(
            eq(jobs.id, row.id),
            sql`${jobs.payload}->'environment' @> ${JSON.stringify(Object.fromEntries(read))}::jsonb`,
          ),
        );
      if ((written.rowCount ?? 0) > 0) r.reencrypted += moved.length;
      else r.skipped += moved.length;
    } catch (e) {
      r.errors += moved.length;
      logRowError(r.surface, row.id, "environment", e);
    }
  }
  return r;
}

async function rotateSystemSettings(dryRun: boolean): Promise<SurfaceResult> {
  const legacySettings: string[] = [];
  const r: SurfaceResult = {
    surface: "system_settings.value",
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    legacy: 0,
    legacyAdvice:
      "sensitive setting(s) aren't in the vault, so the app can only read them while ENCRYPTION_KEY is the key they were saved under. After that it uses the stored ciphertext as the value. Enter each one again in the admin settings before the key changes (a blank field keeps the old value):",
    legacyNames: legacySettings,
  };
  const rows = await db
    .select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings);
  for (const row of rows) {
    r.scanned++;
    // Only the sensitive keys are meant to be encrypted. The rest are plain by design.
    if (isSystemSettingSensitive(row.key) && isLegacyValue(row.value)) {
      r.legacy++;
      legacySettings.push(row.key);
      continue;
    }
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
    let headersNext: unknown;
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
    r.scanned++;
    const enc = (row.headers as { __enc?: unknown } | null)?.__enc;
    if (isLegacyWebhookHeaders(row.headers)) {
      r.legacy++;
    } else if (typeof enc === "string" && vaultNeedsReencrypt(enc)) {
      try {
        const decoded = decryptWebhookHeaders(row.headers, row.key, row.userId);
        headersNext = encryptWebhookHeaders(decoded, row.key, row.userId);
      } catch (e) {
        r.errors++;
        logRowError(r.surface, String(row.id), "headers", e);
      }
    } else {
      r.skipped++;
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
    const enc = row.encrypted ? parseEncryptedData(row.credentials) : null;
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
      const enc = parseEncryptedData(stored);
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

// What `hashApiToken` stores. `storage.getApiTokenByToken` tells old tokens apart
// from hashed ones the same way.
const HASHED_API_TOKEN = /^[0-9a-f]{64}$/;

/**
 * API tokens from before hashing are ciphertext, hashed the first time each is used.
 * That lookup decrypts with the active key alone, so one nobody has used by the time
 * the key changes gets a 401 from then on. Only reports them, so it writes nothing.
 *
 * Revoked and expired tokens get a 401 either way, so they aren't counted.
 */
async function reportUnhashedApiTokens(): Promise<SurfaceResult> {
  const unhashed: string[] = [];
  const r: SurfaceResult = {
    surface: "api_tokens.token",
    scanned: 0,
    reencrypted: 0,
    skipped: 0,
    errors: 0,
    legacy: 0,
    legacyAdvice:
      "API token(s) haven't been used since tokens began to be stored hashed, and get a 401 once ENCRYPTION_KEY isn't the key they were saved under. Use each one once before the key changes, which hashes it, or issue a new one:",
    legacyNames: unhashed,
  };
  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      token: apiTokens.token,
      status: apiTokens.status,
      expiresAt: apiTokens.expiresAt,
    })
    .from(apiTokens)
    .orderBy(asc(apiTokens.id));
  const now = Date.now();
  for (const row of rows) {
    r.scanned++;
    const usable =
      row.status === TokenStatus.ACTIVE &&
      !(row.expiresAt && row.expiresAt.getTime() < now);
    if (usable && !HASHED_API_TOKEN.test(row.token)) {
      r.legacy++;
      // Stringified because a name can hold anything, and this goes to a terminal.
      unhashed.push(`id=${row.id} ${JSON.stringify(row.name)}`);
    } else {
      r.skipped++;
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
    `[secret-rotation] ${surface} id=${id} column=${column} failed: ${describeFailure(
      e,
    )}`,
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
  // After env_vars, because jobs copy those rows when they're queued. A job queued from
  // a row that hadn't moved yet is caught here, or by the next pass if it's queued after
  // this scan, which is why the runbook repeats until a pass moves nothing.
  surfaces.push(await rotateJobEnvironments(dryRun));
  surfaces.push(await rotateSystemSettings(dryRun));
  surfaces.push(await rotateMfaSecrets(dryRun));
  const userVariableResult = await rotateUserVariables(dryRun);
  surfaces.push(userVariableResult);
  const webhookResult = await rotateWebhooks(dryRun);
  surfaces.push(webhookResult);
  surfaces.push(await rotateToolCredentials(dryRun));
  surfaces.push(await rotateOauthTokens(dryRun));
  surfaces.push(await reportUnhashedApiTokens());

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
    plaintextLegacy: userVariableResult.legacy + webhookResult.legacy,
    remaining,
  };
}
