"use client";

import React, {
  Suspense,
  type ReactNode,
  type ComponentType,
  Component,
  type ErrorInfo,
} from "react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Custom ErrorBoundary since react-error-boundary is not installed
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (props: FallbackProps) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface FallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo);
  }

  resetErrorBoundary = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return this.props.fallback({
        error: this.state.error,
        resetErrorBoundary: this.resetErrorBoundary,
      });
    }

    return this.props.children;
  }
}

// ============================================
// Loading Boundary Props
// ============================================

export interface LoadingBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  errorFallback?: ComponentType<FallbackProps> | ReactNode;
  onError?: (error: Error, errorInfo: { componentStack: string }) => void;
  className?: string;
  showSpinner?: boolean;
  suspenseKey?: string;
  minHeight?: string;
}

// ============================================
// Default Loading Fallback
// ============================================

export function DefaultLoadingFallback({
  showSpinner = true,
  minHeight = "200px",
  className,
}: {
  showSpinner?: boolean;
  minHeight?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex w-full items-center justify-center", className)}
      style={{ minHeight }}
    >
      {showSpinner && <Spinner size="lg" />}
    </div>
  );
}

// ============================================
// Default Error Fallback
// ============================================

export function DefaultErrorFallback({
  error,
  resetErrorBoundary,
}: FallbackProps) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center p-6 text-center">
      <AlertCircle className="text-destructive mb-4 h-12 w-12" />
      <h2 className="mb-2 text-lg font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground mb-4 max-w-md text-sm">
        {error instanceof Error
          ? error.message
          : "An unexpected error occurred while loading this content."}
      </p>
      <Button
        onClick={resetErrorBoundary as () => void}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}

// ============================================
// Loading Boundary Component
// ============================================

export function LoadingBoundary({
  children,
  fallback,
  errorFallback,
  onError,
  className,
  showSpinner = true,
  suspenseKey,
  minHeight = "200px",
}: LoadingBoundaryProps) {
  const loadingFallback = fallback ?? (
    <DefaultLoadingFallback
      showSpinner={showSpinner}
      minHeight={minHeight}
      {...(className ? { className } : {})}
    />
  );

  const ErrorFallbackComponent =
    typeof errorFallback === "function"
      ? errorFallback
      : errorFallback
        ? () => <>{errorFallback}</>
        : DefaultErrorFallback;

  return (
    <ErrorBoundary
      fallback={ErrorFallbackComponent as any}
      onError={onError as any}
    >
      <Suspense fallback={loadingFallback} key={suspenseKey}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

// ============================================
// Specialized Loading Boundaries
// ============================================

export function PageLoadingBoundary({
  children,
  ...props
}: Omit<LoadingBoundaryProps, "minHeight">) {
  return (
    <LoadingBoundary minHeight="400px" {...props}>
      {children}
    </LoadingBoundary>
  );
}

export function SectionLoadingBoundary({
  children,
  ...props
}: Omit<LoadingBoundaryProps, "minHeight">) {
  return (
    <LoadingBoundary minHeight="200px" {...props}>
      {children}
    </LoadingBoundary>
  );
}

export function InlineLoadingBoundary({
  children,
  ...props
}: Omit<LoadingBoundaryProps, "minHeight" | "showSpinner">) {
  return (
    <LoadingBoundary
      minHeight="auto"
      showSpinner={false}
      fallback={<span className="text-muted-foreground">Loading...</span>}
      {...props}
    >
      {children}
    </LoadingBoundary>
  );
}

// ============================================
// Loading Boundary with Retry
// ============================================

export interface RetryableLoadingBoundaryProps extends LoadingBoundaryProps {
  maxRetries?: number;
  retryDelay?: number;
  onRetry?: () => void;
}

export function RetryableLoadingBoundary({
  children,
  maxRetries = 3,
  retryDelay = 1000,
  onRetry,
  ...props
}: RetryableLoadingBoundaryProps) {
  const [retryCount, setRetryCount] = React.useState(0);
  const [key, setKey] = React.useState(0);

  const handleError = React.useCallback(
    (error: Error, errorInfo: { componentStack: string }) => {
      if (retryCount < maxRetries) {
        setTimeout(() => {
          setRetryCount((prev) => prev + 1);
          setKey((prev) => prev + 1);
          onRetry?.();
        }, retryDelay);
      }
      props.onError?.(error, errorInfo);
    },
    [retryCount, maxRetries, retryDelay, onRetry, props],
  );

  const errorFallback = React.useCallback(
    ({ error, resetErrorBoundary }: FallbackProps) => {
      return (
        <div className="flex min-h-[200px] flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="text-destructive mb-4 h-12 w-12" />
          <h2 className="mb-2 text-lg font-semibold">Something went wrong</h2>
          <p className="text-muted-foreground mb-4 max-w-md text-sm">
            {error instanceof Error
              ? error.message
              : "An unexpected error occurred while loading this content."}
          </p>
          {retryCount < maxRetries ? (
            <p className="text-muted-foreground mb-4 text-xs">
              Retrying... ({retryCount + 1}/{maxRetries})
            </p>
          ) : (
            <Button
              onClick={() => {
                setRetryCount(0);
                (resetErrorBoundary as () => void)();
              }}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          )}
        </div>
      );
    },
    [retryCount, maxRetries],
  );

  return (
    <LoadingBoundary
      {...props}
      suspenseKey={key.toString()}
      onError={handleError}
      errorFallback={errorFallback}
    >
      {children}
    </LoadingBoundary>
  );
}

// ============================================
// Lazy Loading Boundary
// ============================================

export interface LazyLoadingBoundaryProps<T>
  extends Omit<LoadingBoundaryProps, "children"> {
  loader: () => Promise<{ default: ComponentType<T> }>;
  props?: T;
}

export function LazyLoadingBoundary<T = unknown>({
  loader,
  props,
  ...boundaryProps
}: LazyLoadingBoundaryProps<T>) {
  const LazyComponent = React.lazy(loader);

  return (
    <LoadingBoundary {...boundaryProps}>
      <LazyComponent {...(props as any)} />
    </LoadingBoundary>
  );
}

// ============================================
// Deferred Loading Boundary
// ============================================

export interface DeferredLoadingBoundaryProps extends LoadingBoundaryProps {
  delay?: number;
}

export function DeferredLoadingBoundary({
  children,
  delay = 200,
  fallback,
  ...props
}: DeferredLoadingBoundaryProps) {
  const [showFallback, setShowFallback] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setShowFallback(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [delay]);

  const deferredFallback = showFallback ? (
    fallback
  ) : (
    <div style={{ minHeight: props.minHeight }} />
  );

  return (
    <LoadingBoundary {...props} fallback={deferredFallback}>
      {children}
    </LoadingBoundary>
  );
}
