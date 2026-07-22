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

function legacyDecrypt(stored: string): string {
  if (!stored) return stored;
  if (stored.length < 50 || !/^[A-Za-z0-9+/=]+$/.test(stored)) return stored;

  const masterKeyHex = process.env.ENCRYPTION_KEY;
  if (!masterKeyHex) {
    throw new Error("ENCRYPTION_KEY is required to decrypt legacy ciphertext");
  }
  const masterKey = Buffer.from(masterKeyHex, "hex");

  let combined: Buffer;
  try {
    combined = Buffer.from(stored, "base64");
  } catch {
    return stored;
  }
  if (combined.length < IV_LEN + TAG_LEN + 1) return stored;

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

export function decryptEnvVarValue(
  stored: string,
  eventId: number | string,
  key: string,
): string {
  return decrypt(stored, envVarBinding(eventId, key));
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
