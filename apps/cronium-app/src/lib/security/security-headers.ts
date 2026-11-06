/**
 * Browser security headers (security plan Phase 1.6, HI-20 / audit-2 M4).
 *
 * A nonce-based Content-Security-Policy plus the standard hardening headers.
 * The CSP is enforced in production only: Next.js dev (HMR, error overlay,
 * React refresh) requires `unsafe-eval`/`unsafe-inline`, so a strict policy
 * there would break the dev server without improving production security.
 *
 * The policy deliberately avoids broad `unsafe-*` script exceptions:
 *   - script-src allows the per-request nonce, which Next puts on its own tags,
 *     and our own origin, which is where webpack loads lazy chunks from. Inline
 *     scripts without the nonce do not run. It leaves out `strict-dynamic`: that
 *     trusts anything a nonced script inserts, whatever its origin, and it is how
 *     Monaco's CDN build ran here unnoticed. No script may load from another
 *     origin, so a new dependency that tries to fails in the browser.
 *     `'self'` also admits a `<script src>` from our origin without the nonce, so
 *     no route may serve user-controlled content as JavaScript. nosniff, below,
 *     stops any other content type running as a script.
 *   - worker-src allows our own origin only. Monaco's workers are bundled chunks.
 *   - connect-src allows same-origin plus ws/wss for Socket.IO live logs and
 *     the terminal (proxied to the page origin in production).
 *   - style-src allows `unsafe-inline`: Next/Tailwind inject style attributes
 *     and per-style nonces are not practical. Styles cannot execute script, so
 *     this does not reintroduce XSS.
 *   - frame-ancestors 'none' + object-src 'none' + base-uri 'self' block
 *     clickjacking, plugin, and base-tag injection.
 */

export function buildContentSecurityPolicy(nonce: string): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' ws: wss:`,
    `worker-src 'self'`,
    `frame-src 'self'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ];
  return directives.join("; ");
}

/** Static hardening headers applied on every response. */
export function staticSecurityHeaders(
  isProduction: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Deny access to powerful features by default; widen per-feature if needed.
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  };
  if (isProduction) {
    // Ignored by browsers over plain HTTP, so only meaningful behind TLS.
    headers["Strict-Transport-Security"] =
      "max-age=63072000; includeSubDomains";
  }
  return headers;
}

/**
 * Apply security headers to a response's header map. `applyCsp` should be false
 * in development (see module doc). When true, the caller must have injected the
 * same `nonce` into the request so Next.js applies it to its scripts.
 */
export function applySecurityHeaders(
  target: Headers,
  options: { nonce: string; isProduction: boolean; applyCsp: boolean },
): void {
  for (const [key, value] of Object.entries(
    staticSecurityHeaders(options.isProduction),
  )) {
    target.set(key, value);
  }
  if (options.applyCsp) {
    target.set(
      "Content-Security-Policy",
      buildContentSecurityPolicy(options.nonce),
    );
  }
}
