/**
 * Keep decrypted tool credentials on the server.
 *
 * Tool credential queries used to return the full decrypted credentials to the
 * browser (SMTP passwords, webhook URLs, API tokens), relying on the UI to hide
 * them — so every secret was present in network responses and client memory.
 *
 * `redactCredentialValues` blanks secret-looking fields for responses;
 * `mergeCredentials` lets an edit submit a blank secret to mean "keep the
 * current value", so editing a non-secret field never wipes or requires
 * re-typing the secret.
 */
const SECRET_KEY =
  /(webhookurl|token|password|passwd|secret|apikey|api_key|credential|authorization|bearer|privatekey|private_key|clientsecret)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/** Return a copy with secret-keyed values blanked (non-secret fields kept). */
export function redactCredentialValues(
  credentials: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(credentials)) {
    out[k] = isSecretKey(k) && v != null && v !== "" ? "" : v;
  }
  return out;
}

/**
 * Merge an incoming (possibly-redacted) credential object with the existing
 * decrypted one: a blank/absent secret field falls back to the existing value.
 */
export function mergeCredentials(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  for (const key of Object.keys({ ...incoming, ...existing })) {
    const incomingValue = incoming[key];
    const isBlank = incomingValue == null || incomingValue === "";
    if (isSecretKey(key) && isBlank && existing[key] != null) {
      out[key] = existing[key];
    }
  }
  return out;
}
