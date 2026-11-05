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

/**
 * Expand an IPv6 literal to its eight 16-bit groups, or null if malformed.
 * Handles `::` compression, a dotted IPv4 tail, and a zone id.
 */
function ipv6ToGroups(ip: string): number[] | null {
  let addr = ip.split("%", 1)[0]!.toLowerCase();

  const dottedTail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (dottedTail) {
    const v4 = ipv4ToInt(dottedTail[2]!);
    if (v4 === null) return null;
    addr = `${dottedTail[1]!}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const sides = addr.split("::");
  if (sides.length > 2) return null;
  const parse = (part: string | undefined) =>
    part ? part.split(":").map((group) => parseInt(group, 16)) : [];
  const head = parse(sides[0]);
  const tail = parse(sides[1]);

  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (sides.length === 1 && missing !== 0)) return null;

  const groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

function ipv4FromGroups(high: number, low: number): string {
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

/**
 * True for any address that must not be reachable from a user-configured URL.
 *
 * IPv6 is compared numerically on purpose. WHATWG URL serializes an IPv4-mapped
 * literal in hex, so `http://[::ffff:169.254.169.254]/` reaches this function as
 * `::ffff:a9fe:a9fe`; a string match on a dotted tail never saw it, and since
 * Node skips DNS for IP literals the connect-time guard never did either. Every
 * form that embeds an IPv4 address is therefore unpacked and judged by the IPv4
 * rules, so an internal target cannot be hidden in an IPv6 spelling.
 */
export function isDisallowedIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    if (n === null) return true; // unparseable -> treat as disallowed
    return IPV4_BLOCKED.some(([base, bits]) => ipv4InRange(n, base, bits));
  }
  if (kind === 6) {
    const g = ipv6ToGroups(ip);
    if (!g) return true; // unparseable -> treat as disallowed
    const [a, b, c, d, e, f, h, l] = g as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const leadingZeros = a === 0 && b === 0 && c === 0 && d === 0;

    // ::/128 unspecified, ::1/128 loopback
    if (leadingZeros && e === 0 && f === 0 && h === 0 && l <= 1) return true;
    // ::a.b.c.d (IPv4-compatible), ::ffff:a.b.c.d (mapped),
    // ::ffff:0:a.b.c.d (translated), 64:ff9b::a.b.c.d (NAT64)
    if (
      (leadingZeros && e === 0 && (f === 0 || f === 0xffff)) ||
      (leadingZeros && e === 0xffff && f === 0) ||
      (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0)
    ) {
      return isDisallowedIp(ipv4FromGroups(h, l));
    }
    // 2002:a.b.c.d::/48 (6to4)
    if (a === 0x2002) return isDisallowedIp(ipv4FromGroups(b, c));

    return (
      (a === 0x64 && b === 0xff9b && c === 1) || // 64:ff9b:1::/48 local NAT64
      (a === 0x100 && b === 0 && c === 0 && d === 0) || // 100::/64 discard
      (a === 0x2001 && b === 0) || // 2001::/32 Teredo (obfuscated IPv4)
      (a & 0xfe00) === 0xfc00 || // fc00::/7 ULA
      (a & 0xffc0) === 0xfe80 || // fe80::/10 link-local
      (a & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated)
      (a & 0xff00) === 0xff00 // ff00::/8 multicast
    );
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
