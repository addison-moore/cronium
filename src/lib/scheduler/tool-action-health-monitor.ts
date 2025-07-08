import { type ToolActionHealthStatus } from "./tool-action-executor";
import { storage } from "@/server/storage";

interface HealthMetrics {
  toolId: number;
  actionId: string;
  successCount: number;
  failureCount: number;
  totalExecutions: number;
  averageLatency: number;
  maxLatency: number;
  minLatency: number;
  lastExecutionTime: Date;
  consecutiveFailures: number;
  healthScore: number; // 0-100
  status: "healthy" | "degraded" | "failing" | "unknown";
}

interface HealthThresholds {
  maxLatencyMs: number;
  failureRateThreshold: number;
  degradedLatencyMs: number;
  minExecutionsForHealth: number;
}

const DEFAULT_THRESHOLDS: HealthThresholds = {
  maxLatencyMs: 10000, // 10 seconds
  failureRateThreshold: 0.1, // 10% failure rate
  degradedLatencyMs: 5000, // 5 seconds
  minExecutionsForHealth: 5, // Need at least 5 executions to determine health
};

export class ToolActionHealthMonitor {
  private static instance: ToolActionHealthMonitor;
  private metricsCache = new Map<string, HealthMetrics>();
  private thresholds: HealthThresholds;
  private updateInterval: NodeJS.Timer | null = null;

