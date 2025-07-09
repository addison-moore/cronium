/**
 * Circuit breaker pattern for fault tolerance
 */

export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  successThreshold: number; // Number of successes to close from half-open
  timeout: number; // Time in ms before trying half-open
  volumeThreshold: number; // Minimum requests before evaluating
  errorThresholdPercentage: number; // Error percentage to open circuit
  rollingWindowSize: number; // Time window for metrics in ms
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerMetrics {
  state: CircuitState;
  failures: number;
  successes: number;
  totalRequests: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  errorRate: number;
  nextAttemptTime?: Date;
}

interface RequestResult {
  timestamp: Date;
  success: boolean;
  duration: number;
  error?: Error;
}

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker<T> {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private successes = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private nextAttemptTime?: Date;
  private requestHistory: RequestResult[] = [];

  private defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000, // 1 minute
    volumeThreshold: 10,
    errorThresholdPercentage: 50,
    rollingWindowSize: 60000, // 1 minute
  };

  constructor(
    private name: string,
    private config: Partial<CircuitBreakerConfig> = {},
  ) {
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute<R extends T>(fn: () => Promise<R>): Promise<R> {
    // Check if circuit is open
    if (this.state === "OPEN") {
      if (this.canAttemptReset()) {
        this.state = "HALF_OPEN";
        console.log(`Circuit breaker ${this.name} entering HALF_OPEN state`);
      } else {
        throw new Error(
          `Circuit breaker ${this.name} is OPEN. Next attempt at ${this.nextAttemptTime?.toISOString()}`,
        );
      }
    }

    const startTime = Date.now();

    try {
      const result = await fn();
      this.onSuccess(Date.now() - startTime);
      return result;
    } catch (error) {
      this.onFailure(
        error instanceof Error ? error : new Error(String(error)),
        Date.now() - startTime,
      );
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(duration: number): void {
    this.successes++;
    this.lastSuccessTime = new Date();

    // Record in history
    this.recordRequest({ success: true, duration });

    if (this.state === "HALF_OPEN") {
      if (this.successes >= this.getConfig().successThreshold) {
        this.state = "CLOSED";
        this.failures = 0;
        this.successes = 0;
        console.log(`Circuit breaker ${this.name} is now CLOSED`);
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: Error, duration: number): void {
    this.failures++;
    this.lastFailureTime = new Date();

    // Record in history
    this.recordRequest({ success: false, duration, error });

    if (this.state === "HALF_OPEN") {
      this.openCircuit();
    } else if (this.state === "CLOSED") {
      // Check if we should open based on thresholds
      if (this.shouldOpen()) {
        this.openCircuit();
      }
    }
  }

  /**
   * Open the circuit
   */
  private openCircuit(): void {
    this.state = "OPEN";
    this.nextAttemptTime = new Date(Date.now() + this.getConfig().timeout);
    this.successes = 0;
    console.log(
      `Circuit breaker ${this.name} is now OPEN. Next attempt at ${this.nextAttemptTime.toISOString()}`,
    );
  }

  /**
   * Check if circuit should open
   */
  private shouldOpen(): boolean {
    const config = this.getConfig();

    // Check failure count threshold
    if (this.failures >= config.failureThreshold) {
      return true;
    }

    // Check error rate in rolling window
    const recentRequests = this.getRecentRequests();
    if (recentRequests.length >= config.volumeThreshold) {
      const errorRate = this.calculateErrorRate(recentRequests);
      if (errorRate >= config.errorThresholdPercentage / 100) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if we can attempt reset from open state
   */
  private canAttemptReset(): boolean {
    if (!this.nextAttemptTime) return true;
    return Date.now() >= this.nextAttemptTime.getTime();
  }

  /**
   * Record request in history
   */
  private recordRequest(result: Omit<RequestResult, "timestamp">): void {
    this.requestHistory.push({
      ...result,
      timestamp: new Date(),
    });

    // Clean old entries
    this.cleanHistory();
  }

  /**
   * Get recent requests within rolling window
   */
  private getRecentRequests(): RequestResult[] {
    const cutoff = Date.now() - this.getConfig().rollingWindowSize;
    return this.requestHistory.filter(
      (req) => req.timestamp.getTime() > cutoff,
    );
  }

  /**
   * Calculate error rate
   */
  private calculateErrorRate(requests: RequestResult[]): number {
    if (requests.length === 0) return 0;
    const failures = requests.filter((req) => !req.success).length;
    return failures / requests.length;
  }

  /**
   * Clean old history entries
   */
  private cleanHistory(): void {
    const cutoff = Date.now() - this.getConfig().rollingWindowSize * 2;
    this.requestHistory = this.requestHistory.filter(
      (req) => req.timestamp.getTime() > cutoff,
    );
  }

  /**
   * Get typed config
   */
  private getConfig(): CircuitBreakerConfig {
    return { ...this.defaultConfig, ...this.config };
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    const recentRequests = this.getRecentRequests();
    const errorRate = this.calculateErrorRate(recentRequests);

    const metrics: CircuitBreakerMetrics = {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalRequests: recentRequests.length,
      errorRate,
    };

    if (this.lastFailureTime) {
      metrics.lastFailureTime = this.lastFailureTime;
    }
    if (this.lastSuccessTime) {
      metrics.lastSuccessTime = this.lastSuccessTime;
    }
    if (this.nextAttemptTime) {
      metrics.nextAttemptTime = this.nextAttemptTime;
    }

    return metrics;
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = "CLOSED";
    this.failures = 0;
    this.successes = 0;
    delete this.nextAttemptTime;
    console.log(`Circuit breaker ${this.name} has been reset`);
  }

  /**
   * Force open circuit (for testing/maintenance)
   */
  forceOpen(): void {
    this.openCircuit();
  }

  /**
   * Force close circuit (for testing/recovery)
   */
  forceClose(): void {
    this.state = "CLOSED";
    this.failures = 0;
    this.successes = 0;
    delete this.nextAttemptTime;
  }
}

/**
 * Circuit breaker manager for tool actions
 */
export class CircuitBreakerManager {
  private static instance: CircuitBreakerManager;
  private breakers = new Map<string, CircuitBreaker<any>>();

  private toolConfigs: Record<string, Partial<CircuitBreakerConfig>> = {
    slack: {
      failureThreshold: 3,
      timeout: 30000, // 30 seconds
      errorThresholdPercentage: 30,
    },
    discord: {
      failureThreshold: 3,
      timeout: 30000,
      errorThresholdPercentage: 30,
    },
    email: {
      failureThreshold: 5,
      timeout: 60000, // 1 minute
      errorThresholdPercentage: 40,
    },
    // More conservative for critical tools
    "google-sheets": {
      failureThreshold: 2,
      timeout: 120000, // 2 minutes
      errorThresholdPercentage: 20,
    },
  };

  private constructor() {}

  static getInstance(): CircuitBreakerManager {
    if (!CircuitBreakerManager.instance) {
      CircuitBreakerManager.instance = new CircuitBreakerManager();
    }
    return CircuitBreakerManager.instance;
  }

  /**
   * Get or create circuit breaker for a tool
   */
  getBreaker(toolId: number, toolType: string): CircuitBreaker<any> {
    const key = `${toolType}-${toolId}`;

    if (!this.breakers.has(key)) {
      const config = this.toolConfigs[toolType] || {};
      const breaker = new CircuitBreaker(key, config);
      this.breakers.set(key, breaker);
    }

    return this.breakers.get(key)!;
  }

  /**
   * Get all circuit breaker metrics
   */
  getAllMetrics(): Record<string, CircuitBreakerMetrics> {
    const metrics: Record<string, CircuitBreakerMetrics> = {};

    for (const [key, breaker] of this.breakers.entries()) {
      metrics[key] = breaker.getMetrics();
    }

    return metrics;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Reset specific tool's circuit breakers
   */
  resetTool(toolType: string): void {
    for (const [key, breaker] of this.breakers.entries()) {
      if (key.startsWith(`${toolType}-`)) {
        breaker.reset();
      }
    }
  }
}

// Export singleton instance
export const circuitBreakerManager = CircuitBreakerManager.getInstance();
