import type { webhookEvents } from "@/shared/schema";
import type { WebhookPayload } from "./WebhookManager";

/**
 * The longest body a delivery can have, in bytes. docs/WEBHOOKS.md gives this to whoever
 * writes a receiver, and it bounds what one event can make Cronium hold and send.
 *
 * It's this long so that anything the inbound endpoint accepts can go out. That endpoint
 * takes up to 1 MB, and processing can make that 6 times as long, plus about 2 KB at most
 * around the event's data: in plain text, `"` becomes `&quot;` and a control character
 * becomes `\u0001`. Only a webhook's `transformations` can make one longer, by copying
 * fields, and `eventTooLong` stops that at the endpoint.
 */
export const MAX_WEBHOOK_REQUEST_BYTES = 8 * 1024 * 1024;

/** `webhook_events.id` is a serial, so an event's id can't be longer than this. */
const LONGEST_EVENT_ID = 2_147_483_647;

/** The delivery body for a stored event. A retry has to produce what the first
 * attempt sent, so both build it here. */
export function deliveryPayload(
  event: Pick<typeof webhookEvents.$inferSelect, "id" | "event" | "createdAt">,
  data: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): WebhookPayload {
  return {
    id: event.id.toString(),
    event: event.event,
    timestamp: event.createdAt,
    data,
    ...(metadata !== undefined && { metadata }),
  };
}

/** What to say about a delivery body past the limit. Undefined if it's within it. */
export function bodyTooLong(rawBody: string): string | undefined {
  const bytes = Buffer.byteLength(rawBody);
  if (bytes <= MAX_WEBHOOK_REQUEST_BYTES) return undefined;
  const count = (n: number) => n.toLocaleString("en-US");
  return `This event is too long to deliver: its body would be ${count(bytes)} bytes, and the limit is 8 MB (${count(MAX_WEBHOOK_REQUEST_BYTES)} bytes).`;
}

/**
 * The same, for an event that hasn't been sent, so that someone can be told in place of
 * an attempt that was never going to work. An event refused this way shouldn't get a row,
 * so this can't know its id. It counts the longest one, and so can refuse a body up to 9
 * bytes short of the limit.
 */
export function eventTooLong(
  event: string,
  data: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): string | undefined {
  return bodyTooLong(
    JSON.stringify(
      deliveryPayload(
        { id: LONGEST_EVENT_ID, event, createdAt: new Date() },
        data,
        metadata,
      ),
    ),
  );
}
