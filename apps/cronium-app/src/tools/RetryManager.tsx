"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Alert, AlertDescription } from "@cronium/ui";
import { Switch } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Slider } from "@cronium/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cronium/ui";
import { cn } from "@/lib/utils";
import {
  Activity,
  Clock,
  Info,
  RefreshCw,
  Settings,
  TrendingUp,
  Zap,
  Timer,
} from "lucide-react";

export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number; // in ms
  maxDelay: number; // in ms
  backoffMultiplier: number;
  strategy: "fixed" | "linear" | "exponential" | "fibonacci";
  jitter: boolean;
  jitterFactor: number; // 0-1, percentage of delay to randomize
  retryableErrors?: string[]; // Error codes that should trigger retry
  nonRetryableErrors?: string[]; // Error codes that should not retry
  onRetryAttempt?: (attempt: number, delay: number) => void;
  onSuccess?: (attempt: number) => void;
  onFailure?: (error: Error, attempts: number) => void;
}

export interface RetryState {
  attempts: number;
  isRetrying: boolean;
  lastError?: Error;
  nextRetryAt?: Date;
  history: RetryAttempt[];
}

interface RetryAttempt {
  attempt: number;
  timestamp: Date;
  delay: number;
  success: boolean;
  error?: string;
  duration?: number;
}

export interface RetryManagerProps {
  config?: Partial<RetryConfig>;
  onConfigChange?: (config: RetryConfig) => void;
  showConfig?: boolean;
  className?: string;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  strategy: "exponential",
  jitter: true,
  jitterFactor: 0.1,
};

// Retry strategies
const RETRY_STRATEGIES = {
  fixed: (attempt: number, config: RetryConfig) => config.initialDelay,
  linear: (attempt: number, config: RetryConfig) =>
    Math.min(config.initialDelay * attempt, config.maxDelay),
  exponential: (attempt: number, config: RetryConfig) =>
    Math.min(
      config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1),
      config.maxDelay,
    ),
  fibonacci: (attempt: number, config: RetryConfig) => {
    const fib = (n: number): number => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
    return Math.min(config.initialDelay * fib(attempt), config.maxDelay);
  },
};

