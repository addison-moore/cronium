import { db } from "@/server/db";
import {
  toolActionLogs,
  logs,
  webhookDeliveries,
  workflowExecutions,
  events,
  webhooks,
  workflows,
} from "@/shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { QuotaManager } from "./QuotaManager";
import { RateLimiter } from "./RateLimiter";

export interface UsageMetrics {
  period: "day" | "week" | "month";
  startDate: Date;
  endDate: Date;
  toolActions: {
    total: number;
    byTool: Record<string, number>;
    successRate: number;
  };
  events: {
    total: number;
    byType: Record<string, number>;
    executionCount: number;
    successRate: number;
  };
  webhooks: {
    total: number;
    deliveries: number;
    successRate: number;
  };
  workflows: {
    total: number;
    executions: number;
    successRate: number;
  };
  storage: {
    totalMB: number;
    logsMB: number;
    filesMB: number;
  };
  api: {
    requests: number;
    byEndpoint: Record<string, number>;
    avgResponseTime: number;
  };
}

export interface UsageTrends {
  daily: UsageMetrics[];
  weekly: UsageMetrics[];
  monthly: UsageMetrics[];
}

export class UsageReporter {
  private static instance: UsageReporter;
  private quotaManager: QuotaManager;
  private rateLimiter: RateLimiter;

  private constructor() {
    this.quotaManager = QuotaManager.getInstance();
    this.rateLimiter = RateLimiter.getInstance();
  }

  static getInstance(): UsageReporter {
    if (!UsageReporter.instance) {
      UsageReporter.instance = new UsageReporter();
    }
    return UsageReporter.instance;
  }

  /**
   * Get usage metrics for a user
   */
  async getUserMetrics(
    userId: string,
    period: "day" | "week" | "month" = "month",
  ): Promise<UsageMetrics> {
    const { startDate, endDate } = this.getPeriodDates(period);

    const [
      toolActionMetrics,
      eventMetrics,
      webhookMetrics,
      workflowMetrics,
      storageMetrics,
    ] = await Promise.all([
      this.getToolActionMetrics(userId, startDate, endDate),
      this.getEventMetrics(userId, startDate, endDate),
      this.getWebhookMetrics(userId, startDate, endDate),
      this.getWorkflowMetrics(userId, startDate, endDate),
      this.getStorageMetrics(userId),
    ]);

    return {
      period,
      startDate,
      endDate,
      toolActions: toolActionMetrics,
      events: eventMetrics,
      webhooks: webhookMetrics,
      workflows: workflowMetrics,
      storage: storageMetrics,
      api: {
        requests: 0, // TODO: Implement API tracking
        byEndpoint: {},
        avgResponseTime: 0,
      },
    };
  }