  private constructor(thresholds: Partial<HealthThresholds> = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  static getInstance(
    thresholds?: Partial<HealthThresholds>,
  ): ToolActionHealthMonitor {
    if (!ToolActionHealthMonitor.instance) {
      ToolActionHealthMonitor.instance = new ToolActionHealthMonitor(
        thresholds,
      );
    }
    return ToolActionHealthMonitor.instance;
  }

  /**
   * Start monitoring tool action health
   */
  startMonitoring(intervalMs = 60000): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      this.updateHealthMetrics();
    }, intervalMs);

    // Initial update
    this.updateHealthMetrics();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Record a tool action execution
   */
  async recordExecution(healthStatus: ToolActionHealthStatus): Promise<void> {
    const key = `${healthStatus.toolId}-${healthStatus.actionId}`;
    const metrics =
      this.metricsCache.get(key) ||
      this.createEmptyMetrics(healthStatus.toolId, healthStatus.actionId);

    // Update metrics based on execution result
    metrics.totalExecutions++;
    metrics.lastExecutionTime = healthStatus.timestamp;

    if (healthStatus.status === "failing") {
      metrics.failureCount++;
      metrics.consecutiveFailures++;
    } else {
      metrics.successCount++;
      metrics.consecutiveFailures = 0;
    }

    // Update latency metrics
    if (healthStatus.latency > 0) {
      const totalLatency =
        metrics.averageLatency * (metrics.totalExecutions - 1) +
        healthStatus.latency;
      metrics.averageLatency = totalLatency / metrics.totalExecutions;
      metrics.maxLatency = Math.max(metrics.maxLatency, healthStatus.latency);
      metrics.minLatency =
        metrics.minLatency === 0
          ? healthStatus.latency
          : Math.min(metrics.minLatency, healthStatus.latency);
    }

    // Calculate health score and status
    this.calculateHealthScore(metrics);

    // Update cache
    this.metricsCache.set(key, metrics);

    // Log significant health changes
    if (metrics.status === "failing" && metrics.consecutiveFailures === 3) {
      console.error(
        `Tool action ${key} is failing continuously (${metrics.consecutiveFailures} failures)`,
      );
    }
  }

  /**
   * Get health metrics for a specific tool action
   */
  getHealthMetrics(toolId: number, actionId: string): HealthMetrics | null {
    const key = `${toolId}-${actionId}`;
    return this.metricsCache.get(key) || null;
  }

  /**
   * Get all unhealthy tool actions
   */
  getUnhealthyActions(): HealthMetrics[] {
    return Array.from(this.metricsCache.values()).filter(
      (metrics) => metrics.status !== "healthy" && metrics.status !== "unknown",
    );
  }

  /**
   * Get health summary for all tool actions
   */
  getHealthSummary(): {
    total: number;
    healthy: number;
    degraded: number;
    failing: number;
    unknown: number;
    overallHealthScore: number;
  } {
    const metrics = Array.from(this.metricsCache.values());
    const summary = {
      total: metrics.length,
      healthy: 0,
      degraded: 0,
      failing: 0,
      unknown: 0,
      overallHealthScore: 0,
    };

    let totalHealthScore = 0;
    metrics.forEach((metric) => {
      summary[metric.status]++;
      totalHealthScore += metric.healthScore;
    });

    summary.overallHealthScore =
      metrics.length > 0 ? Math.round(totalHealthScore / metrics.length) : 100;

    return summary;
  }

  /**
   * Check if a specific tool action needs attention
   */
  needsAttention(toolId: number, actionId: string): boolean {
    const metrics = this.getHealthMetrics(toolId, actionId);
    if (!metrics) return false;

    return (
      metrics.status === "failing" ||
      metrics.consecutiveFailures > 2 ||
      (metrics.status === "degraded" &&
        metrics.failureCount > metrics.successCount * 0.5)
    );
  }

  /**
   * Get recommendations for improving tool action health
   */
  getRecommendations(toolId: number, actionId: string): string[] {
    const metrics = this.getHealthMetrics(toolId, actionId);
    if (!metrics) return [];

    const recommendations: string[] = [];

    if (metrics.averageLatency > this.thresholds.degradedLatencyMs) {
      recommendations.push(
        "Consider optimizing the action logic or increasing timeout",
      );
    }

    if (
      metrics.failureCount / metrics.totalExecutions >
      this.thresholds.failureRateThreshold
    ) {
      recommendations.push(
        "High failure rate detected. Check credentials and API limits",
      );
    }

    if (metrics.consecutiveFailures > 0) {
      recommendations.push(
        `Action has failed ${metrics.consecutiveFailures} times in a row`,
      );
    }

    if (metrics.maxLatency > this.thresholds.maxLatencyMs) {
      recommendations.push(
        "Maximum latency exceeds threshold. Consider implementing retry logic",
      );
    }

    return recommendations;
  }

  /**
   * Clear metrics for a specific tool or all tools
   */
  clearMetrics(toolId?: number, actionId?: string): void {
    if (toolId && actionId) {
      const key = `${toolId}-${actionId}`;
      this.metricsCache.delete(key);
    } else if (toolId) {
      // Clear all metrics for a specific tool
      Array.from(this.metricsCache.keys())
        .filter((key) => key.startsWith(`${toolId}-`))
        .forEach((key) => this.metricsCache.delete(key));
    } else {
      // Clear all metrics
      this.metricsCache.clear();
    }
  }

  private createEmptyMetrics(toolId: number, actionId: string): HealthMetrics {
    return {
      toolId,
      actionId,
      successCount: 0,
      failureCount: 0,
      totalExecutions: 0,
      averageLatency: 0,
      maxLatency: 0,
      minLatency: 0,
      lastExecutionTime: new Date(),
      consecutiveFailures: 0,
      healthScore: 100,
      status: "unknown",
    };
  }

  private calculateHealthScore(metrics: HealthMetrics): void {
    // Not enough data to determine health
    if (metrics.totalExecutions < this.thresholds.minExecutionsForHealth) {
      metrics.status = "unknown";
      metrics.healthScore = 100;
      return;
    }

    let score = 100;

    // Failure rate impact (0-40 points)
    const failureRate = metrics.failureCount / metrics.totalExecutions;
    if (failureRate > 0) {
      score -= Math.min(40, failureRate * 400);
    }

    // Latency impact (0-30 points)
    if (metrics.averageLatency > this.thresholds.degradedLatencyMs) {
      const latencyPenalty = Math.min(
        30,
        ((metrics.averageLatency - this.thresholds.degradedLatencyMs) /
          (this.thresholds.maxLatencyMs - this.thresholds.degradedLatencyMs)) *
          30,
      );
      score -= latencyPenalty;
    }

    // Consecutive failures impact (0-30 points)
    if (metrics.consecutiveFailures > 0) {
      score -= Math.min(30, metrics.consecutiveFailures * 10);
    }

    metrics.healthScore = Math.max(0, Math.round(score));

    // Determine status based on score
    if (metrics.healthScore >= 80) {
      metrics.status = "healthy";
    } else if (metrics.healthScore >= 50) {
      metrics.status = "degraded";
    } else {
      metrics.status = "failing";
    }
  }

  private async updateHealthMetrics(): Promise<void> {
    try {
      // In a real implementation, this would query the database for recent executions
      // and update the metrics cache
      console.log("Updating tool action health metrics...");

      // For now, just log the current health summary
      const summary = this.getHealthSummary();
      console.log("Tool Action Health Summary:", summary);

      // Check for actions needing attention
      const unhealthyActions = this.getUnhealthyActions();
      if (unhealthyActions.length > 0) {
        console.warn(
          `${unhealthyActions.length} tool actions need attention:`,
          unhealthyActions
            .map((m) => `${m.toolId}-${m.actionId} (${m.status})`)
            .join(", "),
        );
      }
    } catch (error) {
      console.error("Error updating health metrics:", error);
    }
  }
}

// Export singleton instance
export const toolActionHealthMonitor = ToolActionHealthMonitor.getInstance();
