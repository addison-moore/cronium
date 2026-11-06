import { type WebhookPayload } from "./WebhookManager";

export interface QueueItem {
  id: string;
  webhookId: number;
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
  isRetry?: boolean;
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

  constructor(private concurrency = 5) {
    const timer = setInterval(() => {
      void this.processNext();
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

    // Process immediately if not at capacity
    if (this.processing.size < this.concurrency) {
      void this.processNext();
    }

    return id;
  }

  /**
   * Process next item in queue
   */
  private async processNext(): Promise<void> {
    if (this.processing.size >= this.concurrency) return;

    const now = new Date();
    let nextItem: QueueItem | undefined;
    for (const item of this.queue.values()) {
      if (!item.nextRetryAt || item.nextRetryAt <= now) {
        nextItem = item;
        break;
      }
    }
    if (!nextItem) return;

    this.queue.delete(nextItem.id);
    this.processing.add(nextItem.id);

    try {
      await this.processItem(nextItem);
    } catch {
      // processDelivery has already recorded the failed attempt, if it could.
      this.scheduleRetry(nextItem);
    } finally {
      this.processing.delete(nextItem.id);
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

    if (!result.success) {
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
