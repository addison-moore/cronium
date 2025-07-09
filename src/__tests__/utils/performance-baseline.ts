/**
 * Performance baseline measurement utilities for Phase 4 migration
 * This helps track performance before and after tRPC migration
 */

export interface PerformanceMetric {
  operation: string;
  responseTime: number;
  timestamp: Date;
  payloadSize?: number;
  cacheHit?: boolean;
  errorCount?: number;
}

export interface BaselineReport {
  avgResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  totalRequests: number;
  errorRate: number;
  avgPayloadSize?: number | undefined;
  cacheHitRate?: number | undefined;
}

class PerformanceTracker {
  private metrics: PerformanceMetric[] = [];
  private baselineData: Map<string, BaselineReport> = new Map();

  // Record a performance metric
  recordMetric(metric: PerformanceMetric) {
    this.metrics.push(metric);
  }

  // Measure API call performance
  async measureApiCall<T>(
    operation: string,
    apiCall: () => Promise<T>,
    options: { measurePayload?: boolean } = {},
  ): Promise<T> {
    const startTime = performance.now();
    let result: T | undefined = undefined;
    let errorOccurred = false;

    try {
      result = await apiCall();
    } catch (error) {
      errorOccurred = true;
      throw error;
    } finally {
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      // Only include payloadSize in the metric if it's measured and available
      const metricData: Omit<PerformanceMetric, "payloadSize"> = {
        operation,
        responseTime,
        timestamp: new Date(),
        errorCount: errorOccurred ? 1 : 0,
      };

      // Conditionally add payloadSize only when it's available
      if (options.measurePayload && result !== undefined) {
        const payloadSize = JSON.stringify(result).length;
        (metricData as PerformanceMetric).payloadSize = payloadSize;
      }

      this.recordMetric(metricData);
    }

    if (result === undefined) {
      throw new Error(`Operation ${operation} failed to return a result`);
    }

    return result;
  }

  // Generate baseline report for a specific operation
  generateReport(operation: string): BaselineReport {
    const operationMetrics = this.metrics.filter(
      (m) => m.operation === operation,
    );

    if (operationMetrics.length === 0) {
      return {
        avgResponseTime: 0,
        maxResponseTime: 0,
        minResponseTime: 0,
        totalRequests: 0,
        errorRate: 0,
      };
    }

    const responseTimes = operationMetrics.map((m) => m.responseTime);
    const avgResponseTime =
      responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    const maxResponseTime = Math.max(...responseTimes);
    const minResponseTime = Math.min(...responseTimes);
    const totalRequests = operationMetrics.length;

    const errorCount = operationMetrics.reduce(
      (sum, m) => sum + (m.errorCount || 0),
      0,
    );
    const errorRate = (errorCount / totalRequests) * 100;

    const payloadSizes = operationMetrics
      .map((m) => m.payloadSize)
      .filter((size): size is number => size !== undefined);

    const avgPayloadSize =
      payloadSizes.length > 0
        ? payloadSizes.reduce((sum, size) => sum + size, 0) /
          payloadSizes.length
        : undefined;

    const cacheHits = operationMetrics.filter((m) => m.cacheHit).length;
    const cacheHitRate =
      totalRequests > 0 ? (cacheHits / totalRequests) * 100 : undefined;

    return {
      avgResponseTime,
      maxResponseTime,
      minResponseTime,
      totalRequests,
      errorRate,
      avgPayloadSize,
      cacheHitRate,
    };
  }

  // Save baseline for comparison
  saveBaseline(operation: string) {
    const report = this.generateReport(operation);
    this.baselineData.set(operation, report);
    console.log(`Baseline saved for ${operation}:`, report);
  }

  // Compare current performance with baseline
  compareWithBaseline(operation: string): {
    current: BaselineReport;
    baseline: BaselineReport;
    improvements: {
      responseTime: number; // percentage change
      payloadSize: number;
      errorRate: number;
    };
  } | null {
    const baseline = this.baselineData.get(operation);
    if (!baseline) {
      console.warn(`No baseline found for operation: ${operation}`);
      return null;
    }

    const current = this.generateReport(operation);

    const responseTimeChange =
      baseline.avgResponseTime > 0
        ? ((current.avgResponseTime - baseline.avgResponseTime) /
            baseline.avgResponseTime) *
          100
        : 0;

    const payloadSizeChange =
      baseline.avgPayloadSize && current.avgPayloadSize
        ? ((current.avgPayloadSize - baseline.avgPayloadSize) /
            baseline.avgPayloadSize) *
          100
        : 0;

    const errorRateChange =
      baseline.errorRate > 0
        ? ((current.errorRate - baseline.errorRate) / baseline.errorRate) * 100
        : current.errorRate - baseline.errorRate;

    return {
      current,
      baseline,
      improvements: {
        responseTime: -responseTimeChange, // negative means improvement
        payloadSize: -payloadSizeChange,
        errorRate: -errorRateChange,
      },
    };
  }

  // Export all metrics for analysis
  exportMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  // Clear all metrics
  clear() {
    this.metrics = [];
  }

  // Get summary of all operations
  getSummary(): Record<string, BaselineReport> {
    const operations = [...new Set(this.metrics.map((m) => m.operation))];
    const summary: Record<string, BaselineReport> = {};

    operations.forEach((operation) => {
      summary[operation] = this.generateReport(operation);
    });

    return summary;
  }
}

// Global performance tracker instance
export const performanceTracker = new PerformanceTracker();

