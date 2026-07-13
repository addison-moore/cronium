/**
 * Redact secret-bearing fields from tool action parameters/results before they
 * are logged or persisted. Tool parameters can carry secrets (Teams passes its
 * webhook URL as a per-execution parameter; OAuth tokens are injected as
 * `oauthToken`), and those were being written verbatim to stdout and to the
 * `toolActionLogs.parameters` column in plaintext.
 *
 * Only keys that look secret are masked; message bodies, channels, subjects,
 * etc. are left intact so logs stay useful for debugging.
 */
const SECRET_KEY =
  /(webhookurl|token|password|passwd|secret|apikey|api_key|credential|authorization|bearer|privatekey|private_key)/i;

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        SECRET_KEY.test(k) && v != null && v !== ""
          ? REDACTED
          : redactSecrets(v, depth + 1);
    }
    return out;
  }
  return value;
}
