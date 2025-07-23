"use client";

import { ErrorBoundaryCard } from "@/components/error/error-boundary-card";

export default function AuthError({
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
      title="Authentication Error"
      description="There was a problem with authentication. Please try again or contact support if the issue persists."
      showHomeButton={true}
      lang={params?.lang ?? "en"}
    />
  );
}
