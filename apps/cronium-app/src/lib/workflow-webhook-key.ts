import { createHash } from "crypto";
import { nanoid } from "nanoid";

/**
 * Workflow webhook keys (HI-12). The key is a bearer credential in the public
 * trigger URL, so it is generated server-side with high entropy and only its
 * SHA-256 hash is stored; the plaintext is shown once at creation/rotation.
 */

/** ~190-bit unguessable, effectively-unique key. Never caller-chosen. */
export function generateWorkflowWebhookKey(): string {
  return nanoid(32);
}

/** SHA-256 hex of a workflow webhook key (only the hash is stored/looked up). */
export function hashWorkflowWebhookKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Mint a new key: plaintext (shown once) + the DB fields to persist. */
export function newWorkflowWebhookKeyFields(): {
  plaintext: string;
  webhookKey: null;
  webhookKeyHash: string;
} {
  const plaintext = generateWorkflowWebhookKey();
  return {
    plaintext,
    webhookKey: null,
    webhookKeyHash: hashWorkflowWebhookKey(plaintext),
  };
}
