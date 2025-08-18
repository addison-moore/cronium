import { db } from "../../db";
import {
  systemSettings,
  events,
  servers,
  workflows,
  logs,
  LogStatus,
} from "../../../shared/schema";
import type { Setting } from "../../../shared/schema";
import type { DashboardStats } from "../types";
import { eq, and, gte, desc, count } from "drizzle-orm";
import {
  encryptionService,
  isSystemSettingSensitive,
} from "../../../lib/encryption-service";

export class SystemStorage {
  // Settings methods
  async getSetting(key: string): Promise<Setting | undefined> {
    const [setting] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key));

    // Decrypt sensitive settings
    if (setting && isSystemSettingSensitive(key)) {
      try {
        return {
          ...setting,
          value: encryptionService.decrypt(setting.value),
        };
      } catch (error) {
        console.error(`Error decrypting system setting ${key}:`, error);
        // Return setting without decryption rather than failing
        return setting;
      }
    }

    return setting;
  }

  async getAllSettings(): Promise<Setting[]> {
    const allSettings = await db.select().from(systemSettings);

    // Decrypt sensitive settings
    return allSettings.map((setting) => {
      if (isSystemSettingSensitive(setting.key)) {
        try {
          return {
            ...setting,
            value: encryptionService.decrypt(setting.value),
          };
        } catch (error) {
          console.error(
            `Error decrypting system setting ${setting.key}:`,
            error,
          );
          // Return setting without decryption rather than failing
          return setting;
        }
      }
      return setting;
    });
  }

  async upsertSetting(key: string, value: string): Promise<Setting> {
    // Encrypt sensitive values before storing
    const valueToStore = isSystemSettingSensitive(key)
      ? encryptionService.encrypt(value)
      : value;

    // Check if the setting exists (raw from DB, not decrypted)
    const [existingSetting] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key));

    if (existingSetting) {
      // Update the existing setting
      const [setting] = await db
        .update(systemSettings)
        .set({ value: valueToStore, updatedAt: new Date() })
        .where(eq(systemSettings.key, key))
        .returning();

      if (!setting) {
        throw new Error("Failed to update setting");
      }

      // Return decrypted value for immediate use
      if (isSystemSettingSensitive(key)) {
        return { ...setting, value };
      }
      return setting;
    } else {
      // Create a new setting
      const [setting] = await db
        .insert(systemSettings)
        .values({
          key,
          value: valueToStore,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (!setting) {
        throw new Error("Failed to create setting");
      }

      // Return decrypted value for immediate use
      if (isSystemSettingSensitive(key)) {
        return { ...setting, value };
      }
      return setting;
    }
  }

  // Dashboard stats
  async getDashboardStats(userId: string): Promise<DashboardStats> {
    // Get counts for various entities
    const [scriptCount] = await db
      .select({ count: count() })
      .from(events)
      .where(eq(events.userId, userId));
    const [serverCount] = await db
      .select({ count: count() })
      .from(servers)
      .where(eq(servers.userId, userId));
    const [workflowCount] = await db
      .select({ count: count() })
      .from(workflows)
      .where(eq(workflows.userId, userId));

    // Get recent execution stats
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentLogs = await db
      .select()
      .from(logs)
      .where(
        and(eq(logs.userId, userId), gte(logs.startTime, twentyFourHoursAgo)),
      )
      .orderBy(desc(logs.startTime));

    const successCount = recentLogs.filter((log) => log.successful).length;
    const failureCount = recentLogs.filter(
      (log) => !log.successful && log.status !== LogStatus.RUNNING,
    ).length;

    // Recent logs (last 5)
    const recentLogsList = recentLogs.slice(0, 5);

    return {
      counts: {
        scripts: Number(scriptCount?.count) ?? 0,
        servers: Number(serverCount?.count) ?? 0,
        workflows: Number(workflowCount?.count) ?? 0,
      },
      executions: {
        total: recentLogs.length,
        success: successCount,
        failure: failureCount,
        recent: recentLogsList,
      },
    };
  }
}
