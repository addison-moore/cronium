"use client";

import { Inter } from "next/font/google";
import { ErrorBoundaryCard } from "@/components/error/error-boundary-card";

const inter = Inter({ subsets: ["latin"] });

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html className={inter.className}>
      <head>
        <title>Error - Cronium</title>
      </head>
      <body>
        <div className="flex min-h-screen items-center justify-center p-4">
          <ErrorBoundaryCard
            error={error}
            reset={reset}
            title="Critical Application Error"
            description="A critical error has occurred. This may be due to a system issue or an unexpected problem. Please try refreshing the page or contact support if the issue persists."
            showHomeButton={true}
            lang="en"
          />
        </div>
      </body>
    </html>
  );
}
