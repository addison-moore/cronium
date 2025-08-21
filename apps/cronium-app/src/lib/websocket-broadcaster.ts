/**
 * WebSocket broadcaster with retry logic and health monitoring
 */

import type { Log, Job } from "@/shared/schema";

interface BroadcastConfig {
  maxRetries: number;
  retryDelay: number;
  maxRetryDelay: number;
  socketPort: string;
}

interface BroadcastResult {
  success: boolean;
  error?: string;
  attempts: number;
}

export class WebSocketBroadcaster {
  private config: BroadcastConfig;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isHealthy = false;
  private broadcastQueue: Array<{
    type: "log" | "job" | "execution" | "log-line";
    data: any;
    retries: number;
  }> = [];

  constructor(config?: Partial<BroadcastConfig>) {
    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      maxRetryDelay: 10000,
      socketPort: process.env.SOCKET_PORT ?? "5002",
      ...config,
    };

    // Start health monitoring
    this.startHealthMonitoring();
  }

  /**
   * Broadcast log update with retry logic
   */
  async broadcastLogUpdate(
    logId: number,
    update: Partial<Log>,
  ): Promise<BroadcastResult> {
    const data = { logId, update };
    return this.broadcastWithRetry("log", data);
  }

  /**
   * Broadcast job update with retry logic
   */
  async broadcastJobUpdate(job: Job): Promise<BroadcastResult> {
    return this.broadcastWithRetry("job", job);
  }

  /**
   * Broadcast execution status update
   */
  async broadcastExecutionUpdate(
    executionId: string,
    status: string,
    data?: {
      output?: string;
      error?: string;
      exitCode?: number;
      startedAt?: Date;
      completedAt?: Date;
    },
  ): Promise<BroadcastResult> {
    const update = {
      executionId,
      status,
      ...data,
      timestamp: new Date().toISOString(),
    };
    return this.broadcastWithRetry("execution", update);
  }

  /**
   * Broadcast log line for streaming output
   */
  async broadcastLogLine(
    logId: number,
    line: string,
    stream: "stdout" | "stderr" = "stdout",
  ): Promise<BroadcastResult> {
    const data = {
      logId,
      line,
      stream,
      timestamp: new Date().toISOString(),
    };
    return this.broadcastWithRetry("log-line", data);
  }

  /**
   * Core broadcast function with retry logic
   */
  private async broadcastWithRetry(
    type: "log" | "job" | "execution" | "log-line",
    data: any,
  ): Promise<BroadcastResult> {
    let attempts = 0;
    let lastError: string | undefined;
    let delay = this.config.retryDelay;

    while (attempts < this.config.maxRetries) {
      attempts++;

      try {
        const success = await this.sendBroadcast(type, data);
        if (success) {
          // Clear any queued broadcasts of the same type/id
          this.clearQueuedBroadcast(type, data);
          return { success: true, attempts };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(
          `[WebSocketBroadcaster] Broadcast attempt ${attempts} failed:`,
          lastError,
        );
      }

      // If not the last attempt, wait before retrying
      if (attempts < this.config.maxRetries) {
        await this.sleep(delay);
        // Exponential backoff
        delay = Math.min(delay * 2, this.config.maxRetryDelay);
      }
    }

    // All retries failed, queue for later if WebSocket is down
    if (!this.isHealthy) {
      this.queueBroadcast(type, data);
    }

    return {
      success: false,
      error: lastError ?? "All broadcast attempts failed",
      attempts,
    };
  }

  /**
   * Send a single broadcast attempt
   */
  private async sendBroadcast(
    type: "log" | "job" | "execution" | "log-line",
    data: any,
  ): Promise<boolean> {
    const endpoint = this.getEndpointForType(type);
    const url = `http://localhost:${this.config.socketPort}${endpoint}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  }

  /**
   * Get the appropriate endpoint for broadcast type
   */
  private getEndpointForType(
    type: "log" | "job" | "execution" | "log-line",
  ): string {
    switch (type) {
      case "log":
        return "/broadcast/log-update";
      case "job":
        return "/broadcast/job-update";
      case "execution":
        return "/broadcast/execution-update";
      case "log-line":
        return "/broadcast/log-line";
      default:
        return "/broadcast/generic";
    }
  }

  /**
   * Queue broadcast for later retry
   */
  private queueBroadcast(
    type: "log" | "job" | "execution" | "log-line",
    data: any,
  ): void {
    // Avoid duplicate entries
    const exists = this.broadcastQueue.some(
      (item) =>
        item.type === type &&
        JSON.stringify(item.data) === JSON.stringify(data),
    );

    if (!exists) {
      this.broadcastQueue.push({
        type,
        data: data as Record<string, unknown>,
        retries: 0,
      });
      console.log(`[WebSocketBroadcaster] Queued broadcast for later: ${type}`);
    }
  }

  /**
   * Clear queued broadcast
   */
  private clearQueuedBroadcast(
    type: "log" | "job" | "execution" | "log-line",
    data: any,
  ): void {
    this.broadcastQueue = this.broadcastQueue.filter(
      (item) =>
        !(
          item.type === type &&
          JSON.stringify(item.data) === JSON.stringify(data)
        ),
    );
  }

  /**
   * Process queued broadcasts
   */
  private async processQueue(): Promise<void> {
    if (this.broadcastQueue.length === 0) return;

    const queue = [...this.broadcastQueue];
    this.broadcastQueue = [];

    for (const item of queue) {
      if (item.retries >= this.config.maxRetries) {
        console.error(
          `[WebSocketBroadcaster] Dropping queued broadcast after ${item.retries} retries`,
        );
        continue;
      }

      try {
        const success = await this.sendBroadcast(item.type, item.data);
        if (!success) {
          // Re-queue with incremented retry count
          item.retries++;
          this.broadcastQueue.push(item);
        }
      } catch {
        // Re-queue with incremented retry count
        item.retries++;
        this.broadcastQueue.push(item);
      }
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    // Initial health check
    void this.checkHealth();

    // Periodic health checks every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      void this.checkHealth();
    }, 30000);
  }

  /**
   * Check WebSocket server health
   */
  private async checkHealth(): Promise<void> {
    try {
      const response = await fetch(
        `http://localhost:${this.config.socketPort}/health`,
        {
          signal: AbortSignal.timeout(3000),
        },
      );

      const wasHealthy = this.isHealthy;
      this.isHealthy = response.ok;

      if (!wasHealthy && this.isHealthy) {
        console.log("[WebSocketBroadcaster] WebSocket server is now healthy");
        // Process any queued broadcasts
        void this.processQueue();
      } else if (wasHealthy && !this.isHealthy) {
        console.error(
          "[WebSocketBroadcaster] WebSocket server became unhealthy",
        );
      }
    } catch (error) {
      if (this.isHealthy) {
        console.error("[WebSocketBroadcaster] Health check failed:", error);
      }
      this.isHealthy = false;
    }
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
let broadcaster: WebSocketBroadcaster | null = null;

export function getWebSocketBroadcaster(): WebSocketBroadcaster {
  broadcaster ??= new WebSocketBroadcaster();
  return broadcaster;
}
