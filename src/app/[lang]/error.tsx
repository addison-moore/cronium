"use client";

import { ErrorBoundaryCard } from "@/components/error/error-boundary-card";

export default function RootError({
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
      title="Application Error"
      description="We encountered an error while loading the application. Please try again or return to the home page."
      showHomeButton={true}
      lang={params?.lang ?? "en"}
    />
  );
}
