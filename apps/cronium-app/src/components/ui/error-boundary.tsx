"use client";

import React, { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@cronium/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import { logError, ErrorSeverity } from "@/lib/error-handler";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  resetKeys?: Array<string | number>;
  resetOnPropsChange?: boolean;
  isolate?: boolean;
  componentName?: string;
}

interface State {
  hasError: boolean;
  error?: Error | undefined;
  errorInfo?: React.ErrorInfo | undefined;
}

export class ErrorBoundary extends Component<Props, State> {
  private resetKeys: Array<string | number>;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
    this.resetKeys = props.resetKeys ?? [];
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const { onError, componentName } = this.props;

    // Log error with context
    logError(error, ErrorSeverity.ERROR, {
      component: componentName ?? "ErrorBoundary",
      operation: "componentDidCatch",
      metadata: {
        componentStack: errorInfo.componentStack,
        errorBoundary: true,
      },
    });

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }

    this.setState({ errorInfo });
  }

  componentDidUpdate(prevProps: Props) {
    const { resetKeys, resetOnPropsChange } = this.props;
    const { hasError } = this.state;

    if (hasError && prevProps.resetKeys !== resetKeys) {
      const hasResetKeyChanged = resetKeys?.some(
        (key, index) => key !== prevProps.resetKeys?.[index],
      );

      if (hasResetKeyChanged || resetOnPropsChange) {
        this.resetError();
      }
    }
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    const { hasError, error } = this.state;
    const { children, fallback, isolate } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return <>{fallback}</>;
      }

      // Default error UI
      return (
        <div
          className={`flex items-center justify-center ${
            isolate ? "" : "min-h-[400px]"
          } p-4`}
        >
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="text-destructive h-5 w-5" />
                <CardTitle>Something went wrong</CardTitle>
              </div>
              <CardDescription>
                {error?.message ?? "An unexpected error occurred"}
              </CardDescription>
            </CardHeader>
            {process.env.NODE_ENV === "development" && error?.stack && (
              <CardContent>
                <details className="mt-2">
                  <summary className="text-muted-foreground cursor-pointer text-sm">
                    Error details
                  </summary>
                  <pre className="bg-muted mt-2 overflow-auto rounded-md p-2 text-xs">
                    {error.stack}
                  </pre>
                </details>
              </CardContent>
            )}
            <CardFooter className="flex gap-2">
              <Button onClick={this.resetError} variant="default" size="sm">
                Try again
              </Button>
              <Button
                onClick={() => window.location.reload()}
                variant="outline"
                size="sm"
              >
                Reload page
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return children;
  }
}

/**
 * Hook to wrap async operations with error boundary support
 */
export function useErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);

  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  const captureError = React.useCallback((error: Error) => {
    setError(error);
    logError(error, ErrorSeverity.ERROR, {
      component: "useErrorHandler",
      operation: "captureError",
    });
  }, []);

  // Throw error to be caught by error boundary
  if (error) {
    throw error;
  }

  return { captureError, resetError };
}

/**
 * Wrap a component with an error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, "children">,
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary
      {...errorBoundaryProps}
      componentName={Component.displayName ?? Component.name}
    >
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${
    Component.displayName ?? Component.name
  })`;

  return WrappedComponent;
}
