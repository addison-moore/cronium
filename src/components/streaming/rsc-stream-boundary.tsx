import React, { Suspense, type ReactNode } from "react";
import { ErrorBoundaryCard } from "@/components/error/error-boundary-card";
import { SuspenseErrorBoundary } from "@/components/error/suspense-error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface RSCStreamBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  errorTitle?: string;
  errorDescription?: string;
  maxRetries?: number;
  showHomeButton?: boolean;
  lang?: string;
}

// Default streaming fallback
function StreamingFallback() {
  return (
    <div className="animate-pulse space-y-4">
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/6" />
    </div>
  );
}

// Error fallback for streaming failures
function StreamErrorFallback({
  error,
  reset,
  retryCount,
  title = "Streaming Error",
  description = "Failed to load this section. The server might be experiencing issues.",
}: {
  error: Error;
  reset: () => void;
  retryCount: number;
  title?: string;
  description?: string;
}) {
  return (
    <Alert variant="destructive" className="my-4">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>
        <div className="space-y-2">
          <p className="font-medium">{title}</p>
          <p className="text-sm">{description}</p>
          {error.message && (
            <p className="bg-destructive/10 rounded p-2 font-mono text-xs">
              {error.message}
            </p>
          )}
          <button
            onClick={reset}
            className="text-sm underline hover:no-underline"
          >
            Try loading again (Attempt {retryCount + 1})
          </button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// Main RSC Stream Boundary component
export function RSCStreamBoundary({
  children,
  fallback,
  errorTitle,
  errorDescription,
  maxRetries = 3,
  showHomeButton: _showHomeButton = false,
  lang: _lang = "en",
}: RSCStreamBoundaryProps) {
  return (
    <SuspenseErrorBoundary
      maxRetries={maxRetries}
      fallback={({ error, reset, retryCount }) => (
        <StreamErrorFallback
          error={error}
          reset={reset}
          retryCount={retryCount}
          title={errorTitle}
          description={errorDescription}
        />
      )}
      onError={(error, errorInfo) => {
        console.error("RSC Stream Error:", error, errorInfo);
      }}
    >
      <Suspense fallback={fallback ?? <StreamingFallback />}>
        {children}
      </Suspense>
    </SuspenseErrorBoundary>
  );
}

// Specialized boundaries for different content types
export function DataTableStreamBoundary({ children }: { children: ReactNode }) {
  return (
    <RSCStreamBoundary
      fallback={
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      }
      errorTitle="Failed to load data"
      errorDescription="The table data couldn't be loaded. Please check your connection and try again."
    >
      {children}
    </RSCStreamBoundary>
  );
}

export function ChartStreamBoundary({ children }: { children: ReactNode }) {
  return (
    <RSCStreamBoundary
      fallback={
        <div className="h-[300px] w-full">
          <Skeleton className="h-full w-full" />
        </div>
      }
      errorTitle="Chart Loading Error"
      errorDescription="Unable to load chart data. The visualization will appear once the connection is restored."
    >
      {children}
    </RSCStreamBoundary>
  );
}

export function ContentStreamBoundary({ children }: { children: ReactNode }) {
  return (
    <RSCStreamBoundary
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      }
      errorTitle="Content Loading Error"
      errorDescription="This content couldn't be loaded. It might be temporarily unavailable."
    >
      {children}
    </RSCStreamBoundary>
  );
}
