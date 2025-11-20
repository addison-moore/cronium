"use client";

import { ErrorBoundaryCard } from "@/components/error/error-boundary-card";

export default function DashboardError({
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
      title="Dashboard Error"
      description="An error occurred while loading this dashboard page. Please try again."
      showHomeButton={false}
    />
  );
}
