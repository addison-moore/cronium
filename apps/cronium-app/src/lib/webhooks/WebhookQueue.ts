import type { SerializedPayload } from "./delivery-body";

/**
 * How many deliveries can run at once in this process, by what they share.
 *
 * A delivery to a receiver that never answers holds its slot for its whole timeout,
 * so without these one webhook's backlog could hold every slot. Holding a request
 * open costs little, so the answer is room for everyone else, not less for anyone:
 * a webhook still gets the five slots the whole process used to have.
 */
export const MAX_RUNNING_PER_WEBHOOK = 5;
/** Otherwise a tenant gets past the webhook limit by making more webhooks. */
export const MAX_RUNNING_PER_OWNER = 10;
/** Room for four tenants at their limit before anyone else has to wait. */
export const MAX_RUNNING_DELIVERIES = 40;

const MiB = 1024 * 1024;

/**
 * How many bytes this process can hold for deliveries, by what they share, from when
 * an event is accepted until its last attempt ends. Running or waiting, it's the same
 * body in memory, so both count.
 *
 * Bytes, because memory is what runs out. An event's body is held as the bytes it sends,
 * so its length is what it costs, and each delivery pays for what it holds itself. Many
 * tiny events can't get past that, and a limit on items would only stand in for it.
 *
 * A webhook can hold about 2,700 events of 10 KB, or five of the 6 MB that the inbound
 * endpoint can make from one request. It has to be able to hold at least one of those.
 */
export const MAX_HELD_BYTES_PER_WEBHOOK = 32 * MiB;
/** Otherwise a tenant gets past the webhook limit by making more webhooks. */
export const MAX_HELD_BYTES_PER_OWNER = 64 * MiB;
/**
 * Room for four tenants at their limit, as with running deliveries, out of the 4 GB that
 * docs/DEPLOYMENT.md asks for and the whole stack shares. A running delivery over TLS
 * also holds ciphertext it hasn't sent, measured at about one body. That's outside this
 * count, and at most 40 bodies.
 */
export const MAX_HELD_BYTES = 256 * MiB;

/**
 * What a waiting delivery holds besides its body, URL, secret and custom headers,
 * measured at 1.4 to 2 KB. This is what limits tiny events, to about 15,000 for a webhook
 * and 125,000 in all, and a look through 100,000 items takes about 0.6 ms. A running
 * delivery takes 50 to 140 KB more, which is too little to count at no more than 40.
 */
const DELIVERY_OVERHEAD_BYTES = 2 * 1024;

/** Which limit an event ran into. `webhook` means all the webhooks it goes to are at theirs. */
export type QueueFullReason = "webhook" | "owner" | "total";

/** One of the webhooks an event is going to, and what a delivery there needs. */
export interface DeliveryTarget {
  webhookId: number;
  url: string;
  secret: string;
  headers: Record<string, string>;
  retryConfig?: {
    maxRetries?: number;
    retryDelay?: number;
    backoffMultiplier?: number;
  };
}

/** What an event holds in the queue. Its deliveries share its body. */
interface HeldEvent {
  bodyBytes: number;
  /** Deliveries not yet over. The body's bytes come back with the last of them. */
  deliveries: number;
}

export interface QueueItem extends DeliveryTarget {
  id: string;
  /** The tenant whose webhook this is. */
  ownerUserId: string;
  webhookEventId: number;
  payload: SerializedPayload;
  attempts: number;
  nextRetryAt?: Date;
  heldEvent: HeldEvent;
  /** What this delivery holds beyond the body it shares. */
  ownBytes: number;
}

/** The queue's answer to an event. When it's refused, nothing is held. */
export type QueueReservation =
  | { refused: QueueFullReason }
  | {
      refused?: undefined;
      /** The targets with no room, which this event isn't going to. */
      full: DeliveryTarget[];
      /** Start the deliveries to the targets with room. */
      enqueue: (webhookEventId: number, payload: SerializedPayload) => void;
      /** Give the room back, for an event that isn't going out after all. */
      cancel: () => void;
    };

/** How often the server log says the queue is refusing events. */
const FULL_WARNING_INTERVAL_MS = 60_000;

/**
 * In-process delivery queue with retry and backoff.
 *
 * Items live in memory only, so anything pending is lost on restart; every attempt
 * is recorded in webhook_deliveries, which is what `retryDelivery` works from. An
 * item that exhausts its retries is dropped rather than parked: it holds the
 * webhook's decrypted secret and headers, which should not outlive the delivery.
 *
 * A new event that doesn't fit is refused, and nothing already held makes way for it.
 * Whoever sent a held event has been told it was accepted and can't be told otherwise,
 * while whoever sent the new one is still waiting for an answer and can send it again.
 * So a delivery keeps its room from its first attempt to its last, and a retry never
 * has to ask for it again.
 */
