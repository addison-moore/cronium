"use client";

import React, { useState, useEffect, useCallback, type ReactNode } from "react";
import { AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@cronium/ui";
import { Alert, AlertDescription, AlertTitle } from "@cronium/ui";
import { cn } from "@/lib/utils";

interface StreamRetryWrapperProps {
  children: ReactNode;
  onRetry?: () => void | Promise<void>;
  maxRetries?: number;
  retryDelay?: number;
  className?: string;
  showRetryCount?: boolean;
}

interface StreamState {
  isLoading: boolean;
  hasError: boolean;
  error: Error | null;
  retryCount: number;
  isRetrying: boolean;
}

export function StreamRetryWrapper({
  children,
  onRetry,
  maxRetries = 3,
  retryDelay = 1000,
  className,
  showRetryCount = true,
}: StreamRetryWrapperProps) {
  const [state, setState] = useState<StreamState>({
    isLoading: false,
    hasError: false,
    error: null,
    retryCount: 0,
    isRetrying: false,
  });

  const handleRetry = useCallback(async () => {
    const { retryCount } = state;

    if (retryCount >= maxRetries) {
      return;
    }

    setState((prev) => ({
      ...prev,
      isRetrying: true,
      hasError: false,
      error: null,
    }));

    // Add delay before retry
    await new Promise((resolve) => setTimeout(resolve, retryDelay));

    try {
      if (onRetry) {
        await onRetry();
      }

      setState((prev) => ({
        ...prev,
        isRetrying: false,
        retryCount: prev.retryCount + 1,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isRetrying: false,
        hasError: true,
        error: error as Error,
        retryCount: prev.retryCount + 1,
      }));
    }
  }, [state, maxRetries, retryDelay, onRetry]);

  // Auto-retry on error if within retry limit
  useEffect(() => {
    if (state.hasError && state.retryCount < maxRetries && !state.isRetrying) {
      const timer = setTimeout(() => {
        void handleRetry();
      }, retryDelay);

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [
    state.hasError,
    state.retryCount,
    state.isRetrying,
    maxRetries,
    retryDelay,
    handleRetry,
  ]);

  if (state.hasError && state.retryCount >= maxRetries) {
    return (
      <div className={cn("w-full", className)}>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Stream Loading Failed</AlertTitle>
          <AlertDescription className="mt-2">
            <p>
              {state.error?.message ??
                "Failed to load streaming content after multiple attempts."}
            </p>
            {showRetryCount && (
              <p className="mt-1 text-sm opacity-80">
                Failed after {maxRetries} attempts
              </p>
            )}
            <Button
              onClick={() => {
                setState({
                  isLoading: false,
                  hasError: false,
                  error: null,
                  retryCount: 0,
                  isRetrying: false,
                });
                void handleRetry();
              }}
              variant="outline"
              size="sm"
              className="mt-3"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (state.isRetrying) {
    return (
      <div className={cn("flex items-center justify-center p-4", className)}>
        <div className="text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            Retrying...{" "}
            {showRetryCount && `(${state.retryCount + 1}/${maxRetries})`}
          </span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// Hook for manual stream error handling
export function useStreamRetry(maxRetries = 3, retryDelay = 1000) {
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

  const retry = useCallback(
    async (fn: () => Promise<void>) => {
      if (retryCount >= maxRetries) {
        throw new Error(`Maximum retry attempts (${maxRetries}) exceeded`);
      }

      setIsRetrying(true);

      try {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        await fn();
        setRetryCount(0);
        setIsRetrying(false);
      } catch (error) {
        setRetryCount((prev) => prev + 1);
        setIsRetrying(false);
        throw error;
      }
    },
    [retryCount, maxRetries, retryDelay],
  );

  const reset = useCallback(() => {
    setRetryCount(0);
    setIsRetrying(false);
  }, []);

  return {
    retry,
    reset,
    retryCount,
    isRetrying,
    canRetry: retryCount < maxRetries,
  };
}
