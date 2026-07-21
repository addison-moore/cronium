/**
 * Trusted client-IP derivation (security plan Phase 1.3/1.4).
 *
 * `X-Forwarded-For` is a client-controllable header: any caller can prepend
 * arbitrary entries. Trusting its leftmost value lets an attacker forge their
 * source IP to evade per-IP rate limits and IP allowlists. We instead trust
 * only `TRUSTED_PROXY_HOPS` proxies and read the entry that many positions
 * from the right — the address the outermost trusted proxy actually observed.
 *
 * With `TRUSTED_PROXY_HOPS=0` (default) forwarding headers are ignored
 * entirely and the caller must supply the direct socket peer address.
 */

function proxyHops(): number {
  // Read lazily and defensively: this helper is used on hostile request paths
  // and must never throw. Falls back to 0 (ignore forwarding headers).
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw === "") return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 10);
}

function normalizeIp(value: string): string | null {
  let ip = value.trim();
  if (!ip) return null;
  // Strip an IPv6 zone id and surrounding brackets from `[::1]:1234` forms.
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end !== -1) ip = ip.slice(1, end);
  } else if (ip.includes(".") && ip.includes(":")) {
    // IPv4:port — drop the port. (Bare IPv6 has many colons; leave it.)
    ip = ip.slice(0, ip.indexOf(":"));
  }
  return ip.length > 0 ? ip : null;
}

/**
 * Resolve the trusted client IP for rate limiting and IP checks.
 *
 * @param forwardedFor the raw `X-Forwarded-For` header value (or null)
 * @param directPeer   the direct socket peer address, when the transport
 *                     exposes it (e.g. a Node request); used when no proxy is
 *                     trusted or the header is too short to trust.
 * @returns the derived IP, or null when it cannot be established under policy.
 */
export function resolveClientIp(
  forwardedFor: string | null | undefined,
  directPeer?: string | null,
): string | null {
  const hops = proxyHops();

  if (hops === 0) {
    // No trusted proxy: forwarding headers are attacker-controlled, ignore them.
    return directPeer ? normalizeIp(directPeer) : null;
  }

  if (!forwardedFor) {
    // Configured to trust a proxy but none present — cannot establish a
    // trustworthy IP; fall back to the direct peer only.
    return directPeer ? normalizeIp(directPeer) : null;
  }

  const parts = forwardedFor
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return directPeer ? normalizeIp(directPeer) : null;
  }

  // The rightmost entry is added by the nearest proxy. Walk `hops` entries in
  // from the right to reach the address the outermost trusted proxy saw. If the
  // chain is shorter than the trusted hop count, the header was not produced by
  // the full trusted path — fail closed to null rather than trust a forgery.
  const index = parts.length - hops;
  if (index < 0) return null;
  const candidate = parts[index];
  return candidate ? normalizeIp(candidate) : null;
}

/** Convenience wrapper for the Web `Headers` request path. */
export function clientIpFromHeaders(
  headers: Headers,
  directPeer?: string | null,
): string | null {
  return resolveClientIp(headers.get("x-forwarded-for"), directPeer);
}
