/**
 * Advanced retry strategies for tool actions
 */

export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors?: string[];
  nonRetryableErrors?: string[];
}

export interface RetryContext {
  attempt: number;
  error: Error;
  totalElapsed: number;
  lastDelay: number;
}

export type RetryDecision = {
  shouldRetry: boolean;
  delay: number;
  reason?: string;
};

/**
 * Base retry strategy
 */
export abstract class RetryStrategy {
  constructor(protected config: RetryConfig) {}

  abstract calculateDelay(context: RetryContext): number;

  getConfig(): RetryConfig {
    return this.config;
  }

  shouldRetry(context: RetryContext): RetryDecision {
    // Check max attempts
    if (context.attempt >= this.config.maxAttempts) {
      return { shouldRetry: false, delay: 0, reason: "Max attempts reached" };
    }

    // Check retryable errors
    const errorMessage = context.error.message.toLowerCase();

    // Check non-retryable errors first
    if (
      this.config.nonRetryableErrors?.some((err) =>
        errorMessage.includes(err.toLowerCase()),
      )
    ) {
      return { shouldRetry: false, delay: 0, reason: "Non-retryable error" };
    }

    // Check retryable errors if specified
    if (this.config.retryableErrors && this.config.retryableErrors.length > 0) {
      const isRetryable = this.config.retryableErrors.some((err) =>
        errorMessage.includes(err.toLowerCase()),
      );
      if (!isRetryable) {
        return {
          shouldRetry: false,
          delay: 0,
          reason: "Error not in retryable list",
        };
      }
    }

    const delay = this.calculateDelay(context);
    return { shouldRetry: true, delay };
  }

  protected addJitter(delay: number): number {
    if (!this.config.jitter) return delay;
    // Add random jitter between -20% and +20%
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
  }
}

/**
 * Exponential backoff strategy
 */
export class ExponentialBackoffStrategy extends RetryStrategy {
  calculateDelay(context: RetryContext): number {
    const baseDelay =
      this.config.initialDelay *
      Math.pow(this.config.backoffMultiplier, context.attempt - 1);
    const delay = Math.min(baseDelay, this.config.maxDelay);
    return this.addJitter(delay);
  }
}

/**
 * Linear backoff strategy
 */
export class LinearBackoffStrategy extends RetryStrategy {
  calculateDelay(context: RetryContext): number {
    const delay = Math.min(
      this.config.initialDelay * context.attempt,
      this.config.maxDelay,
    );
    return this.addJitter(delay);
  }
}

/**
 * Fixed delay strategy
 */
export class FixedDelayStrategy extends RetryStrategy {
  calculateDelay(_context: RetryContext): number {
    return this.addJitter(this.config.initialDelay);
  }
}

/**
 * Fibonacci backoff strategy
 */
export class FibonacciBackoffStrategy extends RetryStrategy {
  private fibCache = new Map<number, number>();

  private fibonacci(n: number): number {
    if (n <= 1) return n;
    if (this.fibCache.has(n)) return this.fibCache.get(n)!;

    const result = this.fibonacci(n - 1) + this.fibonacci(n - 2);
    this.fibCache.set(n, result);
    return result;
  }

  calculateDelay(context: RetryContext): number {
    const fib = this.fibonacci(context.attempt + 2); // Start from F(3) = 2
    const delay = Math.min(
      this.config.initialDelay * fib,
      this.config.maxDelay,
    );
    return this.addJitter(delay);
  }
}

/**
 * Adaptive retry strategy that adjusts based on error patterns
 */
export class AdaptiveRetryStrategy extends RetryStrategy {
  private errorHistory: Map<string, { count: number; lastSeen: Date }> =
    new Map();

  calculateDelay(context: RetryContext): number {
    const errorType = this.classifyError(context.error);
    const history = this.errorHistory.get(errorType) || {
      count: 0,
      lastSeen: new Date(),
    };

    // Update history
    history.count++;
    history.lastSeen = new Date();
    this.errorHistory.set(errorType, history);

    // Adjust delay based on error frequency
    let multiplier = this.config.backoffMultiplier;
    if (history.count > 5) {
      multiplier *= 1.5; // Increase delay for frequent errors
    }

    const baseDelay =
      this.config.initialDelay * Math.pow(multiplier, context.attempt - 1);
    const delay = Math.min(baseDelay, this.config.maxDelay);
    return this.addJitter(delay);
  }

