"use client";

import { ErrorBoundaryCard } from "@/components/error/error-boundary-card";

export default function ToolsError({
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
      title="Tools Error"
      description="An error occurred while loading tools. Please check your configuration."
      showHomeButton={false}
      lang={params?.lang ?? "en"}
    />
  );
}
