/**
 * Secret key-rotation driver (security plan Phase 2.1: 559/565).
 *
 * Re-encrypts every at-rest secret from a retired key onto the active key, along
 * with the env var copies held by jobs that haven't finished, and hashes API tokens
 * from before tokens were hashed. It is SAFE and RESUMABLE by construction:
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
 *   - Each row is one UPDATE; a row that can't be read or written is recorded as an
 *     error and skipped rather than aborting the whole run.
 *   - It never overwrites a newer value. The app keeps running during this, so each
 *     UPDATE only applies to the row version it read. A row changed in between, such
 *     as a secret someone just regenerated, is left as they saved it, counted as
 *     neither re-encrypted nor an error, and picked up by a later run.
 *   - Decryption is authenticated (AES-GCM + AAD binding), so a wrong key or
 *     binding throws — it can never write mis-bound ciphertext.
 *
 * Operator runbook: "Key rotation" in docs/ENVIRONMENT_VARIABLES.md. The order
 * matters, because the wrong one loses data:
 *   1. restart the services with ENCRYPTION_KEY=<new>, ENCRYPTION_KEYS_RETIRED=["<old>"]
 *   2. run this driver until it reports 0 re-encrypted
 *   3. remove <old> and restart the services
 *
 * Values from before the vault are not this driver's job, though it counts them as
 * `legacy`: `legacy-secrets.ts` moves them into it.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { hashApiToken } from "@/lib/api-token-hash";
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
  openLegacyCiphertextInRing,
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
  /**
   * Only on API tokens, in place of `reencrypted`: values hashed, or in a dry run the
   * values that would be. A hash needs no key, so nothing ever re-encrypts them.
   */
  hashed?: number;
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
  // ciphertext or plaintext. On webhooks, variables, tool credentials and OAuth tokens
  // they're plaintext, or on tool credentials a row whose `encrypted` flag doesn't match
  // what it holds. Elsewhere `legacyAdvice` says what they are.
  legacy: number;
  /**
   * The part of `legacy` that has the shape of static-AAD ciphertext, which only opens
   * under the key it was written with, so a key change can orphan it. A key change
   * can't orphan the rest.
   */
  legacyCiphertext: number;
  /**
   * Where the general warnings don't fit: a sentence following the count, saying what
   * these are and what to do about them.
   */
  legacyAdvice?: string;
  /** Which rows `legacy` counts, for that advice. Never a stored value. */
  legacyNames?: string[];
}

