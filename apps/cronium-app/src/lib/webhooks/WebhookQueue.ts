import { type WebhookPayload } from "./WebhookManager";

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

export interface QueueItem {
  id: string;
  webhookId: number;
  /** The tenant whose webhook this is. */
  ownerUserId: string;
  webhookEventId: number;
  url: string;
  secret: string;
  headers: Record<string, string>;
  payload: WebhookPayload;
  retryConfig?: {
    maxRetries?: number;
    retryDelay?: number;
    backoffMultiplier?: number;
  };
  attempts: number;
  nextRetryAt?: Date;
}

/**
 * In-process delivery queue with retry and backoff.
 *
 * Items live in memory only, so anything pending is lost on restart; every attempt
 * is recorded in webhook_deliveries, which is what `retryDelivery` works from. An
 * item that exhausts its retries is dropped rather than parked: it holds the
 * webhook's decrypted secret and headers, which should not outlive the delivery.
 */
export class WebhookQueue {
  private queue = new Map<string, QueueItem>();
  private processing = new Set<string>();
  private runningByWebhook = new Map<number, number>();
  private runningByOwner = new Map<string, number>();

  constructor() {
    const timer = setInterval(() => {
      this.startBacklog();
    }, 1000);
    // Must not keep a process (a test run, a one-off script) alive on its own.
    timer.unref();
  }

  /**
   * Add item to queue
   */
  async enqueue(item: Omit<QueueItem, "id" | "attempts">): Promise<string> {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    this.queue.set(id, { ...item, id, attempts: 0 });

    this.startNext();

    return id;
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

    try {
      await this.processItem(item);
    } catch {
      // processDelivery has already recorded the failed attempt, if it could.
      this.scheduleRetry(item);
    } finally {
      this.processing.delete(item.id);
      adjustCount(this.runningByWebhook, item.webhookId, -1);
      adjustCount(this.runningByOwner, item.ownerUserId, -1);
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

  /** Re-queue with exponential backoff until the item's attempts run out. */
  private scheduleRetry(item: QueueItem): void {
    item.attempts++;
    if (item.attempts >= (item.retryConfig?.maxRetries ?? 3)) return;

    const baseDelay = item.retryConfig?.retryDelay ?? 1000;
    const multiplier = item.retryConfig?.backoffMultiplier ?? 2;
    item.nextRetryAt = new Date(
      Date.now() + baseDelay * Math.pow(multiplier, item.attempts - 1),
    );
    this.queue.set(item.id, item);
  }
}

/** A key leaves the map at zero, so webhooks long gone don't stay in it. */
function adjustCount<Key>(
  counts: Map<Key, number>,
  key: Key,
  change: 1 | -1,
): void {
  const count = (counts.get(key) ?? 0) + change;
  if (count === 0) counts.delete(key);
  else counts.set(key, count);
}
