import { EventEmitter } from "events";
import { z } from "zod";
import { db } from "@/server/db";
import { userQuotas, quotaUsage } from "@/shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export const QuotaConfigSchema = z.object({
  // Tool action quotas
  toolActionsPerMonth: z.number().default(10000),
  toolActionsPerDay: z.number().default(1000),

  // Webhook quotas
  webhooksPerUser: z.number().default(10),
  webhookEventsPerMonth: z.number().default(50000),

  // Event/Script quotas
  eventsPerUser: z.number().default(100),
  eventExecutionsPerMonth: z.number().default(10000),

  // Workflow quotas
  workflowsPerUser: z.number().default(50),
  workflowExecutionsPerMonth: z.number().default(5000),

  // Storage quotas
  totalStorageMB: z.number().default(1000),
  logRetentionDays: z.number().default(30),

  // API quotas
  apiRequestsPerMonth: z.number().default(100000),
  apiRequestsPerMinute: z.number().default(100),
});

export type QuotaConfig = z.infer<typeof QuotaConfigSchema>;

export interface QuotaCheckResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  resetAt?: Date;
  percentage: number;
}

export interface UserQuotaStatus {
  toolActions: QuotaCheckResult;
  webhooks: QuotaCheckResult;
  events: QuotaCheckResult;
  workflows: QuotaCheckResult;
  storage: QuotaCheckResult;
  apiRequests: QuotaCheckResult;
}

export class QuotaManager extends EventEmitter {
  private static instance: QuotaManager;
  private defaultQuotas: QuotaConfig;
  private cache = new Map<string, { data: any; expiresAt: Date }>();

  private constructor() {
    super();
    this.defaultQuotas = QuotaConfigSchema.parse({});
    this.startCacheCleanup();
  }

  static getInstance(): QuotaManager {
    if (!QuotaManager.instance) {
      QuotaManager.instance = new QuotaManager();
    }
    return QuotaManager.instance;
  }

  /**
   * Check quota for a specific resource
   */
  async checkQuota(
    userId: string,
    resource: keyof QuotaConfig,
    amount = 1,
  ): Promise<QuotaCheckResult> {
    const userQuota = await this.getUserQuota(userId);
    const usage = await this.getUsage(userId, resource);
    const limit = userQuota[resource];
    const used = usage.current;
    const remaining = Math.max(0, limit - used);

    const result: QuotaCheckResult = {
      allowed: remaining >= amount,
      limit,
      used,
      remaining,
      ...(usage.resetAt && { resetAt: usage.resetAt }),
      percentage: (used / limit) * 100,
    };

    // Emit warning events
    if (result.percentage >= 90 && result.percentage < 100) {
      this.emit("quota:warning", {
        userId,
        resource,
        percentage: result.percentage,
      });
    } else if (result.percentage >= 100) {
      this.emit("quota:exceeded", {
        userId,
        resource,
        limit,
        used,
      });
    }

    return result;
  }

  /**
   * Consume quota
   */
  async consumeQuota(
    userId: string,
    resource: keyof QuotaConfig,
    amount = 1,
  ): Promise<QuotaCheckResult> {
    const check = await this.checkQuota(userId, resource, amount);

    if (!check.allowed) {
      return check;
    }

    // Update usage
    await this.incrementUsage(userId, resource, amount);

    return {
      ...check,
      used: check.used + amount,
      remaining: check.remaining - amount,
      percentage: ((check.used + amount) / check.limit) * 100,
    };
  }

  /**
   * Get full quota status for a user
   */
  async getQuotaStatus(userId: string): Promise<UserQuotaStatus> {
    const [toolActions, webhooks, events, workflows, storage, apiRequests] =
      await Promise.all([
        this.checkQuota(userId, "toolActionsPerMonth"),
        this.checkQuota(userId, "webhooksPerUser"),
        this.checkQuota(userId, "eventsPerUser"),
        this.checkQuota(userId, "workflowsPerUser"),
        this.checkQuota(userId, "totalStorageMB"),
        this.checkQuota(userId, "apiRequestsPerMonth"),
      ]);

    return {
      toolActions,
      webhooks,
      events,
      workflows,
      storage,
      apiRequests,
    };
  }