export interface RotationReport {
  dryRun: boolean;
  surfaces: SurfaceResult[];
  totalReencrypted: number;
  totalHashed: number;
  totalErrors: number;
  totalLegacy: number;
  /** What a key change can't orphan, among values with no `legacyAdvice` of their own. */
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
function isLegacyValue(value: string | null | undefined): boolean {
  return !!value && !isSecretEnvelope(value);
}

function countLegacy(r: SurfaceResult, value: string | null): void {
  r.legacy++;
  if (value && looksLikeLegacyCiphertext(value)) r.legacyCiphertext++;
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
 * shouldn't happen. If one does, it counts as changed during the run, as it does on the
 * other surfaces, because that copy may still be under the old key. A later pass
 * finishes it.
 */
async function rotateJobEnvironments(dryRun: boolean): Promise<SurfaceResult> {
  const legacyJobs: string[] = [];
  const r: SurfaceResult = {
    ...emptyResult("jobs.payload.environment"),
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
      else r.changedDuringRun += moved.length;
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
    ...emptyResult("system_settings.value"),
    legacyAdvice:
      "sensitive setting(s) aren't in the vault. Older ciphertext can only be read while ENCRYPTION_KEY is the key it was saved under, and after that the app uses the ciphertext as the value. To move them into the vault, run this again with --encrypt-legacy before the key changes:",
    legacyNames: legacySettings,
  };
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
      r.legacy++; // Always plaintext, whatever it looks like.
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
        .where(and(eq(toolCredentials.id, row.id), isRowVersion(row.version))),
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

// What `hashApiToken` stores. `storage.getApiTokenByToken` tells old tokens apart
// from hashed ones the same way.
const HASHED_API_TOKEN = /^[0-9a-f]{64}$/;

/**
 * API tokens from before hashing are ciphertext, hashed the first time each is used.
 * That lookup decrypts with the active key alone, so one nobody has used by the time
 * the key changes would get a 401 for good. This hashes them while the old key is in
 * the ring, so nobody has to use or replace one.
 *
 * The lookup can hash the same row at the same moment, so this applies only to the row
 * version it read. A miss means the row was hashed, revoked or deleted, which leaves
 * nothing under the old key, so it counts as skipped. `changedDuringRun` would make the
 * run exit non-zero, to say a value may still need moving, and here none does.
 *
 * Revoked and expired tokens get a 401 either way, and nothing makes one usable again,
 * so they stay as they are and aren't counted.
 */
async function hashLegacyApiTokens(dryRun: boolean): Promise<SurfaceResult> {
  const unopened: string[] = [];
  const r: SurfaceResult & { hashed: number } = {
    ...emptyResult("api_tokens.token"),
    hashed: 0,
    legacyAdvice:
      "API token(s) from before tokens were hashed can't be hashed now, because no key in the ring opens them, and they get a 401. Add the key each was saved under to ENCRYPTION_KEYS_RETIRED and run this again, or issue a new one:",
    legacyNames: unopened,
  };
  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      token: apiTokens.token,
      status: apiTokens.status,
      expiresAt: apiTokens.expiresAt,
      version: rowVersion,
    })
    .from(apiTokens)
    .orderBy(asc(apiTokens.id));
  const now = Date.now();
  for (const row of rows) {
    r.scanned++;
    const usable =
      row.status === TokenStatus.ACTIVE &&
      !(row.expiresAt && row.expiresAt.getTime() < now);
    if (!usable || HASHED_API_TOKEN.test(row.token)) {
      r.skipped++;
      continue;
    }
    const raw = openLegacyCiphertextInRing(row.token);
    if (raw === null) {
      r.legacy++;
      // Stringified because a name can hold anything, and this goes to a terminal.
      unopened.push(`id=${row.id} ${JSON.stringify(row.name)}`);
      continue;
    }
    if (dryRun) {
      r.hashed++;
      continue;
    }
    try {
      const written = await db
        .update(apiTokens)
        .set({ token: hashApiToken(raw) })
        .where(and(eq(apiTokens.id, row.id), isRowVersion(row.version)));
      if ((written.rowCount ?? 0) > 0) r.hashed++;
      else r.skipped++;
    } catch (e) {
      r.errors++;
      logRowError(r.surface, String(row.id), "token", e);
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
  // After env_vars, because jobs copy those rows when they're queued. A job queued from
  // a row that hadn't moved yet is caught here, or by the next pass if it's queued after
  // this scan, which is why the runbook repeats until a pass moves nothing.
  surfaces.push(await rotateJobEnvironments(dryRun));
  surfaces.push(await rotateSystemSettings(dryRun));
  surfaces.push(await rotateMfaSecrets(dryRun));
  surfaces.push(await rotateUserVariables(dryRun));
  surfaces.push(await rotateWebhooks(dryRun));
  surfaces.push(await rotateToolCredentials(dryRun));
  surfaces.push(await rotateOauthTokens(dryRun));
  surfaces.push(await hashLegacyApiTokens(dryRun));

  const totalReencrypted = surfaces.reduce((n, s) => n + s.reencrypted, 0);
  const totalHashed = surfaces.reduce((n, s) => n + (s.hashed ?? 0), 0);
  const totalErrors = surfaces.reduce((n, s) => n + s.errors, 0);
  const totalLegacy = surfaces.reduce((n, s) => n + s.legacy, 0);
  const totalChangedDuringRun = surfaces.reduce(
    (n, s) => n + s.changedDuringRun,
    0,
  );
  // In a dry run the "remaining" count is what still needs rotating.
  const remaining = dryRun
    ? totalReencrypted + totalHashed
    : totalErrors + totalChangedDuringRun;
  return {
    dryRun,
    surfaces,
    totalReencrypted,
    totalHashed,
    totalErrors,
    totalLegacy,
    plaintextLegacy: surfaces
      .filter((s) => !s.legacyAdvice)
      .reduce((n, s) => n + s.legacy - s.legacyCiphertext, 0),
    totalChangedDuringRun,
    remaining,
  };
}
