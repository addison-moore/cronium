import { createDecipheriv } from "crypto";
import {
  getSecretVault,
  isSecretEnvelope,
  type SecretBinding,
} from "@/lib/security/secret-vault";

/**
 * Record-bound encryption for the remaining at-rest secret columns (Phase 2.1),
 * migrating them off the legacy static-AAD `encryption-service` scheme onto the
 * versioned, record-bound vault.
 *
 * Every value is bound to its record identity + tenant, so a database-level
 * attacker cannot swap a ciphertext between rows or tenants (the legacy scheme's
 * single fixed AAD let any ciphertext decrypt in any row).
 *
 * Migration is NON-BREAKING: writes always produce vault envelopes, but reads
 * fall back to the legacy scheme for values that are not yet vault envelopes, so
 * existing ciphertext keeps decrypting and rows migrate as they are rewritten.
 * Plaintext/legacy values pass through the legacy decrypt unchanged.
 */

function encrypt(plaintext: string, binding: SecretBinding): string {
  return getSecretVault().encrypt(plaintext, binding);
}

function decrypt(stored: string, binding: SecretBinding): string {
  if (isSecretEnvelope(stored)) {
    return getSecretVault().decrypt(stored, binding);
  }
  // Not a vault envelope: legacy static-AAD ciphertext, or plaintext.
  return legacyDecrypt(stored);
}

// AES-256-GCM decrypt for the FROZEN legacy scheme this migration supersedes
// (matches the old encryption-service: IV[16] || ciphertext || tag[16], base64,
// static AAD). Inlined here (reading ENCRYPTION_KEY directly, like the vault) so
// the migration helpers don't pull in the env.mjs module graph. Non-ciphertext
// values pass through unchanged.
const LEGACY_AAD = Buffer.from("cronium-server-encryption");
const IV_LEN = 16;
const TAG_LEN = 16;

/**
 * Whether a read would try to decrypt this as legacy ciphertext rather than pass it
 * through. This is only a guess from its shape: a long plaintext made of base64
 * characters looks the same, and a read of one fails.
 */
export function looksLikeLegacyCiphertext(stored: string): boolean {
  if (stored.length < 50 || !/^[A-Za-z0-9+/=]+$/.test(stored)) return false;
  return Buffer.from(stored, "base64").length >= IV_LEN + TAG_LEN + 1;
}

