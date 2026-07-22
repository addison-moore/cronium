import {
  getSecretVault,
  isSecretEnvelope,
  type SecretBinding,
} from "@/lib/security/secret-vault";

/**
 * The webhook HMAC secret is shared between Cronium and the external party. It
 * is stored encrypted at rest with the versioned vault (Phase 2.2 / HI-09), and
 * decrypted only at the two consumption points (inbound signature verification
 * and outbound delivery signing). The plaintext is shown to the owner exactly
 * once, at creation and rotation.
 *
 * The record binding uses the webhook `key` (unique, stable, known before
 * insert) as the row identity, so a ciphertext cannot be swapped between
 * webhooks or tenants.
 */
function binding(webhookKey: string, userId: string): SecretBinding {
  return {
    purpose: "webhook-secret",
    table: "webhooks",
    column: "secret",
    recordId: webhookKey,
    tenantId: userId,
  };
}

export function encryptWebhookSecret(
  secret: string,
  webhookKey: string,
  userId: string,
): string {
  return getSecretVault().encrypt(secret, binding(webhookKey, userId));
}

/**
 * Decrypt a stored webhook secret. Legacy plaintext rows (pre-encryption) are
 * returned as-is so existing webhooks keep verifying; they are re-encrypted the
 * next time the secret is rotated.
 */
export function decryptWebhookSecret(
  stored: string,
  webhookKey: string,
  userId: string,
): string {
  if (!isSecretEnvelope(stored)) return stored; // legacy plaintext
  return getSecretVault().decrypt(stored, binding(webhookKey, userId));
}