  /**
   * Get tool action metrics
   */
  private async getToolActionMetrics(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<UsageMetrics["toolActions"]> {
    // Total actions - we need to join with events to get userId
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(toolActionLogs)
      .innerJoin(events, eq(toolActionLogs.eventId, events.id))
      .where(
        and(
          eq(events.userId, userId),
          gte(toolActionLogs.createdAt, startDate),
          sql`${toolActionLogs.createdAt} <= ${endDate}`,
        ),
      );

    // By tool
    const byToolResults = await db
      .select({
        toolType: toolActionLogs.toolType,
        count: sql<number>`count(*)`,
      })
      .from(toolActionLogs)
      .innerJoin(events, eq(toolActionLogs.eventId, events.id))
      .where(
        and(
          eq(events.userId, userId),
          gte(toolActionLogs.createdAt, startDate),
          sql`${toolActionLogs.createdAt} <= ${endDate}`,
        ),
      )
      .groupBy(toolActionLogs.toolType);

    // Success rate
    const [successResult] = await db
      .select({
        total: sql<number>`count(*)`,
        successful: sql<number>`count(case when ${toolActionLogs.status} = 'success' then 1 end)`,
      })
      .from(toolActionLogs)
      .innerJoin(events, eq(toolActionLogs.eventId, events.id))
      .where(
        and(
          eq(events.userId, userId),
          gte(toolActionLogs.createdAt, startDate),
          sql`${toolActionLogs.createdAt} <= ${endDate}`,
        ),
      );

    const byTool: Record<string, number> = {};
    for (const result of byToolResults) {
      byTool[result.toolType] = Number(result.count);
    }

    const total = Number(totalResult?.count ?? 0);
    const successful = Number(successResult?.successful ?? 0);
    const successRate = total > 0 ? (successful / total) * 100 : 0;

    return {
      total,
      byTool,
      successRate,
    };
  }

  /**
   * Get event metrics
   */
  private async getEventMetrics(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<UsageMetrics["events"]> {
    // Total events
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(events)
      .where(eq(events.userId, userId));

    // By type
    const byTypeResults = await db
      .select({
        type: events.type,
        count: sql<number>`count(*)`,
      })
      .from(events)
      .where(eq(events.userId, userId))
      .groupBy(events.type);

    // Execution count and success rate
    const [executionResult] = await db
      .select({
        total: sql<number>`count(*)`,
        successful: sql<number>`count(case when ${logs.status} = 'SUCCESS' then 1 end)`,
      })
      .from(logs)
      .innerJoin(events, eq(logs.eventId, events.id))
      .where(
        and(
          eq(events.userId, userId),
          gte(logs.startTime, startDate),
          sql`${logs.startTime} <= ${endDate}`,
        ),
      );

    const byType: Record<string, number> = {};
    for (const result of byTypeResults) {
      byType[result.type] = Number(result.count);
    }

    const total = Number(totalResult?.count ?? 0);
    const executionCount = Number(executionResult?.total ?? 0);
    const successful = Number(executionResult?.successful ?? 0);
    const successRate =
      executionCount > 0 ? (successful / executionCount) * 100 : 0;

    return {
      total,
      byType,
      executionCount,
      successRate,
    };
  }

  /**
   * Get webhook metrics
   */
  private async getWebhookMetrics(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<UsageMetrics["webhooks"]> {
    // Total webhooks
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(webhooks)
      .where(eq(webhooks.userId, userId));

    // Delivery stats
    const [deliveryResult] = await db
      .select({
        total: sql<number>`count(*)`,
        successful: sql<number>`count(case when ${webhookDeliveries.status} = 'success' then 1 end)`,
      })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
      .where(
        and(
          eq(webhooks.userId, userId),
          gte(webhookDeliveries.attemptedAt, startDate),
          sql`${webhookDeliveries.attemptedAt} <= ${endDate}`,
        ),
      );

    const total = Number(totalResult?.count ?? 0);
    const deliveries = Number(deliveryResult?.total ?? 0);
    const successful = Number(deliveryResult?.successful ?? 0);
    const successRate = deliveries > 0 ? (successful / deliveries) * 100 : 0;

    return {
      total,
      deliveries,
      successRate,
    };
  }

  /**
   * Get workflow metrics
   */
  private async getWorkflowMetrics(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<UsageMetrics["workflows"]> {
    // Total workflows
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(workflows)
      .where(eq(workflows.userId, userId));

    // Execution stats
    const [executionResult] = await db
      .select({
        total: sql<number>`count(*)`,
        successful: sql<number>`count(case when ${workflowExecutions.status} = 'completed' then 1 end)`,
      })
      .from(workflowExecutions)
      .innerJoin(workflows, eq(workflowExecutions.workflowId, workflows.id))
      .where(
        and(
          eq(workflows.userId, userId),
          gte(workflowExecutions.startedAt, startDate),
          sql`${workflowExecutions.startedAt} <= ${endDate}`,
        ),
      );

    const total = Number(totalResult?.count ?? 0);
    const executions = Number(executionResult?.total ?? 0);
    const successful = Number(executionResult?.successful ?? 0);
    const successRate = executions > 0 ? (successful / executions) * 100 : 0;

    return {
      total,
      executions,
      successRate,
    };
  }

  /**
   * Get storage metrics
   */
  private async getStorageMetrics(
    _userId: string,
  ): Promise<UsageMetrics["storage"]> {
    // This is a simplified version - in production, you'd calculate actual storage
    // TODO: Implement actual storage calculation
    return {
      totalMB: 0,
      logsMB: 0,
      filesMB: 0,
    };
  }

  /**
   * Get usage trends
   */
  async getUserTrends(userId: string): Promise<UsageTrends> {
    const now = new Date();
    const trends: UsageTrends = {
      daily: [],
      weekly: [],
      monthly: [],
    };

    // Last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const metrics = await this.getUserMetrics(userId, "day");
      trends.daily.push(metrics);
    }

    // Last 4 weeks
    for (let i = 3; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i * 7);
      const metrics = await this.getUserMetrics(userId, "week");
      trends.weekly.push(metrics);
    }

    // Last 3 months
    for (let i = 2; i >= 0; i--) {
      const date = new Date(now);
      date.setMonth(date.getMonth() - i);
      const metrics = await this.getUserMetrics(userId, "month");
      trends.monthly.push(metrics);
    }

    return trends;
  }

  /**
   * Get quota status summary
   */
  async getQuotaSummary(userId: string): Promise<{
    quotas: Record<
      string,
      {
        used: number;
        limit: number;
        percentage: number;
        status: "ok" | "warning" | "critical";
      }
    >;
    recommendations: string[];
  }> {
    const quotaStatus = await this.quotaManager.getQuotaStatus(userId);
    const quotas: Record<
      string,
      {
        used: number;
        limit: number;
        percentage: number;
        status: "ok" | "warning" | "critical";
      }
    > = {};
    const recommendations: string[] = [];

    for (const [key, value] of Object.entries(quotaStatus)) {
      let status: "ok" | "warning" | "critical" = "ok";
      const quotaValue = value as {
        used: number;
        limit: number;
        percentage: number;
      };
      if (quotaValue.percentage >= 100) {
        status = "critical";
      } else if (quotaValue.percentage >= 80) {
        status = "warning";
      }

      quotas[key] = {
        used: quotaValue.used,
        limit: quotaValue.limit,
        percentage: quotaValue.percentage,
        status,
      };

      // Generate recommendations
      if (status === "critical") {
        recommendations.push(
          `Your ${key} quota is exhausted. Consider upgrading your plan.`,
        );
      } else if (status === "warning") {
        recommendations.push(
          `You're approaching your ${key} limit (${quotaValue.percentage.toFixed(1)}% used).`,
        );
      }
    }

    return { quotas, recommendations };
  }

  /**
   * Export usage report
   */
  async exportUsageReport(
    userId: string,
    format: "json" | "csv" = "json",
  ): Promise<string> {
    const metrics = await this.getUserMetrics(userId, "month");
    const quotaSummary = await this.getQuotaSummary(userId);

    const report = {
      userId,
      generatedAt: new Date().toISOString(),
      period: {
        start: metrics.startDate.toISOString(),
        end: metrics.endDate.toISOString(),
      },
      usage: metrics,
      quotas: quotaSummary.quotas,
      recommendations: quotaSummary.recommendations,
    };

    if (format === "json") {
      return JSON.stringify(report, null, 2);
    } else {
      // CSV format
      const rows = [
        ["Metric", "Used", "Limit", "Percentage", "Status"],
        ...Object.entries(quotaSummary.quotas).map(([key, value]) => [
          key,
          value.used.toString(),
          value.limit.toString(),
          value.percentage.toFixed(1) + "%",
          value.status,
        ]),
      ];
      return rows.map((row) => row.join(",")).join("\n");
    }
  }

  /**
   * Get period dates
   */
  private getPeriodDates(period: "day" | "week" | "month"): {
    startDate: Date;
    endDate: Date;
  } {
    const now = new Date();
    const startDate = new Date(now);
    const endDate = new Date(now);

    switch (period) {
      case "day":
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      case "week":
        startDate.setDate(startDate.getDate() - startDate.getDay());
        startDate.setHours(0, 0, 0, 0);
        endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));
        endDate.setHours(23, 59, 59, 999);
        break;
      case "month":
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        endDate.setMonth(endDate.getMonth() + 1, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
    }

    return { startDate, endDate };
  }
}
