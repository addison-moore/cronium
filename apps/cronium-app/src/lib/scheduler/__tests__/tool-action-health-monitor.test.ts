/**
 * @jest-environment node
 */
// tool-action-health-monitor.ts only imports a *type* from
// tool-action-executor, so no runtime boundary mocks are needed here.
import {
  ToolActionHealthMonitor,
  toolActionHealthMonitor,
} from "../tool-action-health-monitor";
import type { ToolActionHealthStatus } from "../tool-action-executor";

type MonitorStatics = {
  instance?: ToolActionHealthMonitor;
};

function resetSingleton(): void {
  (ToolActionHealthMonitor as unknown as MonitorStatics).instance = undefined;
}

function makeStatus(
  overrides: Partial<ToolActionHealthStatus> = {},
): ToolActionHealthStatus {
  return {
    toolId: 1,
    actionId: "slack-send-message",
    status: "healthy",
    latency: 100,
    timestamp: new Date("2026-07-22T12:00:00Z"),
    ...overrides,
  };
}

async function record(
  monitor: ToolActionHealthMonitor,
  count: number,
  overrides: Partial<ToolActionHealthStatus> = {},
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await monitor.recordExecution(makeStatus(overrides));
  }
}

let monitor: ToolActionHealthMonitor;
let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  resetSingleton();
  monitor = ToolActionHealthMonitor.getInstance();
  logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  monitor.stopMonitoring();
  jest.restoreAllMocks();
  jest.useRealTimers();
  resetSingleton();
});

describe("getInstance", () => {
  it("returns the same instance on repeated calls (singleton)", () => {
    const a = ToolActionHealthMonitor.getInstance();
    const b = ToolActionHealthMonitor.getInstance();
    expect(a).toBe(b);
  });

  it("exports a module-level singleton of the same class", () => {
    expect(toolActionHealthMonitor).toBeInstanceOf(ToolActionHealthMonitor);
  });

  it("applies custom thresholds only on first construction and warns when late thresholds are ignored", async () => {
    resetSingleton();
    const custom = ToolActionHealthMonitor.getInstance({
      minExecutionsForHealth: 2,
    });
    expect(warnSpy).not.toHaveBeenCalled();

    // A second call with different thresholds must not replace the instance —
    // and must warn instead of silently ignoring them.
    expect(
      ToolActionHealthMonitor.getInstance({ minExecutionsForHealth: 99 }),
    ).toBe(custom);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "thresholds after the singleton was created; keeping the original thresholds",
      ),
    );

    // A thresholds-free call stays quiet.
    warnSpy.mockClear();
    expect(ToolActionHealthMonitor.getInstance()).toBe(custom);
    expect(warnSpy).not.toHaveBeenCalled();

    await record(custom, 2);
    // With the default threshold (5) two executions would still be "unknown".
    expect(custom.getHealthMetrics(1, "slack-send-message")?.status).toBe(
      "healthy",
    );
  });
});

