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
 * Names with the same key are one header to the HTTP client. axios trims them as well
 * as ignoring case, so `"X-Webhook-Signature "` replaces the real header too.
 */
export function headerKey(name: string): string {
  return name.trim().toLowerCase();
}

const protectedHeaderByKey = new Map<string, string>(
  PROTECTED_DELIVERY_HEADERS.map((name) => [headerKey(name), name]),
);

/** The protected header this name would replace, if any, in its usual spelling. */
function protectedHeaderNamed(name: string): string | undefined {
  return protectedHeaderByKey.get(headerKey(name));
}

/**
 * A webhook's custom headers, as `webhookSystem.create` and `webhookSystem.update`
 * accept them. A name is refused here rather than ignored at send, so whoever sets
 * it finds out. The issue gives the header's name only: its value may be a credential.
 */
export const webhookCustomHeadersSchema = z
  .record(z.string(), z.string())
  .superRefine((headers, ctx) => {
    for (const name of Object.keys(headers)) {
      const replaced = protectedHeaderNamed(name);
      if (replaced) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: `A custom header can't be named ${replaced}: Cronium sets it on every delivery, and receivers need it to verify them`,
        });
      }
    }
  });

/**
 * What a delivery sends of a webhook's stored custom headers, and the protected
 * headers it leaves out. A webhook stored before the schema refused these names can
 * still hold one, and only the delivery can deal with that: the column is encrypted
 * and reads don't return it, so nobody can look through stored headers for one.
 */
export function splitCustomHeaders(headers: Record<string, string>): {
  sendable: Record<string, string>;
  ignored: string[];
} {
  const entries = Object.entries(headers);
  return {
    sendable: Object.fromEntries(
      entries.filter(([name]) => !protectedHeaderNamed(name)),
    ),
    ignored: [
      ...new Set(entries.flatMap(([name]) => protectedHeaderNamed(name) ?? [])),
    ],
  };
}