  private classifyError(error: Error): string {
    const message = error.message.toLowerCase();
    if (message.includes("rate limit")) return "rate_limit";
    if (message.includes("timeout")) return "timeout";
    if (message.includes("network")) return "network";
    if (message.includes("401") || message.includes("403")) return "auth";
    return "unknown";
  }
}

/**
 * Retry executor
 */
export class RetryExecutor<T> {
  constructor(
    private strategy: RetryStrategy,
    private onRetry?: (context: RetryContext) => void,
  ) {}

  async execute(
    fn: () => Promise<T>,
    context?: { actionId: string; toolId: number },
  ): Promise<T> {
    let lastError: Error | null = null;
    let totalElapsed = 0;
    let lastDelay = 0;

    for (
      let attempt = 1;
      attempt <= this.strategy.getConfig().maxAttempts;
      attempt++
    ) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const retryContext: RetryContext = {
          attempt,
          error: lastError,
          totalElapsed,
          lastDelay,
        };

        const decision = this.strategy.shouldRetry(retryContext);

        if (!decision.shouldRetry) {
          throw new Error(
            `Retry failed: ${decision.reason}. Original error: ${lastError.message}`,
          );
        }

        lastDelay = decision.delay;
        totalElapsed += lastDelay;

        // Call retry callback
        if (this.onRetry) {
          this.onRetry(retryContext);
        }

        // Log retry attempt
        console.log(
          `Retry attempt ${attempt} for ${context?.actionId || "unknown action"} ` +
            `after ${lastDelay}ms delay. Total elapsed: ${totalElapsed}ms`,
        );

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, lastDelay));
      }
    }

    throw lastError || new Error("Max retry attempts reached");
  }
}

/**
 * Default retry configurations
 */
export const defaultRetryConfigs = {
  standard: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    jitter: true,
    retryableErrors: ["timeout", "network", "econnrefused", "rate limit"],
    nonRetryableErrors: ["invalid credentials", "forbidden", "unauthorized"],
  },
  aggressive: {
    maxAttempts: 5,
    initialDelay: 500,
    maxDelay: 30000,
    backoffMultiplier: 1.5,
    jitter: true,
    retryableErrors: [
      "timeout",
      "network",
      "econnrefused",
      "rate limit",
      "503",
      "502",
    ],
  },
  conservative: {
    maxAttempts: 2,
    initialDelay: 2000,
    maxDelay: 5000,
    backoffMultiplier: 2,
    jitter: false,
    retryableErrors: ["timeout", "econnrefused"],
  },
} as const;

/**
 * Create retry executor with strategy
 */
export function createRetryExecutor<T>(
  strategyType:
    | "exponential"
    | "linear"
    | "fixed"
    | "fibonacci"
    | "adaptive" = "exponential",
  config: Partial<RetryConfig> = {},
  onRetry?: (context: RetryContext) => void,
): RetryExecutor<T> {
  const defaultConfig = defaultRetryConfigs.standard;
  const finalConfig: RetryConfig = {
    maxAttempts: config.maxAttempts ?? defaultConfig.maxAttempts,
    initialDelay: config.initialDelay ?? defaultConfig.initialDelay,
    maxDelay: config.maxDelay ?? defaultConfig.maxDelay,
    backoffMultiplier: config.backoffMultiplier ?? defaultConfig.backoffMultiplier,
    jitter: config.jitter ?? defaultConfig.jitter,
    retryableErrors: config.retryableErrors ?? [...defaultConfig.retryableErrors],
    nonRetryableErrors: config.nonRetryableErrors ?? (defaultConfig.nonRetryableErrors ? [...defaultConfig.nonRetryableErrors] : undefined),
  };

  let strategy: RetryStrategy;

  switch (strategyType) {
    case "linear":
      strategy = new LinearBackoffStrategy(finalConfig);
      break;
    case "fixed":
      strategy = new FixedDelayStrategy(finalConfig);
      break;
    case "fibonacci":
      strategy = new FibonacciBackoffStrategy(finalConfig);
      break;
    case "adaptive":
      strategy = new AdaptiveRetryStrategy(finalConfig);
      break;
    default:
      strategy = new ExponentialBackoffStrategy(finalConfig);
  }

  return new RetryExecutor<T>(strategy, onRetry);
}
