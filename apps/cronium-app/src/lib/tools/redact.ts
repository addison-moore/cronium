/**
 * Redact secret-bearing fields from tool action parameters/results before they
 * are logged or persisted. Tool parameters can carry secrets (Teams passes its
 * webhook URL as a per-execution parameter; OAuth tokens are injected as
 * `oauthToken`), and those were being written verbatim to stdout and to the
 * `toolActionLogs.parameters` column in plaintext.
 *
 * Redaction is both key-aware and value-aware (Phase 2.5 / ME-02): a secret is
 * masked when its KEY looks sensitive, or when the VALUE looks like a
 * credential (a bearer/JWT token, a long high-entropy string, a URL carrying an
 * embedded secret) even under an innocuous key. There is no depth cutoff — the
 * whole structure is walked (bounded only by a cycle guard) so a secret nested
 * deep in a payload cannot slip through.
 */
const SECRET_KEY =
  /(webhookurl|token|password|passwd|secret|apikey|api_key|credential|authorization|bearer|privatekey|private_key|access[_-]?key|client[_-]?secret|refresh[_-]?token|session)/i;

const REDACTED = "[REDACTED]";

// JWT-shaped, "Bearer <token>", or a long high-entropy blob.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/;
const BEARER_RE = /^Bearer\s+\S{12,}$/i;
const LONG_SECRET_RE = /^[A-Za-z0-9+/_=-]{40,}$/;

function looksLikeSecretValue(value: string): boolean {
  if (JWT_RE.test(value)) return true;
  if (BEARER_RE.test(value)) return true;
  // A URL with an embedded token/key query param or userinfo credential.
  if (
    /[?&](token|api[_-]?key|access[_-]?token|signature|sig)=/i.test(value) ||
    /:\/\/[^/@\s]+:[^/@\s]+@/.test(value)
  ) {
    return true;
  }
  return false;
}

function redactString(key: string, value: string): string {
  if (value === "") return value;
  if (SECRET_KEY.test(key)) return REDACTED;
  if (looksLikeSecretValue(value)) return REDACTED;
  // Long opaque high-entropy strings under a non-secret key are likely secrets.
  if (
    LONG_SECRET_RE.test(value) &&
    /[0-9]/.test(value) &&
    /[A-Za-z]/.test(value)
  ) {
    return REDACTED;
  }
  return value;
}

export function redactSecrets(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") {
    return redactString("", value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((v) => redactSecrets(v, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string") {
        out[k] = redactString(k, v);
      } else if (SECRET_KEY.test(k) && v != null) {
        out[k] = REDACTED;
      } else {
        out[k] = redactSecrets(v, seen);
      }
    }
    return out;
  }
  return value;
}
