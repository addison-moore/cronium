"use client";

import { ErrorBoundaryCard } from "@/components/error/error-boundary-card";

export default function DocsError({
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
      title="Documentation Error"
      description="We couldn't load this documentation page. Please try refreshing or navigate back to the documentation home."
      showHomeButton={false}
    />
  );
}