export class WebhookQueue {
  private queue = new Map<string, QueueItem>();
  private processing = new Set<string>();
  private runningByWebhook = new Map<number, number>();
  private runningByOwner = new Map<string, number>();
  private heldBytes = 0;
  private heldBytesByWebhook = new Map<number, number>();
  private heldBytesByOwner = new Map<string, number>();
  private lastFullWarningAt = -Infinity;

  constructor() {
    const timer = setInterval(() => {
      this.startBacklog();
    }, 1000);
    // Must not keep a process (a test run, a one-off script) alive on its own.
    timer.unref();
  }

  /**
   * Claim room for an event's deliveries, or say there's none.
   *
   * This comes before anything about the event is stored, and doesn't wait for anything,
   * so simultaneous requests can't all see the same room. The claim counts from here.
   *
   * A target with no room is left out as long as another has some. One receiver that's
   * behind shouldn't hold up the rest, however long it stays behind, and a `*` webhook
   * would otherwise hold up everything its tenant sends. When no target has room, or the
   * tenant or the process has none, the event is refused.
   */
  reserve(
    ownerUserId: string,
    bodyBytes: number,
    targets: DeliveryTarget[],
  ): QueueReservation {
    const fitting: Array<{ target: DeliveryTarget; ownBytes: number }> = [];
    const full: DeliveryTarget[] = [];
    for (const target of targets) {
      const ownBytes = deliveryOwnBytes(target);
      const held = this.heldBytesByWebhook.get(target.webhookId) ?? 0;
      if (held + bodyBytes + ownBytes <= MAX_HELD_BYTES_PER_WEBHOOK) {
        fitting.push({ target, ownBytes });
      } else {
        full.push(target);
      }
    }

    const eventBytes = fitting.reduce(
      (bytes, { ownBytes }) => bytes + ownBytes,
      bodyBytes,
    );
    const ownerHeld = this.heldBytesByOwner.get(ownerUserId) ?? 0;
    const refused: QueueFullReason | undefined =
      fitting.length === 0
        ? "webhook"
        : ownerHeld + eventBytes > MAX_HELD_BYTES_PER_OWNER
          ? "owner"
          : this.heldBytes + eventBytes > MAX_HELD_BYTES
            ? "total"
            : undefined;
    if (refused) {
      this.warnFull(refused);
      return { refused };
    }

    const heldEvent: HeldEvent = { bodyBytes, deliveries: fitting.length };
    this.heldBytes += eventBytes;
    adjustCount(this.heldBytesByOwner, ownerUserId, eventBytes);
    for (const { target, ownBytes } of fitting) {
      adjustCount(
        this.heldBytesByWebhook,
        target.webhookId,
        bodyBytes + ownBytes,
      );
    }

    return {
      full,
      enqueue: (webhookEventId, payload) => {
        for (const { target, ownBytes } of fitting) {
          const id = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
          this.queue.set(id, {
            ...target,
            id,
            ownerUserId,
            webhookEventId,
            payload,
            attempts: 0,
            heldEvent,
            ownBytes,
          });
          this.startNext();
        }
      },
      cancel: () => {
        for (const { target, ownBytes } of fitting) {
          this.release(target.webhookId, ownerUserId, ownBytes, heldEvent);
        }
      },
    };
  }

  /** Give back what one delivery holds, and the event's body with its last delivery. */
  private release(
    webhookId: number,
    ownerUserId: string,
    ownBytes: number,
    heldEvent: HeldEvent,
  ): void {
    heldEvent.deliveries--;
    const shared = heldEvent.deliveries === 0 ? heldEvent.bodyBytes : 0;
    this.heldBytes -= ownBytes + shared;
    adjustCount(this.heldBytesByOwner, ownerUserId, -(ownBytes + shared));
    adjustCount(
      this.heldBytesByWebhook,
      webhookId,
      -(ownBytes + heldEvent.bodyBytes),
    );
  }

  /** For whoever runs the server, who sees none of the answers. Not one per request. */
  private warnFull(reason: QueueFullReason): void {
    const now = Date.now();
    if (now - this.lastFullWarningAt < FULL_WARNING_INTERVAL_MS) return;
    this.lastFullWarningAt = now;
    console.warn(
      `[Webhook] Refusing events: the delivery queue is at its "${reason}" limit, holding ${this.heldBytes} bytes in all. This is logged at most once a minute.`,
    );
  }

  /**
   * Start what a tick can: one item per webhook, up to the limits.
   *
   * Only one per webhook, because a receiver that limits its rate refuses a backlog
   * sent as fast as it answers, and three refusals lose the event. A tick used to
   * start one item for the whole queue, so this is the pace any receiver already had.
   */
  private startBacklog(): void {
    const startedThisTick = new Set<number>();
    while (this.startNext(startedThisTick)) {
      // Each pass takes an item off the queue or ends the loop.
    }
  }

