"use client";

import { ErrorBoundaryCard } from "@/components/error/error-boundary-card";

export default function Error({
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
      title="Application Error"
      description="An unexpected error occurred. Please refresh the page or try again later."
      showHomeButton={true}
      lang="en"
    />
  );
}
