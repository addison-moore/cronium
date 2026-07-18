"use client";

import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./button";
import { cn } from "../lib/utils";

interface ErrorStateProps {
  title?: string;
  /** What went wrong, in user terms */
  message?: string;
  /** Optional retry handler; renders a Retry button when provided */
  onRetry?: () => void;
  retryLabel?: string;
  icon?: ReactNode;
  className?: string;
}

/**
 * Standard inline error state for failed data loads. Use this instead of
 * ad-hoc red paragraphs or silent toasts when a query fails; route-level
 * render errors are handled by ErrorBoundaryCard via error.tsx.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Retry",
  icon,
  className = "",
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 text-center",
        className,
      )}
    >
      <div className="text-destructive mb-4">
        {icon ?? <AlertTriangle className="h-10 w-10" />}
      </div>
      <h3 className="mb-2 text-lg font-medium">{title}</h3>
      {message && (
        <p className="text-muted-foreground mb-4 max-w-md text-sm">{message}</p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