  /** Start one item if there's room and anything can use it. */
  private startNext(startedThisTick?: Set<number>): boolean {
    if (this.processing.size >= MAX_RUNNING_DELIVERIES) return false;

    const item = this.nextRunnable(startedThisTick);
    if (!item) return false;

    startedThisTick?.add(item.webhookId);
    this.queue.delete(item.id);
    void this.deliver(item);
    return true;
  }

  /**
   * The next item to start, or nothing if none can. An item that can't run stays
   * where it is, and the next tick or new event looks again.
   *
   * The queue is oldest first. Of the items that can run, the tenant with the fewest
   * running goes first, then its webhook with the fewest running, so a slot coming
   * free goes to whoever has nothing running, ahead of any backlog. A retry waiting
   * out its backoff isn't running, so it doesn't count against its webhook.
   */
  private nextRunnable(startedThisTick?: Set<number>): QueueItem | undefined {
    const now = new Date();
    let next: QueueItem | undefined;
    let nextOwnerRunning = Infinity;
    let nextWebhookRunning = Infinity;

    for (const item of this.queue.values()) {
      if (item.nextRetryAt && item.nextRetryAt > now) continue;
      if (startedThisTick?.has(item.webhookId)) continue;
      const webhookRunning = this.runningByWebhook.get(item.webhookId) ?? 0;
      if (webhookRunning >= MAX_RUNNING_PER_WEBHOOK) continue;
      const ownerRunning = this.runningByOwner.get(item.ownerUserId) ?? 0;
      if (ownerRunning >= MAX_RUNNING_PER_OWNER) continue;

      if (
        ownerRunning < nextOwnerRunning ||
        (ownerRunning === nextOwnerRunning &&
          webhookRunning < nextWebhookRunning)
      ) {
        next = item;
        nextOwnerRunning = ownerRunning;
        nextWebhookRunning = webhookRunning;
        // Nothing can be ahead of this.
        if (ownerRunning === 0) break;
      }
    }

    return next;
  }

  private async deliver(item: QueueItem): Promise<void> {
    this.processing.add(item.id);
    adjustCount(this.runningByWebhook, item.webhookId, 1);
    adjustCount(this.runningByOwner, item.ownerUserId, 1);

    let retrying = false;
    try {
      await this.processItem(item);
    } catch {
      // processDelivery has already recorded the failed attempt, if it could.
      retrying = this.scheduleRetry(item);
    } finally {
      this.processing.delete(item.id);
      adjustCount(this.runningByWebhook, item.webhookId, -1);
      adjustCount(this.runningByOwner, item.ownerUserId, -1);
      if (!retrying) {
        this.release(
          item.webhookId,
          item.ownerUserId,
          item.ownBytes,
          item.heldEvent,
        );
      }
    }
  }

  /**
   * Process a queue item
   */
  private async processItem(item: QueueItem): Promise<void> {
    // Import WebhookManager dynamically to avoid circular dependency
    const { WebhookManager } = await import("./WebhookManager");
    const result = await WebhookManager.getInstance().processDelivery(
      item.webhookId,
      item.webhookEventId,
      item.url,
      item.secret,
      item.headers,
      item.payload,
    );

    // `retryable: false` is for what Cronium itself knows can't change. Every other
    // failure gets its retries, because only the receiver or the network knows whether
    // it will last.
    if (!result.success && result.retryable !== false) {
      throw new Error(result.error ?? `HTTP ${result.statusCode ?? "unknown"}`);
    }
  }

  /**
   * Re-queue with exponential backoff until the item's attempts run out. Says whether
   * it did, because the item keeps its room if so.
   */
  private scheduleRetry(item: QueueItem): boolean {
    item.attempts++;
    if (item.attempts >= (item.retryConfig?.maxRetries ?? 3)) return false;

    const baseDelay = item.retryConfig?.retryDelay ?? 1000;
    const multiplier = item.retryConfig?.backoffMultiplier ?? 2;
    item.nextRetryAt = new Date(
      Date.now() + baseDelay * Math.pow(multiplier, item.attempts - 1),
    );
    this.queue.set(item.id, item);
    return true;
  }
}

/** What a delivery to this target holds besides the body it shares with the others. */
export function deliveryOwnBytes({
  url,
  secret,
  headers,
}: DeliveryTarget): number {
  // Each delivery has its own copy of these, and nothing limits how long they are.
  return (
    DELIVERY_OVERHEAD_BYTES +
    Buffer.byteLength(url) +
    Buffer.byteLength(secret) +
    Buffer.byteLength(JSON.stringify(headers))
  );
}

/** A key leaves the map at zero, so webhooks long gone don't stay in it. */
function adjustCount<Key>(
  counts: Map<Key, number>,
  key: Key,
  change: number,
): void {
  const count = (counts.get(key) ?? 0) + change;
  if (count === 0) counts.delete(key);
  else counts.set(key, count);
}
