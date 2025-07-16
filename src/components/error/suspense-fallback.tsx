import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

interface SuspenseFallbackProps {
  message?: string;
  showSkeleton?: boolean;
  className?: string;
}

export function SuspenseFallback({
  message = "Loading component...",
  showSkeleton = true,
  className = "",
}: SuspenseFallbackProps) {
  if (showSkeleton) {
    return (
      <div className={`space-y-4 ${className}`}>
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center p-4 ${className}`}>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}

export function SuspenseErrorFallback({
  error,
  retry,
}: {
  error?: Error;
  retry?: () => void;
}) {
  return (
    <Alert variant="destructive" className="m-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Failed to load</AlertTitle>
      <AlertDescription>
        {error?.message ??
          "This component failed to load. Please try refreshing the page."}
        {retry && (
          <button
            onClick={retry}
            className="ml-2 text-sm underline hover:no-underline"
          >
            Try again
          </button>
        )}
      </AlertDescription>
    </Alert>
  );
}
