"use client";

import { ErrorBoundaryCard } from "@/components/error/error-boundary-card";

export default function DashboardRootError({
  error,
  reset,
  params,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  params?: { lang?: string };
}) {
  return (
    <ErrorBoundaryCard
      error={error}
      reset={reset}
      title="Dashboard Error"
      description="An error occurred in the dashboard. Please try refreshing the page or contact support if the problem continues."
      showHomeButton={false}
      lang={params?.lang ?? "en"}
    />
  );
}
