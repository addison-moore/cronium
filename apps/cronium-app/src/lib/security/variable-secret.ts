import {
  getSecretVault,
  isSecretEnvelope,
  type SecretBinding,
} from "@/lib/security/secret-vault";

/**
 * User variables can hold secrets (API keys, tokens) that scripts read via
 * `cronium.getVariable()`. They are stored encrypted at rest with the versioned
 * vault (Phase 2.2 / HI-09) and decrypted only at the authorized read
 * boundaries: the owner's own reads and the internal per-execution resolution
 * endpoint. The value is bound to its `{userId, key}` so a ciphertext cannot be
 * swapped to another variable or tenant.
 */
function binding(userId: string, key: string): SecretBinding {
  return {
    purpose: "user-variable",
    table: "user_variables",
    column: "value",
    recordId: key,
    tenantId: userId,
  };
}

export function encryptVariableValue(
  value: string,
  userId: string,
  key: string,
): string {
  return getSecretVault().encrypt(value, binding(userId, key));
}

/**
 * Decrypt a stored variable value. Legacy plaintext rows (pre-encryption) are
 * returned as-is so existing variables keep working; they are re-encrypted the
 * next time they are written.
 */
export function decryptVariableValue(
  stored: string,
  userId: string,
  key: string,
): string {
  if (!isSecretEnvelope(stored)) return stored; // legacy plaintext
  return getSecretVault().decrypt(stored, binding(userId, key));
}
