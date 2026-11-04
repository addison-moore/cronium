/**
 * Resolve a caller-supplied redirect target against `baseUrl`, returning it only
 * if it stays on the same origin. Returns null otherwise.
 *
 * Parsing is what makes this safe; prefix checks are not. `https://app.example
 * .evil.com` starts with the base URL, `//evil.com` and `/\evil.com` start with a
 * slash, and `javascript:alert(1)` is a URL too. All of them resolve to some other
 * origin here. Client-safe: no Node built-ins.
 */
export function sameOriginRedirect(
  url: string,
  baseUrl: string,
): string | null {
  try {
    const base = new URL(baseUrl);
    const target = new URL(url, base);
    if (target.origin !== base.origin) return null;
    // Keep relative input relative, so the result does not pin the host when the
    // app is reached through a different name than `baseUrl`.
    return url.startsWith("/")
      ? `${target.pathname}${target.search}${target.hash}`
      : target.toString();
  } catch {
    return null;
  }
}
