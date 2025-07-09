import { EventEmitter } from "events";
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

export interface QueueStats {
  pending: number;
  processing: number;
  failed: number;
  completed: number;
  deadLetter: number;
}

export class WebhookQueue extends EventEmitter {
  private queue = new Map<string, QueueItem>();
  private processing = new Set<string>();
  private deadLetterQueue = new Map<string, QueueItem>();
  private stats: QueueStats = {
    pending: 0,
    processing: 0,
    failed: 0,
    completed: 0,
    deadLetter: 0,
  };
  private isProcessing = false;
  private processInterval?: NodeJS.Timeout;

  constructor(private concurrency = 5) {
    super();
    this.startProcessing();
  }

  /**
   * Add item to queue
   */
  async enqueue(item: Omit<QueueItem, "id" | "attempts">): Promise<string> {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const queueItem: QueueItem = {
      ...item,
      id,
      attempts: 0,
    };

    this.queue.set(id, queueItem);
    this.stats.pending++;
    this.emit("item:enqueued", queueItem);

    // Process immediately if not at capacity
    if (this.processing.size < this.concurrency) {
      this.processNext();
    }

    return id;
  }

  /**
   * Start queue processing
   */
  private startProcessing(): void {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.processInterval = setInterval(() => {
      this.processNext();
    }, 1000); // Check every second
  }

  /**
   * Stop queue processing
   */
  stopProcessing(): void {
    this.isProcessing = false;
    if (this.processInterval) {
      clearInterval(this.processInterval);
      delete this.processInterval;
    }
  }

  /**
   * Process next item in queue
   */
  private async processNext(): Promise<void> {
    if (this.processing.size >= this.concurrency) return;

    // Find next item to process
    const now = new Date();
    let nextItem: QueueItem | undefined;

    for (const [id, item] of this.queue) {
      if (!item.nextRetryAt || item.nextRetryAt <= now) {
        nextItem = item;
        break;
      }
    }

    if (!nextItem) return;

    // Move to processing
    this.queue.delete(nextItem.id);
    this.processing.add(nextItem.id);
    this.stats.pending--;
    this.stats.processing++;

    try {
      await this.processItem(nextItem);
      this.stats.completed++;
      this.emit("item:completed", nextItem);
    } catch (error) {
      await this.handleFailure(nextItem, error);
    } finally {
      this.processing.delete(nextItem.id);
      this.stats.processing--;
    }
  }

  /**
   * Process a queue item
   */
  private async processItem(item: QueueItem): Promise<void> {
    const startTime = Date.now();

    try {
      // Import WebhookManager dynamically to avoid circular dependency
      const { WebhookManager } = await import("./WebhookManager");
      const manager = WebhookManager.getInstance();

      const result = await manager.processDelivery(
        item.webhookId,
        item.webhookEventId,
        item.url,
        item.secret,
        item.headers,
        item.payload,
      );

      if (!result.success) {
        throw new Error(result.error || `HTTP ${result.statusCode}`);
      }

      this.emit("delivery:success", {
        item,
        result,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Handle item failure
   */
  private async handleFailure(item: QueueItem, error: unknown): Promise<void> {
    item.attempts++;
    const maxRetries = item.retryConfig?.maxRetries ?? 3;

    if (item.attempts >= maxRetries) {
      // Move to dead letter queue
      this.deadLetterQueue.set(item.id, item);
      this.stats.deadLetter++;
      this.emit("item:deadLetter", { item, error });
      return;
    }

    // Calculate next retry time with exponential backoff
    const baseDelay = item.retryConfig?.retryDelay ?? 1000;
    const multiplier = item.retryConfig?.backoffMultiplier ?? 2;
    const delay = baseDelay * Math.pow(multiplier, item.attempts - 1);

    item.nextRetryAt = new Date(Date.now() + delay);

    // Re-queue for retry
    this.queue.set(item.id, item);
    this.stats.pending++;
    this.stats.failed++;

    this.emit("item:retry", {
      item,
      error,
      nextRetryAt: item.nextRetryAt,
    });
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return { ...this.stats };
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.size;
  }

  /**
   * Get dead letter queue items
   */
  getDeadLetterItems(): QueueItem[] {
    return Array.from(this.deadLetterQueue.values());
  }

  /**
   * Retry dead letter item
   */
  async retryDeadLetter(id: string): Promise<boolean> {
    const item = this.deadLetterQueue.get(id);
    if (!item) return false;

    // Reset attempts and move back to main queue
    item.attempts = 0;
    delete item.nextRetryAt;

    this.deadLetterQueue.delete(id);
    this.stats.deadLetter--;

    await this.enqueue(item);
    return true;
  }

  /**
   * Clear dead letter queue
   */
  clearDeadLetter(): number {
    const count = this.deadLetterQueue.size;
    this.deadLetterQueue.clear();
    this.stats.deadLetter = 0;
    return count;
  }

  /**
   * Flush all pending items (for graceful shutdown)
   */
  async flush(timeout = 30000): Promise<void> {
    const startTime = Date.now();

    while (this.queue.size > 0 || this.processing.size > 0) {
      if (Date.now() - startTime > timeout) {
        throw new Error("Flush timeout");
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Get queue items for monitoring
   */
  getQueueItems(limit = 100): QueueItem[] {
    const items: QueueItem[] = [];
    let count = 0;

    for (const item of this.queue.values()) {
      if (count >= limit) break;
      items.push(item);
      count++;
    }

    return items;
  }

  /**
   * Get processing items
   */
  getProcessingItems(): string[] {
    return Array.from(this.processing);
  }

  /**
   * Remove item from queue
   */
  removeItem(id: string): boolean {
    if (this.queue.has(id)) {
      this.queue.delete(id);
      this.stats.pending--;
      return true;
    }

    if (this.deadLetterQueue.has(id)) {
      this.deadLetterQueue.delete(id);
      this.stats.deadLetter--;
      return true;
    }

    return false;
  }

  /**
   * Pause queue processing
   */
  pause(): void {
    this.isProcessing = false;
  }

  /**
   * Resume queue processing
   */
  resume(): void {
    this.isProcessing = true;
  }

  /**
   * Check if queue is paused
   */
  isPaused(): boolean {
    return !this.isProcessing;
  }
}
