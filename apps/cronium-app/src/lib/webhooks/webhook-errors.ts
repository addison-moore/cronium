import type { QueueFullReason } from "./WebhookQueue";

/**
 * A webhook operation that won't go ahead, for a reason its owner can act on.
 * Nothing was sent or recorded. The message is written for the owner, and routers
 * map this to `PRECONDITION_FAILED`.
 */
export class WebhookPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookPreconditionError";
  }
}

/** Why the queue has no room for an event, for whoever sent it. */
export function queueFullMessage(reason: QueueFullReason): string {
  const whose = {
    webhook: "The webhooks this event goes to have",
    owner: "This account has",
    total: "This server has",
  }[reason];
  return `${whose} too many deliveries waiting, so this event wasn't accepted. Nothing was stored or sent. Send it again later.`;
}

/**
 * What a webhook's history says about an event that went to its other webhooks while it
 * had no room. It's a failed attempt that made no request, and a manual retry sends it.
 */
export const NOT_QUEUED_MESSAGE =
  "This event wasn't sent to this webhook, because too many of its deliveries were already waiting. Retry this delivery once they've gone out.";

/**
 * What a webhook's history says about a delivery dropped from the queue because the webhook
 * was disabled. It's a failed attempt that made no request, and earlier attempts have rows
 * of their own. A manual retry sends it, and refuses to until the webhook is enabled.
 */
export const DROPPED_WHILE_DISABLED_MESSAGE =
  "This delivery was dropped without a request, because its webhook was disabled while it was waiting. Enable the webhook and retry this delivery to send it.";

/**
 * The queue has no room for an event, and nothing about it was stored. For a caller
 * with nobody to answer: the inbound endpoint gets this as a value, to answer with a 503.
 */
export class WebhookQueueFullError extends Error {
  constructor(reason: QueueFullReason) {
    super(queueFullMessage(reason));
    this.name = "WebhookQueueFullError";
  }
}