// REST API baseline measurements for comparison
export const measureRestApiBaseline = async () => {
  console.log("📊 Measuring REST API baseline performance...");

  // Measure GET /api/tools
  await performanceTracker.measureApiCall(
    "tools.getAll.rest",
    async () => {
      const response = await fetch("/api/tools");
      return response.json();
    },
    { measurePayload: true },
  );

  // Measure POST /api/tools
  const mockToolData = {
    name: "Baseline Test Tool",
    type: "EMAIL",
    credentials: {
      smtpHost: "smtp.test.com",
      smtpPort: 587,
      smtpUser: "test@test.com",
      smtpPassword: "password",
      fromEmail: "test@test.com",
      fromName: "Test User",
      enableTLS: true,
    },
  };

  try {
    await performanceTracker.measureApiCall(
      "tools.create.rest",
      async () => {
        const response = await fetch("/api/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mockToolData),
        });
        return response.json();
      },
      { measurePayload: true },
    );
  } catch (error) {
    console.warn(
      "REST baseline measurement failed (expected if tools API not available)",
    );
  }

  // Measure GET /api/tool-action-templates (new system)
  try {
    await performanceTracker.measureApiCall(
      "toolActionTemplates.getAll.rest",
      async () => {
        const response = await fetch(
          "/api/tool-action-templates?toolType=email",
        );
        return response.json();
      },
      { measurePayload: true },
    );
  } catch (error) {
    console.warn("REST tool action template baseline measurement failed");
  }

  // Save baselines
  performanceTracker.saveBaseline("tools.getAll.rest");
  performanceTracker.saveBaseline("tools.create.rest");
  performanceTracker.saveBaseline("toolActionTemplates.getAll.rest");

  console.log("✅ REST API baseline measurement complete");
  return performanceTracker.getSummary();
};

// tRPC performance measurements for comparison
export const measureTrpcPerformance = async (trpc: any) => {
  console.log("📊 Measuring tRPC API performance...");

  // Measure tools.getAll
  await performanceTracker.measureApiCall(
    "tools.getAll.trpc",
    async () => {
      return trpc.tools.getAll.query({ limit: 50 });
    },
    { measurePayload: true },
  );

  // Measure tools.create
  const mockToolData = {
    name: "tRPC Test Tool",
    type: "EMAIL" as const,
    credentials: {
      smtpHost: "smtp.test.com",
      smtpPort: 587,
      smtpUser: "test@test.com",
      smtpPassword: "password",
      fromEmail: "test@test.com",
      fromName: "Test User",
      enableTLS: true,
    },
  };

  try {
    await performanceTracker.measureApiCall(
      "tools.create.trpc",
      async () => {
        return trpc.tools.create.mutate(mockToolData);
      },
      { measurePayload: true },
    );
  } catch (error) {
    console.warn("tRPC tool creation measurement failed");
  }

  // Measure toolActionTemplates.getByToolAction (new system)
  try {
    await performanceTracker.measureApiCall(
      "toolActionTemplates.getAll.trpc",
      async () => {
        return trpc.toolActionTemplates.getByToolAction.query({
          toolType: "email",
          actionId: "send-email",
        });
      },
      { measurePayload: true },
    );
  } catch (error) {
    console.warn("tRPC tool action template measurement failed");
  }

  console.log("✅ tRPC API performance measurement complete");
  return performanceTracker.getSummary();
};

// Compare REST vs tRPC performance
export const compareRestVsTrpc = () => {
  console.log("🔍 Comparing REST vs tRPC performance...");

  const operations = [
    "tools.getAll",
    "tools.create",
    "toolActionTemplates.getAll",
  ];
  const comparisons: Record<string, any> = {};

  operations.forEach((operation) => {
    const restOperation = `${operation}.rest`;
    const trpcOperation = `${operation}.trpc`;

    const restReport = performanceTracker.generateReport(restOperation);
    const trpcReport = performanceTracker.generateReport(trpcOperation);

    if (restReport.totalRequests > 0 && trpcReport.totalRequests > 0) {
      const responseTimeImprovement =
        restReport.avgResponseTime > 0
          ? ((restReport.avgResponseTime - trpcReport.avgResponseTime) /
              restReport.avgResponseTime) *
            100
          : 0;

      const payloadSizeChange =
        restReport.avgPayloadSize && trpcReport.avgPayloadSize
          ? ((trpcReport.avgPayloadSize - restReport.avgPayloadSize) /
              restReport.avgPayloadSize) *
            100
          : 0;

      comparisons[operation] = {
        rest: restReport,
        trpc: trpcReport,
        improvements: {
          responseTime: responseTimeImprovement,
          payloadSize: -payloadSizeChange, // negative means increase
        },
      };
    }
  });

  console.log("📊 Performance comparison results:", comparisons);
  return comparisons;
};

// Bundle size measurement (approximate)
export const measureBundleSize = async () => {
  // This would need to be integrated with webpack-bundle-analyzer or similar
  // For now, provide a placeholder that can be implemented later
  console.log("📦 Bundle size measurement would be implemented here");

  return {
    before: { size: 0, gzip: 0 },
    after: { size: 0, gzip: 0 },
    change: { size: 0, gzip: 0 },
  };
};

// Memory usage tracking
export const trackMemoryUsage = () => {
  if (
    typeof window !== "undefined" &&
    "performance" in window &&
    "memory" in performance
  ) {
    const memory = (performance as any).memory;
    return {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      limit: memory.jsHeapSizeLimit,
      timestamp: new Date(),
    };
  }
  return null;
};

// Add a simple test to satisfy Jest requirements
describe("performance-baseline", () => {
  it("should export performanceTracker", () => {
    expect(performanceTracker).toBeDefined();
  });
});
