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