function openLegacyCiphertext(stored: string, masterKey: Buffer): string {
  const combined = Buffer.from(stored, "base64");
  const iv = combined.subarray(0, IV_LEN);
  const tag = combined.subarray(-TAG_LEN);
  const ciphertext = combined.subarray(IV_LEN, -TAG_LEN);

  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAAD(LEGACY_AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function legacyDecrypt(stored: string): string {
  if (!stored) return stored;
  if (!looksLikeLegacyCiphertext(stored)) return stored;

  const masterKeyHex = process.env.ENCRYPTION_KEY;
  if (!masterKeyHex) {
    throw new Error("ENCRYPTION_KEY is required to decrypt legacy ciphertext");
  }
  return openLegacyCiphertext(stored, Buffer.from(masterKeyHex, "hex"));
}

/**
 * Whether this is legacy ciphertext that authenticates under `masterKey`. A read
 * can't answer that: getting a value back from it may only mean it was passed through.
 */
export function isLegacyCiphertextUnderKey(
  stored: string,
  masterKey: Buffer,
): boolean {
  if (!looksLikeLegacyCiphertext(stored)) return false;
  try {
    openLegacyCiphertext(stored, masterKey);
    return true;
  } catch {
    return false;
  }
}

/* ---- servers.sshKey / servers.password (bound to userId + column) ----
 *
 * Bound to the owning tenant and the column, which is available at both create
 * and read without an id lookup or a two-step write (servers carry live SSH
 * credentials, so we keep this path simple to minimise risk). This prevents the
 * realistic threat — a database-level attacker moving one tenant's credential
 * ciphertext into another tenant's server row (the AAD's userId would not
 * match). Moving a credential between a single owner's own servers is not
 * meaningfully exploitable (they own both).
 */

function serverBinding(
  column: "sshKey" | "password",
  userId: string,
): SecretBinding {
  return {
    purpose: "server-secret",
    table: "servers",
    column,
    recordId: userId,
    tenantId: userId,
  };
}

export function encryptServerSecret(
  plaintext: string,
  column: "sshKey" | "password",
  userId: string,
): string {
  return encrypt(plaintext, serverBinding(column, userId));
}

export function decryptServerSecret(
  stored: string,
  column: "sshKey" | "password",
  userId: string,
): string {
  return decrypt(stored, serverBinding(column, userId));
}

/* ---- env_vars.value (bound to eventId + key) ----
 *
 * An env var belongs to exactly one event, and an event to exactly one tenant,
 * so (eventId, key) is a complete record identity: the event is the tenant
 * scope (swapping a ciphertext to another user's event changes eventId and
 * fails the AAD) and the key is the record within it. No separate userId lookup
 * is needed, which keeps the binding reconstructible at every hop the value
 * travels (env_vars row -> jobs.payload.environment -> delivery decrypt).
 */

function envVarBinding(eventId: number | string, key: string): SecretBinding {
  return {
    purpose: "env-var",
    table: "env_vars",
    column: "value",
    recordId: key,
    tenantId: String(eventId),
  };
}

export function encryptEnvVarValue(
  plaintext: string,
  eventId: number | string,
  key: string,
): string {
  return encrypt(plaintext, envVarBinding(eventId, key));
}

// Upper bound on the unwrap below. A row gains one layer per save, so this only
// has to outlast how often anyone edited an event while the bug was live; it
// exists to bound the work, not as a meaningful limit.
const MAX_ENV_VAR_ENVELOPE_DEPTH = 32;

/**
 * Decrypt an env var value, unwrapping any nested envelopes bound to the same
 * (eventId, key).
 *
 * The unwrap repairs rows corrupted before the event read path decrypted values:
 * the edit form was handed ciphertext and saved it back, and each save encrypted
 * the previous ciphertext again, so a script received `crn.1...` instead of its
 * secret. It is safe to apply unconditionally, because an inner value only
 * decrypts if AES-GCM authenticates it under this exact binding, which only this
 * code can produce. Anything else that merely starts with `crn.` is the user's
 * real value and is returned as is.
 */
export function decryptEnvVarValue(
  stored: string,
  eventId: number | string,
  key: string,
): string {
  const binding = envVarBinding(eventId, key);
  let value = decrypt(stored, binding);
  for (
    let depth = 0;
    depth < MAX_ENV_VAR_ENVELOPE_DEPTH && isSecretEnvelope(value);
    depth++
  ) {
    try {
      value = getSecretVault().decrypt(value, binding);
    } catch {
      break;
    }
  }
  return value;
}

/**
 * Whether `value` is already a ciphertext for this exact (eventId, key). Lets the
 * write path keep such a value as is instead of wrapping it again when a client
 * submits back what an older read handed it.
 */
export function isEnvVarCiphertext(
  value: string,
  eventId: number | string,
  key: string,
): boolean {
  if (!isSecretEnvelope(value)) return false;
  try {
    getSecretVault().decrypt(value, envVarBinding(eventId, key));
    return true;
  } catch {
    return false;
  }
}

/* ---- system_settings (secret values, bound to the setting key) ---- */

function systemSettingBinding(key: string): SecretBinding {
  return {
    purpose: "system-setting",
    table: "system_settings",
    column: "value",
    recordId: key,
    // System settings are global (no tenant); the key is the record identity.
    tenantId: "system",
  };
}

export function encryptSystemSetting(plaintext: string, key: string): string {
  return encrypt(plaintext, systemSettingBinding(key));
}

export function decryptSystemSetting(stored: string, key: string): string {
  return decrypt(stored, systemSettingBinding(key));
}

/* ---- users.mfaSecret (bound to userId) ---- */

function mfaBinding(userId: string): SecretBinding {
  return {
    purpose: "mfa-secret",
    table: "users",
    column: "mfaSecret",
    recordId: userId,
    tenantId: userId,
  };
}

export function encryptMfaSecret(plaintext: string, userId: string): string {
  return encrypt(plaintext, mfaBinding(userId));
}

export function decryptMfaSecret(stored: string, userId: string): string {
  return decrypt(stored, mfaBinding(userId));
}
