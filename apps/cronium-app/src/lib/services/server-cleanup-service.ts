/**
 * Server Cleanup Service
 * Handles automatic deletion of archived servers after their retention period
 */

import { storage } from "@/server/storage";
import type { Server } from "@/shared/schema";
import type { ServerStorage } from "@/server/storage/modules/servers";

// Cast storage to include servers property
const storageWithServers = storage as typeof storage & {
  servers: ServerStorage;
};

interface CleanupServiceConfig {
  enabled: boolean;
  interval: number; // Run interval in milliseconds (default: 1 hour)
  batchSize: number; // Number of servers to process per run
  notificationDays: number[]; // Days before deletion to notify (e.g., [7, 1])
}

interface CleanupResult {
  processedCount: number;
  deletedCount: number;
  notificationsSent: number;
  errors: string[];
  startTime: Date;
  endTime: Date;
}

export class ServerCleanupService {
  private static instance: ServerCleanupService | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private config: CleanupServiceConfig;
  private lastRunTime: Date | null = null;

  private constructor(config?: Partial<CleanupServiceConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      interval: config?.interval ?? 3600000, // 1 hour default
      batchSize: config?.batchSize ?? 10,
      notificationDays: config?.notificationDays ?? [7, 1],
    };
  }

  /**
   * Get or create the singleton instance
   */
  static getInstance(
    config?: Partial<CleanupServiceConfig>,
  ): ServerCleanupService {
    if (!ServerCleanupService.instance) {
      ServerCleanupService.instance = new ServerCleanupService(config);
    }
    return ServerCleanupService.instance;
  }

  /**
   * Start the cleanup service
   */
  start(): void {
    if (!this.config.enabled) {
      console.log("[ServerCleanupService] Service is disabled");
      return;
    }

    if (this.intervalId) {
      console.log("[ServerCleanupService] Service is already running");
      return;
    }

    console.log(
      `[ServerCleanupService] Starting service with interval: ${this.config.interval}ms`,
    );

    // Run immediately on start
    void this.runCleanupCycle();

    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      void this.runCleanupCycle();
    }, this.config.interval);

    this.isRunning = true;
  }

  /**
   * Stop the cleanup service
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.isRunning = false;
      console.log("[ServerCleanupService] Service stopped");
    }
  }

  /**
   * Check if the service is running
   */
  isServiceRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the last run time
   */
  getLastRunTime(): Date | null {
    return this.lastRunTime;
  }

  /**
   * Run a single cleanup cycle
   */
  async runCleanupCycle(): Promise<CleanupResult> {
    const startTime = new Date();
    const result: CleanupResult = {
      processedCount: 0,
      deletedCount: 0,
      notificationsSent: 0,
      errors: [],
      startTime,
      endTime: new Date(),
    };

    try {
      console.log("[ServerCleanupService] Starting cleanup cycle");

      // 1. Process scheduled deletions
      const deletionResult = await this.processScheduledDeletions();
      result.deletedCount = deletionResult.deletedCount;
      result.processedCount += deletionResult.processedCount;
      result.errors.push(...deletionResult.errors);

      // 2. Send deletion warnings
      const notificationResult = await this.sendDeletionWarnings();
      result.notificationsSent = notificationResult.notificationsSent;
      result.errors.push(...notificationResult.errors);

      // 3. Clean up any orphaned resources
      await this.cleanupOrphanedResources();

      this.lastRunTime = startTime;
      result.endTime = new Date();

      console.log(
        `[ServerCleanupService] Cleanup cycle completed. Deleted: ${result.deletedCount}, Notifications: ${result.notificationsSent}`,
      );
    } catch (error) {
      console.error(
        "[ServerCleanupService] Error during cleanup cycle:",
        error,
      );
      result.errors.push(
        error instanceof Error ? error.message : "Unknown error",
      );
    }

    return result;
  }

  /**
   * Process servers scheduled for deletion
   */
  private async processScheduledDeletions(): Promise<{
    processedCount: number;
    deletedCount: number;
    errors: string[];
  }> {
    const result = {
      processedCount: 0,
      deletedCount: 0,
      errors: [] as string[],
    };

    try {
      // Get servers that are past their deletion date
      const serversToDelete =
        await storageWithServers.servers.getServersScheduledForDeletion(
          this.config.batchSize,
        );

      result.processedCount = serversToDelete.length;

      for (const server of serversToDelete) {
        try {
          console.log(
            `[ServerCleanupService] Permanently deleting server: ${server.id} (${server.name})`,
          );

          // Permanently delete the server
          await storageWithServers.servers.permanentlyDeleteServer(server.id);

          result.deletedCount++;

          // Log the deletion
          console.log(
            `[ServerCleanupService] Successfully deleted server ${server.id}`,
          );
        } catch (error) {
          const errorMsg = `Failed to delete server ${server.id}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`;
          console.error(`[ServerCleanupService] ${errorMsg}`);
          result.errors.push(errorMsg);
        }
      }
    } catch (error) {
      const errorMsg = `Failed to fetch servers for deletion: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      console.error(`[ServerCleanupService] ${errorMsg}`);
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Send warnings for servers approaching deletion
   */
  private async sendDeletionWarnings(): Promise<{
    notificationsSent: number;
    errors: string[];
  }> {
    const result = {
      notificationsSent: 0,
      errors: [] as string[],
    };

    try {
      // Check for each notification period
      for (const days of this.config.notificationDays) {
        const serversApproaching =
          await storageWithServers.servers.getServersApproachingDeletion(days);

        for (const server of serversApproaching) {
          try {
            // Check if we've already sent this notification
            const notificationExists =
              await storageWithServers.servers.hasNotificationBeenSent(
                server.id,
                `${days}_day_warning`,
              );

            if (!notificationExists) {
              // Create notification record
              await storageWithServers.servers.createDeletionNotification(
                server.id,
                server.userId,
                `${days}_day_warning`,
              );

              result.notificationsSent++;

              console.log(
                `[ServerCleanupService] Sent ${days}-day warning for server ${server.id}`,
              );
            }
          } catch (error) {
            const errorMsg = `Failed to send notification for server ${server.id}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`;
            console.error(`[ServerCleanupService] ${errorMsg}`);
            result.errors.push(errorMsg);
          }
        }
      }
    } catch (error) {
      const errorMsg = `Failed to process deletion warnings: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      console.error(`[ServerCleanupService] ${errorMsg}`);
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * Clean up orphaned resources
   */
  private async cleanupOrphanedResources(): Promise<void> {
    try {
      // This could include:
      // - Cleaning up SSH keys from remote servers
      // - Removing runner binaries
      // - Clearing cached data
      // For now, we'll just log
      console.log(
        "[ServerCleanupService] Checking for orphaned resources (not implemented yet)",
      );
    } catch (error) {
      console.error(
        "[ServerCleanupService] Error cleaning orphaned resources:",
        error,
      );
    }
  }

  /**
   * Get upcoming deletions for display
   */
  async getUpcomingDeletions(
    userId?: string,
    daysAhead = 30,
  ): Promise<Server[]> {
    try {
      const servers =
        await storageWithServers.servers.getServersApproachingDeletion(
          daysAhead,
        );

      // Filter by user if specified
      if (userId) {
        return servers.filter((s: Server) => s.userId === userId);
      }

      return servers;
    } catch (error) {
      console.error(
        "[ServerCleanupService] Error fetching upcoming deletions:",
        error,
      );
      return [];
    }
  }

  /**
   * Manually trigger deletion of a specific server
   */
  async deleteServerNow(serverId: number): Promise<void> {
    try {
      console.log(
        `[ServerCleanupService] Manual deletion requested for server ${serverId}`,
      );
      await storageWithServers.servers.permanentlyDeleteServer(serverId);
    } catch (error) {
      console.error(
        `[ServerCleanupService] Error deleting server ${serverId}:`,
        error,
      );
      throw error;
    }
  }
}

// Export a singleton instance
export const serverCleanupService = ServerCleanupService.getInstance({
  enabled: process.env.SERVER_CLEANUP_ENABLED === "true",
  interval: parseInt(process.env.SERVER_CLEANUP_INTERVAL ?? "3600000"),
  batchSize: parseInt(process.env.SERVER_CLEANUP_BATCH_SIZE ?? "10"),
  notificationDays: JSON.parse(
    process.env.SERVER_DELETION_WARNING_DAYS ?? "[7, 1]",
  ) as number[],
});