describe("recordExecution — metric accumulation", () => {
  it("creates empty metrics on first execution and tracks success counts", async () => {
    await monitor.recordExecution(makeStatus({ latency: 250 }));

    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics).toMatchObject({
      toolId: 1,
      actionId: "slack-send-message",
      successCount: 1,
      failureCount: 0,
      totalExecutions: 1,
      consecutiveFailures: 0,
      averageLatency: 250,
      maxLatency: 250,
      minLatency: 250,
      status: "unknown", // below minExecutionsForHealth
      healthScore: 100,
    });
    expect(metrics?.lastExecutionTime).toEqual(
      new Date("2026-07-22T12:00:00Z"),
    );
  });

  it("tracks failures and consecutive failures, resetting on success", async () => {
    await record(monitor, 2, { status: "failing" });
    let metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.failureCount).toBe(2);
    expect(metrics?.consecutiveFailures).toBe(2);

    await record(monitor, 1, { status: "healthy" });
    metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.successCount).toBe(1);
    expect(metrics?.consecutiveFailures).toBe(0);
    expect(metrics?.totalExecutions).toBe(3);
  });

  it("computes average, max and min latency across executions", async () => {
    await monitor.recordExecution(makeStatus({ latency: 100 }));
    await monitor.recordExecution(makeStatus({ latency: 300 }));
    await monitor.recordExecution(makeStatus({ latency: 200 }));

    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.averageLatency).toBe(200);
    expect(metrics?.maxLatency).toBe(300);
    expect(metrics?.minLatency).toBe(100);
  });

  it("counts a 0ms execution as a real latency sample (it can be the minimum)", async () => {
    await monitor.recordExecution(makeStatus({ latency: 0 }));
    await monitor.recordExecution(makeStatus({ latency: 400 }));

    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.totalExecutions).toBe(2);
    expect(metrics?.averageLatency).toBe(200);
    expect(metrics?.minLatency).toBe(0);
    expect(metrics?.maxLatency).toBe(400);
  });

  it("still ignores negative (clock-anomaly) latencies", async () => {
    await monitor.recordExecution(makeStatus({ latency: -5 }));
    await monitor.recordExecution(makeStatus({ latency: 300 }));

    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.totalExecutions).toBe(2);
    // The rejected sample still dilutes the average (pre-existing behavior).
    expect(metrics?.averageLatency).toBe(150);
    expect(metrics?.minLatency).toBe(300);
    expect(metrics?.maxLatency).toBe(300);
  });

  it("logs an error at exactly 3 consecutive failures once status is failing", async () => {
    // 4 successes then 3 failures: 7 executions, failure rate 3/7 (-40),
    // 3 consecutive failures (-30) => score 30 => failing.
    await record(monitor, 4);
    await record(monitor, 2, { status: "failing" });
    expect(errorSpy).not.toHaveBeenCalled();

    await record(monitor, 1, { status: "failing" });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Tool action 1-slack-send-message is failing continuously (3 failures)",
      ),
    );

    // A 4th consecutive failure does not re-log (only fires at exactly 3).
    errorSpy.mockClear();
    await record(monitor, 1, { status: "failing" });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("health score and status transitions", () => {
  it("stays unknown with a perfect score below the minimum execution count", async () => {
    await record(monitor, 4);
    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.status).toBe("unknown");
    expect(metrics?.healthScore).toBe(100);
  });

  it("becomes healthy (score 100) after enough clean executions", async () => {
    await record(monitor, 5);
    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.status).toBe("healthy");
    expect(metrics?.healthScore).toBe(100);
  });

  it("stays healthy with a low failure rate", async () => {
    // 1 failure in 20 => 5% rate => -20 => score 80 => healthy.
    await record(monitor, 1, { status: "failing" });
    await record(monitor, 19);

    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.healthScore).toBe(80);
    expect(metrics?.status).toBe("healthy");
  });

  it("degrades when the failure-rate penalty caps out but no failures are consecutive", async () => {
    // 4 failures / 10 executions => rate 0.4 => penalty capped at 40 => 60.
    await record(monitor, 4, { status: "failing" });
    await record(monitor, 6);

    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.healthScore).toBe(60);
    expect(metrics?.status).toBe("degraded");
  });

  it("degrades on sustained high latency alone", async () => {
    // avg 12000ms: latency penalty capped at 30 => score 70 => degraded.
    await record(monitor, 5, { latency: 12000 });

    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.healthScore).toBe(70);
    expect(metrics?.status).toBe("degraded");
  });

  it("applies a proportional latency penalty between thresholds", async () => {
    // avg 7500ms => (7500-5000)/(10000-5000)*30 = 15 => score 85 => healthy.
    await record(monitor, 5, { latency: 7500 });

    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.healthScore).toBe(85);
    expect(metrics?.status).toBe("healthy");
  });

  it("becomes failing when failures pile up consecutively", async () => {
    // 5 straight failures: -40 (rate) -30 (consecutive, capped) => 30.
    await record(monitor, 5, { status: "failing" });

    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.healthScore).toBe(30);
    expect(metrics?.status).toBe("failing");
  });

  it("floors the health score at 0", async () => {
    // 10 straight failures with extreme latency: all three penalties max out.
    await record(monitor, 10, { status: "failing", latency: 60000 });

    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.healthScore).toBe(0);
    expect(metrics?.status).toBe("failing");
  });
});

