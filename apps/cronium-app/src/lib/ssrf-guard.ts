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
import axios from "axios";
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

// An axios caller must also pass `proxy: false`. Otherwise a proxy in the environment
// takes the connection and resolves the target itself, so guardedLookup never runs.
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

/**
 * assertRequestUrlIsPublic plus a DNS check, for callers that want to refuse a host
 * with a clear error before handing the URL to a library that would report the
 * connect-time refusal as a generic connection failure. A host that does not resolve
 * passes: the request itself will fail, with a more useful message.
 */
export async function assertUrlResolvesPublic(rawUrl: string): Promise<void> {
  const { hostname } = assertRequestUrlIsPublic(rawUrl);
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return;

  const addresses = await dnsLookup(host, { all: true }).catch(() => []);
  const internal = addresses.find(({ address }) => isDisallowedIp(address));
  if (internal) {
    throw new SsrfBlockedError(
      `Host "${hostname}" resolves to a disallowed address (${internal.address})`,
    );
  }
}

// Bound what is buffered for a response from a host the user chose.
const MAX_GUARDED_FETCH_RESPONSE_BYTES = 20 * 1024 * 1024;

/**
 * A `fetch` for SDKs that accept one. It goes through the guarded agents, so the
 * address is validated at connect time, and does not follow redirects or use a proxy
 * from the environment. Responses are buffered, so it does not suit a streaming API.
 */
export const ssrfGuardedFetch: typeof fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : input.toString();
  assertRequestUrlIsPublic(url);

  const response = await axios.request<ArrayBuffer>({
    url,
    method: init?.method ?? "GET",
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    data: init?.body,
    ...(init?.signal ? { signal: init.signal } : {}),
    httpAgent: ssrfHttpAgent,
    httpsAgent: ssrfHttpsAgent,
    proxy: false,
    maxRedirects: 0,
    maxContentLength: MAX_GUARDED_FETCH_RESPONSE_BYTES,
    responseType: "arraybuffer",
    validateStatus: () => true,
  });

  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (value !== undefined && value !== null) headers.set(key, String(value));
  }
  const hasBody = ![204, 205, 304].includes(response.status);
  return new Response(hasBody ? response.data : null, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
