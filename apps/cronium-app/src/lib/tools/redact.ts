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

/**
 * Redact secrets embedded in free text (provider error messages, stack traces)
 * while keeping the surrounding text readable. `redactSecrets` on a string is
 * all-or-nothing — fine for structured values, but it would erase an entire
 * error message because one token inside it looks secret. This masks only the
 * offending spans: JWTs, `Bearer <blob>` sequences, credential-bearing URLs
 * (userinfo, secret query params, or a high-entropy path segment à la Slack
 * webhook URLs), and standalone high-entropy blobs.
 */
export function redactText(text: string): string {
  if (!text) return text;
  return text
    .replace(new RegExp(JWT_RE.source, "g"), REDACTED)
    .replace(/\bBearer\s+[A-Za-z0-9._+/=-]{12,}/gi, `Bearer ${REDACTED}`)
    .replace(/\bhttps?:\/\/[^\s"'<>)\]]+/gi, (url) => {
      if (/:\/\/[^/@\s]+:[^/@\s]+@/.test(url)) return REDACTED;
      if (
        /[?&](token|api[_-]?key|access[_-]?token|signature|sig|secret)=/i.test(
          url,
        )
      ) {
        return REDACTED;
      }
      const path = url.split(/[?#]/)[0] ?? "";
      const segments = path.split("/").slice(3);
      if (
        segments.some(
          (s) =>
            /^[A-Za-z0-9+_=-]{20,}$/.test(s) &&
            /[0-9]/.test(s) &&
            /[A-Za-z]/.test(s),
        )
      ) {
        return REDACTED;
      }
      return url;
    })
    .replace(/[A-Za-z0-9+/_=-]{40,}/g, (blob) =>
      /[0-9]/.test(blob) && /[A-Za-z]/.test(blob) ? REDACTED : blob,
    );
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