describe("query and reporting methods", () => {
  it("getHealthMetrics returns null for an unknown tool/action pair", () => {
    expect(monitor.getHealthMetrics(999, "nope")).toBeNull();
  });

  it("getUnhealthyActions returns only degraded/failing entries", async () => {
    await record(monitor, 5); // healthy: tool 1
    await record(monitor, 2, { toolId: 2 }); // unknown: tool 2
    await record(monitor, 5, { toolId: 3, latency: 12000 }); // degraded
    await record(monitor, 5, { toolId: 4, status: "failing" }); // failing

    const unhealthy = monitor.getUnhealthyActions();
    expect(unhealthy.map((m) => m.toolId).sort()).toEqual([3, 4]);
  });

  it("getHealthSummary aggregates counts and averages the health score", async () => {
    await record(monitor, 5); // healthy, 100
    await record(monitor, 1, { toolId: 2 }); // unknown, 100
    await record(monitor, 5, { toolId: 3, latency: 12000 }); // degraded, 70
    await record(monitor, 5, { toolId: 4, status: "failing" }); // failing, 30

    expect(monitor.getHealthSummary()).toEqual({
      total: 4,
      healthy: 1,
      degraded: 1,
      failing: 1,
      unknown: 1,
      overallHealthScore: 75, // round((100+100+70+30)/4)
    });
  });

  it("getHealthSummary reports a perfect score when empty", () => {
    expect(monitor.getHealthSummary()).toEqual({
      total: 0,
      healthy: 0,
      degraded: 0,
      failing: 0,
      unknown: 0,
      overallHealthScore: 100,
    });
  });
});

describe("needsAttention", () => {
  it("is false when there are no metrics", () => {
    expect(monitor.needsAttention(1, "slack-send-message")).toBe(false);
  });

  it("is false for a healthy action", async () => {
    await record(monitor, 5);
    expect(monitor.needsAttention(1, "slack-send-message")).toBe(false);
  });

  it("is true for a failing action", async () => {
    await record(monitor, 5, { status: "failing" });
    expect(monitor.needsAttention(1, "slack-send-message")).toBe(true);
  });

  it("is true after more than 2 consecutive failures even while unknown", async () => {
    await record(monitor, 3, { status: "failing" });
    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.status).toBe("unknown");
    expect(monitor.needsAttention(1, "slack-send-message")).toBe(true);
  });

  it("is true when degraded with failures outweighing half the successes", async () => {
    // 4 failures / 6 successes => degraded (60) and 4 > 6*0.5.
    await record(monitor, 4, { status: "failing" });
    await record(monitor, 6);
    expect(monitor.needsAttention(1, "slack-send-message")).toBe(true);
  });

  it("is false when degraded purely by latency with no failures", async () => {
    await record(monitor, 5, { latency: 12000 });
    const metrics = monitor.getHealthMetrics(1, "slack-send-message");
    expect(metrics?.status).toBe("degraded");
    expect(monitor.needsAttention(1, "slack-send-message")).toBe(false);
  });
});

describe("getRecommendations", () => {
  it("returns an empty list when there are no metrics", () => {
    expect(monitor.getRecommendations(1, "slack-send-message")).toEqual([]);
  });

  it("returns an empty list for a fast, reliable action", async () => {
    await record(monitor, 5, { latency: 100 });
    expect(monitor.getRecommendations(1, "slack-send-message")).toEqual([]);
  });

  it("returns all four recommendations when every threshold is breached", async () => {
    await record(monitor, 2, { latency: 100 });
    await record(monitor, 3, { status: "failing", latency: 12000 });

    const recs = monitor.getRecommendations(1, "slack-send-message");
    expect(recs).toEqual([
      "Consider optimizing the action logic or increasing timeout",
      "High failure rate detected. Check credentials and API limits",
      "Action has failed 3 times in a row",
      "Maximum latency exceeds threshold. Consider implementing retry logic",
    ]);
  });

  it("reports only the failure-rate and consecutive-failure issues for fast failures", async () => {
    await record(monitor, 1, { status: "failing", latency: 50 });
    await record(monitor, 4, { latency: 50 });
    await record(monitor, 2, { status: "failing", latency: 50 });

    const recs = monitor.getRecommendations(1, "slack-send-message");
    expect(recs).toEqual([
      "High failure rate detected. Check credentials and API limits",
      "Action has failed 2 times in a row",
    ]);
  });
});

