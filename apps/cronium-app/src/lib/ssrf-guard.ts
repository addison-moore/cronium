/**
 * SSRF guard for arbitrary-host outbound requests (HTTP_REQUEST events).
 *
 * Unlike tool webhooks (which are pinned to an exact host allowlist via
 * `safe-fetch.ts`), HTTP_REQUEST events are meant to reach any *public* host a
 * user configures. The risk is a user pointing an event at an internal address
 * — cloud metadata (169.254.169.254), localhost, or an RFC1918 host — and
 * getting the response back as event output. This module blocks that while
 * still allowing legitimate public destinations.
 *
 * Server-only: it imports node:http/https, so it must never be pulled into the
 * client bundle (the scheduler http-executor is its only caller).
 */
import http from "http";
import https from "https";
import { lookup as dnsLookup } from "dns/promises";
import net from "net";
import { isDisallowedIp, SsrfBlockedError } from "@/lib/tools/safe-fetch";

/**
 * A DNS lookup that rejects any host resolving to a private/internal address
 * and otherwise pins the connection to a validated address. Wiring this into
 * the http/https agents means the check runs at actual connect time — including
 * on every redirect hop — which closes the DNS-rebinding (TOCTOU) gap that a
 * pre-flight-only resolution check would leave open.
 */
const guardedLookup: net.LookupFunction = (
  hostname,
  options,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void,
) => {
  const family = typeof options === "number" ? options : (options?.family ?? 0);
  dnsLookup(hostname, { all: true })
    .then((addresses) => {
      const candidates = family
        ? addresses.filter((a) => a.family === family)
        : addresses;
      for (const { address } of candidates) {
        if (isDisallowedIp(address)) {
          callback(
            new SsrfBlockedError(
              `Host "${hostname}" resolves to a disallowed address (${address})`,
            ),
            "",
            0,
          );
          return;
        }
      }
      const chosen = candidates[0];
      if (!chosen) {
        callback(
          new SsrfBlockedError(`Could not resolve host "${hostname}"`),
          "",
          0,
        );
        return;
      }
      callback(null, chosen.address, chosen.family);
    })
    .catch(() => {
      callback(
        new SsrfBlockedError(`Could not resolve host "${hostname}"`),
        "",
        0,
      );
    });
};

export const ssrfHttpAgent = new http.Agent({ lookup: guardedLookup });

export const ssrfHttpsAgent = new https.Agent({ lookup: guardedLookup });

/**
 * Up-front validation: reject non-http(s) schemes and IP-literal hosts that
 * point at internal ranges (before any DNS happens). Hostname destinations are
 * validated at connect time by the guarded agents above. Returns the parsed URL
 * or throws SsrfBlockedError.
 */
export function assertRequestUrlIsPublic(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(
      `Only http and https URLs are allowed (got ${parsed.protocol})`,
    );
  }
  // URL.hostname keeps the brackets on IPv6 literals (e.g. "[::1]"); strip them
  // so net.isIP recognizes the literal. This matters because Node skips DNS for
  // IP-literal hosts, so the guarded agent never sees them — the up-front check
  // is the only thing standing between an IPv6 literal and an internal address.
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isDisallowedIp(host)) {
    throw new SsrfBlockedError(
      `Host "${parsed.hostname}" is a disallowed (internal) address`,
    );
  }
  return parsed;
}
