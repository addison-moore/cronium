"use client";

import { ErrorBoundaryCard } from "@/components/error/error-boundary-card";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorBoundaryCard
      error={error}
      reset={reset}
      title="Authentication Error"
      description="There was a problem with authentication. Please try again or contact support if the issue persists."
      showHomeButton={true}
    />
  );
}
