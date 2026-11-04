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
 *
 * It must honor `options.all`. Node 20+ defaults `autoSelectFamily` on, so
 * `net.connect` asks for every address and expects an array back; a single
 * address string makes it fail with ERR_INVALID_IP_ADDRESS, which took down every
 * HTTP_REQUEST event and webhook delivery aimed at a hostname.
 *
 * Every resolved address is checked, including ones the family filter would drop,
 * so a host cannot pass by publishing one public record next to an internal one.
 */
export const guardedLookup: net.LookupFunction = (
  hostname,
  options,
  callback,
) => {
  const fail = (error: NodeJS.ErrnoException) => callback(error, "", 0);
  const family =
    options?.family === "IPv4"
      ? 4
      : options?.family === "IPv6"
        ? 6
        : (options?.family ?? 0);

  dnsLookup(hostname, { all: true })
    .then((addresses) => {
      for (const { address } of addresses) {
        if (isDisallowedIp(address)) {
          fail(
            new SsrfBlockedError(
              `Host "${hostname}" resolves to a disallowed address (${address})`,
            ),
          );
          return;
        }
      }

      const candidates = family
        ? addresses.filter((a) => a.family === family)
        : addresses;
      const chosen = candidates[0];
      if (!chosen) {
        fail(new SsrfBlockedError(`Could not resolve host "${hostname}"`));
        return;
      }

      if (options?.all) {
        callback(null, candidates);
      } else {
        callback(null, chosen.address, chosen.family);
      }
    })
    .catch(() => {
      fail(new SsrfBlockedError(`Could not resolve host "${hostname}"`));
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