export function useRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): {
  execute: () => Promise<T>;
  state: RetryState;
  reset: () => void;
  pause: () => void;
  resume: () => void;
} {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const [state, setState] = useState<RetryState>({
    attempts: 0,
    isRetrying: false,
    history: [],
  });
  const [isPaused, setIsPaused] = useState(false);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  // Calculate delay with jitter
  const calculateDelay = useCallback(
    (attempt: number): number => {
      const baseDelay = RETRY_STRATEGIES[mergedConfig.strategy](
        attempt,
        mergedConfig,
      );

      if (mergedConfig.jitter) {
        const jitterAmount = baseDelay * mergedConfig.jitterFactor;
        const jitter = (Math.random() - 0.5) * 2 * jitterAmount;
        return Math.max(0, baseDelay + jitter);
      }

      return baseDelay;
    },
    [mergedConfig],
  );

  // Check if error is retryable
  const isRetryable = useCallback(
    (error: Error): boolean => {
      const errorCode =
        "code" in error && typeof error.code === "string"
          ? error.code
          : error.message;

      if (mergedConfig.nonRetryableErrors?.includes(errorCode)) {
        return false;
      }

      if (
        mergedConfig.retryableErrors &&
        mergedConfig.retryableErrors.length > 0
      ) {
        return mergedConfig.retryableErrors.includes(errorCode);
      }

      return true;
    },
    [mergedConfig],
  );

  // Execute with retry logic
  const execute = useCallback(async (): Promise<T> => {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= mergedConfig.maxAttempts; attempt++) {
      if (isPaused) {
        throw new Error("Retry paused by user");
      }

      setState((prev) => ({
        ...prev,
        attempts: attempt,
        isRetrying: attempt > 1,
      }));

      try {
        const result = await fn();
        const duration = Date.now() - startTime;

        setState((prev) => ({
          attempts: prev.attempts,
          isRetrying: false,
          history: [
            ...prev.history,
            {
              attempt,
              timestamp: new Date(),
              delay: attempt > 1 ? calculateDelay(attempt - 1) : 0,
              success: true,
              duration,
            },
          ],
        }));

        mergedConfig.onSuccess?.(attempt);
        return result;
      } catch (error) {
        lastError = error as Error;
        const duration = Date.now() - startTime;

        setState((prev) => ({
          ...prev,
          lastError: error as Error,
          history: [
            ...prev.history,
            {
              attempt,
              timestamp: new Date(),
              delay: attempt > 1 ? calculateDelay(attempt - 1) : 0,
              success: false,
              error: (error as Error).message,
              duration,
            },
          ],
        }));

        if (
          !isRetryable(error as Error) ||
          attempt === mergedConfig.maxAttempts
        ) {
          setState((prev) => ({ ...prev, isRetrying: false }));
          mergedConfig.onFailure?.(error as Error, attempt);
          throw error;
        }

        if (attempt < mergedConfig.maxAttempts) {
          const delay = calculateDelay(attempt);
          const nextRetryAt = new Date(Date.now() + delay);

          setState((prev) => ({ ...prev, nextRetryAt }));
          mergedConfig.onRetryAttempt?.(attempt + 1, delay);

          await new Promise<void>((resolve) => {
            const id = setTimeout(resolve, delay);
            setTimeoutId(id);
          });

          setTimeoutId(null);
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error("Unexpected retry state");
  }, [fn, mergedConfig, isPaused, calculateDelay, isRetryable]);

  // Reset state
  const reset = useCallback(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
    setState({
      attempts: 0,
      isRetrying: false,
      history: [],
    });
    setIsPaused(false);
  }, [timeoutId]);

  // Pause retrying
  const pause = useCallback(() => {
    setIsPaused(true);
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
  }, [timeoutId]);

  // Resume retrying
  const resume = useCallback(() => {
    setIsPaused(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [timeoutId]);

  return { execute, state, reset, pause, resume };
}

export default function RetryManager({
  config: initialConfig,
  onConfigChange,
  showConfig = true,
  className,
}: RetryManagerProps) {
  const [config, setConfig] = useState<RetryConfig>({
    ...DEFAULT_CONFIG,
    ...initialConfig,
  });

  // Update config
  const updateConfig = (updates: Partial<RetryConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    onConfigChange?.(newConfig);
  };

  // Calculate example delays
  const getExampleDelays = () => {
    const delays = [];
    for (let i = 1; i <= Math.min(5, config.maxAttempts); i++) {
      delays.push(RETRY_STRATEGIES[config.strategy](i, config));
    }
    return delays;
  };

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Retry Configuration
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {showConfig && (
          <>
            {/* Strategy Selection */}
            <div className="space-y-2">
              <Label htmlFor="strategy">Retry Strategy</Label>
              <Select
                value={config.strategy}
                onValueChange={(value) =>
                  updateConfig({ strategy: value as RetryConfig["strategy"] })
                }
              >
                <SelectTrigger id="strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">
                    <div className="flex items-center gap-2">
                      <Timer className="h-4 w-4" />
                      Fixed Delay
                    </div>
                  </SelectItem>
                  <SelectItem value="linear">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Linear Backoff
                    </div>
                  </SelectItem>
                  <SelectItem value="exponential">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4" />
                      Exponential Backoff
                    </div>
                  </SelectItem>
                  <SelectItem value="fibonacci">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      Fibonacci Backoff
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Max Attempts */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="maxAttempts">Max Attempts</Label>
                <span className="text-muted-foreground text-sm">
                  {config.maxAttempts}
                </span>
              </div>
              <Slider
                id="maxAttempts"
                min={1}
                max={10}
                step={1}
                value={[config.maxAttempts]}
                onValueChange={([value]) => {
                  if (value !== undefined) {
                    updateConfig({ maxAttempts: value });
                  }
                }}
              />
            </div>

            {/* Initial Delay */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="initialDelay">Initial Delay</Label>
                <span className="text-muted-foreground text-sm">
                  {config.initialDelay}ms
                </span>
              </div>
              <Slider
                id="initialDelay"
                min={100}
                max={5000}
                step={100}
                value={[config.initialDelay]}
                onValueChange={([value]) => {
                  if (value !== undefined) {
                    updateConfig({ initialDelay: value });
                  }
                }}
              />
            </div>

            {/* Max Delay */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="maxDelay">Max Delay</Label>
                <span className="text-muted-foreground text-sm">
                  {config.maxDelay}ms
                </span>
              </div>
              <Slider
                id="maxDelay"
                min={1000}
                max={60000}
                step={1000}
                value={[config.maxDelay]}
                onValueChange={([value]) => {
                  if (value !== undefined) {
                    updateConfig({ maxDelay: value });
                  }
                }}
              />
            </div>

            {/* Backoff Multiplier (for exponential) */}
            {config.strategy === "exponential" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="backoffMultiplier">Backoff Multiplier</Label>
                  <span className="text-muted-foreground text-sm">
                    {config.backoffMultiplier}x
                  </span>
                </div>
                <Slider
                  id="backoffMultiplier"
                  min={1.5}
                  max={3}
                  step={0.1}
                  value={[config.backoffMultiplier]}
                  onValueChange={([value]) => {
                    if (value !== undefined) {
                      updateConfig({ backoffMultiplier: value });
                    }
                  }}
                />
              </div>
            )}

            {/* Jitter */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="jitter">Add Jitter</Label>
                <p className="text-muted-foreground text-xs">
                  Randomize delays to prevent thundering herd
                </p>
              </div>
              <Switch
                id="jitter"
                checked={config.jitter}
                onCheckedChange={(checked) => updateConfig({ jitter: checked })}
              />
            </div>

            {/* Jitter Factor */}
            {config.jitter && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="jitterFactor">Jitter Factor</Label>
                  <span className="text-muted-foreground text-sm">
                    ±{Math.round(config.jitterFactor * 100)}%
                  </span>
                </div>
                <Slider
                  id="jitterFactor"
                  min={0}
                  max={0.5}
                  step={0.05}
                  value={[config.jitterFactor]}
                  onValueChange={([value]) => {
                    if (value !== undefined) {
                      updateConfig({ jitterFactor: value });
                    }
                  }}
                />
              </div>
            )}

            {/* Delay Preview */}
            <div className="bg-muted/50 border-border rounded-lg border p-4">
              <h4 className="mb-3 text-sm font-medium">Delay Preview</h4>
              <div className="space-y-2">
                {getExampleDelays().map((delay, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">
                      Attempt {idx + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <Clock className="text-muted-foreground h-3 w-3" />
                      <span className="font-medium">
                        {(delay / 1000).toFixed(1)}s
                      </span>
                      {config.jitter && (
                        <span className="text-muted-foreground text-xs">
                          (±{((delay * config.jitterFactor) / 1000).toFixed(1)}
                          s)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {config.maxAttempts > 5 && (
                  <p className="text-muted-foreground text-xs">
                    ... and {config.maxAttempts - 5} more attempts
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {/* Preset Configurations */}
        <div className="space-y-2">
          <Label>Preset Configurations</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                updateConfig({
                  maxAttempts: 3,
                  initialDelay: 1000,
                  maxDelay: 5000,
                  strategy: "fixed",
                  jitter: false,
                })
              }
            >
              <Settings className="mr-2 h-4 w-4" />
              Conservative
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                updateConfig({
                  maxAttempts: 5,
                  initialDelay: 1000,
                  maxDelay: 30000,
                  strategy: "exponential",
                  backoffMultiplier: 2,
                  jitter: true,
                  jitterFactor: 0.1,
                })
              }
            >
              <Activity className="mr-2 h-4 w-4" />
              Balanced
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                updateConfig({
                  maxAttempts: 10,
                  initialDelay: 500,
                  maxDelay: 60000,
                  strategy: "exponential",
                  backoffMultiplier: 1.5,
                  jitter: true,
                  jitterFactor: 0.2,
                })
              }
            >
              <Zap className="mr-2 h-4 w-4" />
              Aggressive
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                updateConfig({
                  maxAttempts: 7,
                  initialDelay: 1000,
                  maxDelay: 30000,
                  strategy: "fibonacci",
                  jitter: true,
                  jitterFactor: 0.15,
                })
              }
            >
              <TrendingUp className="mr-2 h-4 w-4" />
              Adaptive
            </Button>
          </div>
        </div>

        {/* Info Alert */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Retry configuration helps handle transient failures automatically.
            Choose a strategy based on your use case and the service's rate
            limits.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