  /**
   * Get user quota configuration
   */
  private async getUserQuota(userId: string): Promise<QuotaConfig> {
    const cacheKey = `quota:${userId}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > new Date()) {
      return cached.data;
    }

    const [userQuotaRecord] = await db
      .select()
      .from(userQuotas)
      .where(eq(userQuotas.userId, userId))
      .limit(1);

    const quotaConfig = userQuotaRecord?.quotaConfig as QuotaConfig | null;
    const result = { ...this.defaultQuotas, ...quotaConfig };

    // Cache for 5 minutes
    this.cache.set(cacheKey, {
      data: result,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    return result;
  }

  /**
   * Update user quota
   */
  async updateUserQuota(
    userId: string,
    updates: Partial<QuotaConfig>,
  ): Promise<void> {
    const currentQuota = await this.getUserQuota(userId);
    const newQuota = { ...currentQuota, ...updates };

    await db
      .insert(userQuotas)
      .values({
        userId,
        quotaConfig: newQuota,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userQuotas.userId,
        set: {
          quotaConfig: newQuota,
          updatedAt: new Date(),
        },
      });

    // Clear cache
    this.cache.delete(`quota:${userId}`);

    this.emit("quota:updated", { userId, updates });
  }

  /**
   * Get usage for a resource
   */
  private async getUsage(
    userId: string,
    resource: keyof QuotaConfig,
  ): Promise<{ current: number; resetAt?: Date }> {
    const now = new Date();
    let period: "day" | "month" | "total" = "total";

    // Determine period based on resource
    if (resource.includes("PerMonth")) {
      period = "month";
    } else if (resource.includes("PerDay")) {
      period = "day";
    }

    let startDate: Date | undefined;
    let resetAt: Date | undefined;

    if (period === "month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else if (period === "day") {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      resetAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    }

    const [usage] = await db
      .select()
      .from(quotaUsage)
      .where(
        and(
          eq(quotaUsage.userId, userId),
          eq(quotaUsage.resource, resource),
          startDate ? gte(quotaUsage.createdAt, startDate) : sql`true`,
        ),
      )
      .limit(1);

    if (usage) {
      return { current: usage.amount, ...(resetAt && { resetAt }) };
    }

    // Check actual usage from various tables
    const actualUsage = await this.calculateActualUsage(userId, resource);

    return { current: actualUsage, ...(resetAt && { resetAt }) };
  }

  /**
   * Calculate actual usage from database
   */
  private async calculateActualUsage(
    userId: string,
    resource: keyof QuotaConfig,
  ): Promise<number> {
    // This would query the actual tables to calculate usage
    // For now, return 0
    // TODO: Implement actual usage calculation
    return 0;
  }

  /**
   * Increment usage
   */
  private async incrementUsage(
    userId: string,
    resource: keyof QuotaConfig,
    amount: number,
  ): Promise<void> {
    await db.insert(quotaUsage).values({
      userId,
      resource,
      amount,
      createdAt: new Date(),
    });
  }

  /**
   * Reset quotas (for testing or manual intervention)
   */
  async resetQuotas(
    userId: string,
    resources?: Array<keyof QuotaConfig>,
  ): Promise<void> {
    if (resources) {
      for (const resource of resources) {
        await db
          .delete(quotaUsage)
          .where(
            and(
              eq(quotaUsage.userId, userId),
              eq(quotaUsage.resource, resource),
            ),
          );
      }
    } else {
      await db.delete(quotaUsage).where(eq(quotaUsage.userId, userId));
    }

    this.emit("quota:reset", { userId, resources });
  }

  /**
   * Get quota enforcement rules
   */
  getEnforcementRules(): Record<
    keyof QuotaConfig,
    {
      enforce: boolean;
      action: "block" | "warn" | "throttle";
      threshold?: number;
    }
  > {
    return {
      toolActionsPerMonth: { enforce: true, action: "block" },
      toolActionsPerDay: { enforce: true, action: "throttle" },
      webhooksPerUser: { enforce: true, action: "block" },
      webhookEventsPerMonth: { enforce: true, action: "warn", threshold: 0.9 },
      eventsPerUser: { enforce: true, action: "block" },
      eventExecutionsPerMonth: {
        enforce: true,
        action: "warn",
        threshold: 0.8,
      },
      workflowsPerUser: { enforce: true, action: "block" },
      workflowExecutionsPerMonth: { enforce: true, action: "throttle" },
      totalStorageMB: { enforce: true, action: "warn", threshold: 0.95 },
      logRetentionDays: { enforce: false, action: "warn" },
      apiRequestsPerMonth: { enforce: true, action: "throttle" },
      apiRequestsPerMinute: { enforce: true, action: "block" },
    };
  }

  /**
   * Create quota middleware
   */
  createMiddleware(resource: keyof QuotaConfig, amount = 1) {
    return async (req: any, res: any, next: any) => {
      const userId = req.user?.id || req.session?.user?.id;

      if (!userId) {
        return next();
      }

      const result = await this.consumeQuota(userId, resource, amount);

      // Set headers
      res.setHeader("X-Quota-Limit", result.limit.toString());
      res.setHeader("X-Quota-Remaining", result.remaining.toString());
      res.setHeader("X-Quota-Used", result.used.toString());

      if (!result.allowed) {
        const rule = this.getEnforcementRules()[resource];

        if (rule.action === "block") {
          return res.status(429).json({
            error: "Quota Exceeded",
            message: `You have exceeded your ${resource} quota`,
            limit: result.limit,
            used: result.used,
            resetAt: result.resetAt,
          });
        } else if (rule.action === "throttle") {
          // Add delay
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      next();
    };
  }

  /**
   * Get usage report
   */
  async getUsageReport(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<
    Array<{
      resource: string;
      date: Date;
      amount: number;
    }>
  > {
    const usage = await db
      .select()
      .from(quotaUsage)
      .where(
        and(
          eq(quotaUsage.userId, userId),
          gte(quotaUsage.createdAt, startDate),
          sql`${quotaUsage.createdAt} <= ${endDate}`,
        ),
      )
      .orderBy(quotaUsage.createdAt);

    return usage.map((u) => ({
      resource: u.resource,
      date: u.createdAt,
      amount: u.amount,
    }));
  }

  /**
   * Start cache cleanup
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = new Date();
      for (const [key, value] of this.cache) {
        if (value.expiresAt < now) {
          this.cache.delete(key);
        }
      }
    }, 60000); // Clean up every minute
  }
}
