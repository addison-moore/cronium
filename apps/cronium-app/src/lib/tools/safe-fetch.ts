/**
 * SSRF-guarded outbound fetch for tool actions.
 *
 * Tool actions make outbound HTTP calls, and several (Slack/Discord/Teams
 * webhooks) target a URL the user supplied. Without guarding, a user could
 * point a webhook at `http://169.254.169.254/` (cloud metadata),
 * `http://localhost/`, or any private address and turn the server into an SSRF
 * proxy. Every tool `fetch` must go through `safeFetch`.
 *
 * Defenses, in order:
 *  1. https only.
 *  2. Exact host allowlist per tool (the primary defense — a user cannot point
 *     a Slack webhook anywhere except hooks.slack.com).
 *  3. DNS resolution check: reject if the host resolves to a loopback,
 *     link-local, private, or otherwise non-public address (defense in depth
 *     against a host that resolves internally / DNS rebinding).
 *  4. No redirects (a 3xx could bounce past the allowlist to an internal host).
 *  5. A wall-clock timeout via AbortController so a hung endpoint can't block
 *     the job forever.
 */
// Bare specifiers (not "node:"-prefixed): the "use client" tool plugins import
// the action modules for metadata, which transitively reach this module. The
// bare names resolve to the client webpack `resolve.fallback` empty stubs
// (net/dns/dns/promises) so the client build doesn't choke on the "node:"
// scheme. execute() (the only caller) runs server-side, where these are real.
import { lookup } from "dns/promises";
import net from "net";
import { TOOL_HOSTS, hostAllowed } from "@/tools/utils/tool-hosts";

export { TOOL_HOSTS };

const DEFAULT_TIMEOUT_MS = 15_000;

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/** IPv4 dotted string -> unsigned 32-bit int, or null if malformed. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

function ipv4InRange(ipInt: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const IPV4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network / unspecified
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. 169.254.169.254 cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved / broadcast
];

function isDisallowedIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    if (n === null) return true; // unparseable -> treat as disallowed
    return IPV4_BLOCKED.some(([base, bits]) => ipv4InRange(n, base, bits));
  }
  if (kind === 6) {
    const addr = ip.toLowerCase();
    // IPv4-mapped/embedded (::ffff:a.b.c.d or ::a.b.c.d) -> validate the v4 part
    const mapped = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
    if (mapped?.[1]) return isDisallowedIp(mapped[1]);
    if (addr === "::" || addr === "::1") return true; // unspecified / loopback
    if (
      addr.startsWith("fe8") ||
      addr.startsWith("fe9") ||
      addr.startsWith("fea") ||
      addr.startsWith("feb")
    ) {
      return true; // fe80::/10 link-local
    }
    if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // fc00::/7 ULA
    return false;
  }
  // not a valid IP literal
  return true;
}

async function assertHostSafe(
  hostname: string,
  allow: string[],
): Promise<void> {
  if (!hostAllowed(hostname, allow)) {
    throw new SsrfBlockedError(
      `Host "${hostname}" is not an allowed destination for this tool`,
    );
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new SsrfBlockedError(`Could not resolve host "${hostname}"`);
  }
  for (const { address } of addresses) {
    if (isDisallowedIp(address)) {
      throw new SsrfBlockedError(
        `Host "${hostname}" resolves to a disallowed address (${address})`,
      );
    }
  }
}

export type SafeFetchInit = RequestInit & {
  /** Allowed hostnames for this call (use a TOOL_HOSTS entry). */
  allowHosts: string[];
  /** Abort after this many ms (default 15s). */
  timeoutMs?: number;
};

/**
 * A fetch that enforces the SSRF defenses above. Throws SsrfBlockedError if the
 * URL is disallowed; otherwise returns the Response (same contract as fetch).
 * Pass `allowHosts` (and optionally `timeoutMs`) alongside the normal init.
 */
export async function safeFetch(
  url: string,
  init: SafeFetchInit,
): Promise<Response> {
  const { allowHosts, timeoutMs, ...requestInit } = init;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new SsrfBlockedError(
      `Only https URLs are allowed (got ${parsed.protocol})`,
    );
  }
  await assertHostSafe(parsed.hostname, allowHosts);

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    return await fetch(url, {
      ...requestInit,
      signal: controller.signal,
      // A redirect could bounce past the allowlist to an internal host.
      redirect: "error",
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Per-tool bound fetchers. Each pins the tool's host allowlist, so an action
 * just calls `toolFetch.slack(url, init)` in place of `fetch(url, init)`.
 */
export const toolFetch = {
  slack: (url: string, init: RequestInit = {}) =>
    safeFetch(url, { ...init, allowHosts: TOOL_HOSTS.slack }),
  discord: (url: string, init: RequestInit = {}) =>
    safeFetch(url, { ...init, allowHosts: TOOL_HOSTS.discord }),
  teams: (url: string, init: RequestInit = {}) =>
    safeFetch(url, { ...init, allowHosts: TOOL_HOSTS.teams }),
  notion: (url: string, init: RequestInit = {}) =>
    safeFetch(url, { ...init, allowHosts: TOOL_HOSTS.notion }),
  trello: (url: string, init: RequestInit = {}) =>
    safeFetch(url, { ...init, allowHosts: TOOL_HOSTS.trello }),
  googleSheets: (url: string, init: RequestInit = {}) =>
    safeFetch(url, { ...init, allowHosts: TOOL_HOSTS["google-sheets"] }),
};
