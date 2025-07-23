"use client";

import { ErrorBoundaryCard } from "@/components/error/error-boundary-card";

export default function AdminError({
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
      title="Admin Error"
      description="An error occurred in the admin section. This might be a permissions issue."
      showHomeButton={false}
      lang={params?.lang ?? "en"}
    />
  );
}
