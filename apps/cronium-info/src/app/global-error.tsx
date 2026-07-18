"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center">
          <div className="text-center">
            <h2 className="mb-4 text-2xl font-bold">Something went wrong!</h2>
            <p className="text-muted-foreground mb-4">
              {error.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={() => reset()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