describe("clearMetrics", () => {
  beforeEach(async () => {
    await record(monitor, 1, { toolId: 1, actionId: "a" });
    await record(monitor, 1, { toolId: 1, actionId: "b" });
    await record(monitor, 1, { toolId: 2, actionId: "a" });
  });

  it("clears a single tool/action pair", () => {
    monitor.clearMetrics(1, "a");
    expect(monitor.getHealthMetrics(1, "a")).toBeNull();
    expect(monitor.getHealthMetrics(1, "b")).not.toBeNull();
    expect(monitor.getHealthMetrics(2, "a")).not.toBeNull();
  });

  it("clears every action of one tool", () => {
    monitor.clearMetrics(1);
    expect(monitor.getHealthMetrics(1, "a")).toBeNull();
    expect(monitor.getHealthMetrics(1, "b")).toBeNull();
    expect(monitor.getHealthMetrics(2, "a")).not.toBeNull();
  });

  it("clears everything when called without arguments", () => {
    monitor.clearMetrics();
    expect(monitor.getHealthSummary().total).toBe(0);
  });

  it("clearMetrics(0) clears only tool 0 (the unknown-config bucket), not everything", async () => {
    // The executor records failures for unparseable configs under toolId 0,
    // so 0 is a real key — it must not fall through to "clear all".
    await record(monitor, 1, { toolId: 0, actionId: "unknown" });

    monitor.clearMetrics(0);

    expect(monitor.getHealthMetrics(0, "unknown")).toBeNull();
    expect(monitor.getHealthMetrics(1, "a")).not.toBeNull();
    expect(monitor.getHealthMetrics(1, "b")).not.toBeNull();
    expect(monitor.getHealthMetrics(2, "a")).not.toBeNull();
  });

  it("clearMetrics(0, actionId) clears exactly that pair", async () => {
    await record(monitor, 1, { toolId: 0, actionId: "unknown" });
    await record(monitor, 1, { toolId: 0, actionId: "other" });

    monitor.clearMetrics(0, "unknown");

    expect(monitor.getHealthMetrics(0, "unknown")).toBeNull();
    expect(monitor.getHealthMetrics(0, "other")).not.toBeNull();
    expect(monitor.getHealthMetrics(1, "a")).not.toBeNull();
  });
});

describe("startMonitoring / stopMonitoring", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it("runs an initial health update immediately and then on each interval", () => {
    monitor.startMonitoring(60000);
    expect(logSpy).toHaveBeenCalledWith(
      "Updating tool action health metrics...",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Tool Action Health Summary:",
      expect.objectContaining({ total: 0, overallHealthScore: 100 }),
    );

    logSpy.mockClear();
    jest.advanceTimersByTime(60000);
    expect(logSpy).toHaveBeenCalledWith(
      "Updating tool action health metrics...",
    );

    logSpy.mockClear();
    jest.advanceTimersByTime(120000);
    expect(
      logSpy.mock.calls.filter(
        (c) => c[0] === "Updating tool action health metrics...",
      ),
    ).toHaveLength(2);
  });

  it("warns about unhealthy actions during the periodic update", async () => {
    await record(monitor, 5, { status: "failing" });
    await record(monitor, 5, { toolId: 2, latency: 12000 });

    monitor.startMonitoring(1000);

    expect(warnSpy).toHaveBeenCalledWith(
      "2 tool actions need attention:",
      "1-slack-send-message (failing), 2-slack-send-message (degraded)",
    );
  });

  it("replaces a previous interval when called again", () => {
    monitor.startMonitoring(1000);
    monitor.startMonitoring(5000);
    logSpy.mockClear();

    // The old 1s interval must be gone: nothing fires before 5s.
    jest.advanceTimersByTime(4000);
    expect(logSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    expect(logSpy).toHaveBeenCalledWith(
      "Updating tool action health metrics...",
    );
  });

  it("uses a 60s default interval", () => {
    monitor.startMonitoring();
    logSpy.mockClear();

    jest.advanceTimersByTime(59999);
    expect(logSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(logSpy).toHaveBeenCalledWith(
      "Updating tool action health metrics...",
    );
  });

  it("stopMonitoring cancels the interval and is safe to call twice", () => {
    monitor.startMonitoring(1000);
    monitor.stopMonitoring();
    monitor.stopMonitoring(); // no-op when already stopped

    logSpy.mockClear();
    jest.advanceTimersByTime(10000);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("swallows errors thrown during the periodic update", () => {
    jest.spyOn(monitor, "getHealthSummary").mockImplementation(() => {
      throw new Error("summary exploded");
    });

    expect(() => monitor.startMonitoring(1000)).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      "Error updating health metrics:",
      expect.any(Error),
    );
  });
});
