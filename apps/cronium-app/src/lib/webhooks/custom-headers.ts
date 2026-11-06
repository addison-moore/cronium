import { z } from "zod";

/**
 * The delivery headers a webhook's custom headers can't replace: the signatures and
 * the request headers they cover. Replacing one breaks a signature, so a receiver
 * checking it refuses every delivery, and nothing on Cronium's side says why.
 *
 * The other system headers (`Content-Type`, `X-Webhook-Id`, `X-Webhook-Event`,
 * `X-Webhook-Timestamp`) stay replaceable on purpose. No signature covers them, so
 * changing one can't stop a delivery verifying, and an integration relying on that
 * would break for nothing. docs/WEBHOOKS.md tells receivers about both groups.
 */
export const PROTECTED_DELIVERY_HEADERS = [
  "X-Webhook-Signature",
  "X-Webhook-Signature-V2",
  "X-Delivery-Id",
  "X-Delivery-Timestamp",
] as const;

/**
 * The headers saying how a request's body is framed. Only the HTTP client can set
 * these, because a body's length changes with its event, so a custom one is at best
 * what the client would have sent. At worst, measured on real receivers: a short
 * `Content-Length` truncates the body, and Go, Python and nginx answer 200, so it's
 * recorded as a success. A long one waits out the timeout, holding one of the queue's
 * five slots away from every other webhook. `Transfer-Encoding` next to the client's
 * `Content-Length` gets refused or read as a garbled body, and `Trailer` makes Node
 * throw before sending.
 */
export const BODY_FRAMING_HEADERS = [
  "Content-Length",
  "Transfer-Encoding",
  "Trailer",
] as const;

/**
 * Says the body is compressed, and it never is. Express's body parsers believe it and
 * answer 400 before the handler runs, and other receivers ignore it, so a delivery
 * can pass with one receiver and fail with the next.
 */
const CONTENT_ENCODING = "Content-Encoding";

/**
 * Names with the same key are one header to the HTTP client. axios trims them as well
 * as ignoring case, so `"X-Webhook-Signature "` replaces the real header too.
 */
export function headerKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Each header a custom one can't set, and what a client trying to is told. */
const reservedHeaders = new Map(
  [
    ...PROTECTED_DELIVERY_HEADERS.map((name) => ({
      name,
      refusal: `A custom header can't be named ${name}: Cronium sets it on every delivery, and receivers need it to verify them`,
    })),
    ...BODY_FRAMING_HEADERS.map((name) => ({
      name,
      refusal: `A custom header can't be named ${name}: it says how a delivery's body is sent, which the HTTP client works out for each body`,
    })),
    {
      name: CONTENT_ENCODING,
      refusal: `A custom header can't be named ${CONTENT_ENCODING} unless its value is identity: a delivery's body is never compressed, so a receiver that believes the header can't read it`,
    },
  ].map((header) => [headerKey(header.name), header] as const),
);

/**
 * The reserved header this custom one would set, if any. `Content-Encoding` with
 * `identity` or nothing claims nothing, so it does no harm and isn't one.
 */
function reservedHeader(name: string, value: string) {
  const key = headerKey(name);
  const unencoded = ["", "identity"].includes(value.trim().toLowerCase());
  if (key === headerKey(CONTENT_ENCODING) && unencoded) return undefined;
  return reservedHeaders.get(key);
}

/**
 * Anything outside RFC 9110's token. Node's HTTP client throws on a name holding one,
 * before it sends anything.
 */
const NOT_IN_HTTP_TOKEN = /[^!#$%&'*+\-.^_`|~0-9A-Za-z]/;

function isHttpToken(name: string): boolean {
  return name !== "" && !NOT_IN_HTTP_TOKEN.test(name);
}

/**
 * As much of a bad name as is safe to repeat. Pasting a whole header line in as the
 * name is the likely mistake, and then what follows the first bad character is a
 * credential. webhook_deliveries isn't encrypted and the history API returns it.
 */
function startOfName(name: string): string {
  return name.trim().split(NOT_IN_HTTP_TOKEN, 1)[0] ?? "";
}

/**
 * What axios lets through to the wire. It removes anything else from a value without
 * saying so, and the delivery is recorded as a success, so `tok€n` arrives as `tokn`.
 */
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;

/**
 * Why a client can't set this header, if it can't. Whitespace around a name or a value
 * is allowed because the receiver gets what was meant: axios trims it, so a value
 * pasted with its line ending arrives without one.
 */
function customHeaderRefusal(name: string, value: string): string | undefined {
  if (!isHttpToken(name.trim())) {
    const start = startOfName(name);
    return `A custom header's name has to be one or more letters, digits or any of !#$%&'*+-.^_\`|~, so ${start ? `the one starting "${start}"` : "one of these"} can't be sent`;
  }
  const reserved = reservedHeader(name, value);
  if (reserved) return reserved.refusal;
  if (!HEADER_VALUE.test(value.trim())) {
    return `The value of custom header ${name.trim()} can't hold line breaks, control characters or anything above U+00FF: they'd be removed before sending, so the receiver would get a different value`;
  }
  return undefined;
}

/**
 * A webhook's custom headers, as `webhookSystem.create` and `webhookSystem.update`
 * accept them. A name is refused here rather than ignored at send, so whoever sets
 * it finds out. The issue gives the header's name only: its value may be a credential.
 * A name that isn't valid can hold one too, so its issue has no path.
 */
export const webhookCustomHeadersSchema = z
  .record(z.string(), z.string())
  .superRefine((headers, ctx) => {
    for (const [name, value] of Object.entries(headers)) {
      const message = customHeaderRefusal(name, value);
      if (message) {
        ctx.addIssue({
          code: "custom",
          path: isHttpToken(name.trim()) ? [name] : [],
          message,
        });
      }
    }
  });

/**
 * What a delivery does with a webhook's stored custom headers. A webhook stored before
 * the schema refused these can still hold them, and only the delivery can deal with
 * that: the column is encrypted and reads don't return it, so nobody can look through
 * stored headers for one.
 *
 * - `ignored` are reserved headers, left out and given in their usual spelling. Each
 *   can only be wrong or say what the delivery says anyway, so nothing the owner meant
 *   is lost.
 * - `invalidNames` can't be sent, so the delivery has to fail. Leaving one out might
 *   send an event without a credential or routing header its owner set, to be handled
 *   the wrong way and recorded as a success. A delivery holding one has never gone out,
 *   so failing costs nothing that works today. It's matched as axios matches: a Kelvin
 *   sign spelling of a system header replaces that header, so it can be sent.
 * - A blank name is in neither, because axios never sends it.
 *
 * A value is left as it is, because what axios makes of it may be what the receiver
 * has been accepting.
 */
export function splitCustomHeaders(headers: Record<string, string>): {
  sendable: Record<string, string>;
  ignored: string[];
  invalidNames: string[];
} {
  const entries = Object.entries(headers).filter(
    ([name]) => name.trim() !== "",
  );
  const kept = entries.filter(([name, value]) => !reservedHeader(name, value));
  return {
    sendable: Object.fromEntries(kept),
    ignored: [
      ...new Set(
        entries.flatMap(
          ([name, value]) => reservedHeader(name, value)?.name ?? [],
        ),
      ),
    ],
    invalidNames: kept
      .filter(([name]) => !isHttpToken(headerKey(name)))
      .map(([name]) => startOfName(name)),
  };
}
