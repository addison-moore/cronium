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
 * returned as-is so existing webhooks keep verifying, until the secret is
 * regenerated or `rotate:secrets --encrypt-legacy` encrypts them.
 */
export function decryptWebhookSecret(
  stored: string,
  webhookKey: string,
  userId: string,
): string {
  if (!isSecretEnvelope(stored)) return stored; // legacy plaintext
  return getSecretVault().decrypt(stored, binding(webhookKey, userId));
}

/**
 * Custom delivery headers routinely carry credentials (e.g. an `Authorization:
 * Bearer …` a subscriber requires). They are stored encrypted at rest bound to
 * the webhook, and decrypted only when a delivery is signed and sent.
 *
 * The `webhooks.headers` column is jsonb. To avoid changing the column type we
 * store the encrypted form as a small wrapper object `{ __enc: "<envelope>" }`;
 * legacy plaintext rows remain a plain `{ header: value }` object and pass
 * through unchanged, until an update includes headers or
 * `rotate:secrets --encrypt-legacy` encrypts them.
 */
function headersBinding(webhookKey: string, userId: string): SecretBinding {
  return {
    purpose: "webhook-headers",
    table: "webhooks",
    column: "headers",
    recordId: webhookKey,
    tenantId: userId,
  };
}

interface EncryptedHeaders {
  __enc: string;
}

function isEncryptedHeaders(value: unknown): value is EncryptedHeaders {
  return (
    typeof value === "object" &&
    value !== null &&
    "__enc" in value &&
    typeof value.__enc === "string" &&
    isSecretEnvelope((value as EncryptedHeaders).__enc)
  );
}

/** A plaintext `{ header: value }` object, as opposed to empty or encrypted. */
export function isLegacyWebhookHeaders(stored: unknown): boolean {
  return (
    typeof stored === "object" &&
    stored !== null &&
    !Array.isArray(stored) &&
    Object.keys(stored).length > 0 &&
    !isEncryptedHeaders(stored)
  );
}

export function encryptWebhookHeaders(
  headers: Record<string, string> | undefined,
  webhookKey: string,
  userId: string,
): Record<string, string> | EncryptedHeaders {
  const entries = headers ?? {};
  // Nothing to protect — keep an empty object so reads are trivial.
  if (Object.keys(entries).length === 0) return {};
  const envelope = getSecretVault().encrypt(
    JSON.stringify(entries),
    headersBinding(webhookKey, userId),
  );
  return { __enc: envelope };
}

export function decryptWebhookHeaders(
  stored: unknown,
  webhookKey: string,
  userId: string,
): Record<string, string> {
  if (isEncryptedHeaders(stored)) {
    const json = getSecretVault().decrypt(
      stored.__enc,
      headersBinding(webhookKey, userId),
    );
    return JSON.parse(json) as Record<string, string>;
  }
  // Legacy plaintext object (or null/empty) — return as-is.
  if (stored && typeof stored === "object") {
    return stored as Record<string, string>;
  }
  return {};
}
