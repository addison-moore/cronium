"use client";

import React, { Component, type ReactNode, Suspense } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  retryCount: number;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (props: {
    error: Error;
    reset: () => void;
    retryCount: number;
  }) => ReactNode;
  maxRetries?: number;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

export class SuspenseErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Suspense Error Boundary caught:", error, errorInfo);
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  reset = () => {
    const { maxRetries = 3 } = this.props;
    const { retryCount } = this.state;

    if (retryCount < maxRetries) {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        retryCount: retryCount + 1,
      });
    }
  };

  render() {
    const { hasError, error, retryCount } = this.state;
    const { children, fallback, maxRetries = 3 } = this.props;

    if (hasError && error) {
      if (fallback) {
        return fallback({ error, reset: this.reset, retryCount });
      }

      return (
        <DefaultErrorFallback
          error={error}
          reset={this.reset}
          retryCount={retryCount}
          maxRetries={maxRetries}
        />
      );
    }

    return children;
  }
}

interface DefaultErrorFallbackProps {
  error: Error;
  reset: () => void;
  retryCount: number;
  maxRetries: number;
}

function DefaultErrorFallback({
  error,
  reset,
  retryCount,
  maxRetries,
}: DefaultErrorFallbackProps) {
  const canRetry = retryCount < maxRetries;

  return (
    <div className="flex min-h-[200px] items-center justify-center p-4">
      <Alert variant="destructive" className="max-w-md">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Loading Error</AlertTitle>
        <AlertDescription className="mt-2 space-y-2">
          <p>Failed to load this component. {error.message}</p>
          {canRetry ? (
            <p className="text-sm">
              Retry attempt {retryCount} of {maxRetries}
            </p>
          ) : (
            <p className="text-sm">
              Maximum retry attempts reached. Please refresh the page.
            </p>
          )}
        </AlertDescription>
        {canRetry && (
          <Button onClick={reset} variant="outline" size="sm" className="mt-4">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        )}
      </Alert>
    </div>
  );
}

// Helper component to wrap suspense with error boundary
interface SuspenseWithErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  errorFallback?: (props: {
    error: Error;
    reset: () => void;
    retryCount: number;
  }) => ReactNode;
  maxRetries?: number;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

export function SuspenseWithErrorBoundary({
  children,
  fallback,
  errorFallback,
  maxRetries,
  onError,
}: SuspenseWithErrorBoundaryProps) {
  return (
    <SuspenseErrorBoundary
      {...(errorFallback && { fallback: errorFallback })}
      {...(maxRetries !== undefined && { maxRetries })}
      {...(onError && { onError })}
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </SuspenseErrorBoundary>
  );
}
