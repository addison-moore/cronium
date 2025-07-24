"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import { Button } from "@cronium/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import Link from "next/link";

interface ErrorBoundaryCardProps {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
  showHomeButton?: boolean;
  lang?: string;
}

export function ErrorBoundaryCard({
  error,
  reset,
  title = "Something went wrong!",
  description = "An error occurred while loading this page. Please try again.",
  showHomeButton = false,
  lang = "en",
}: ErrorBoundaryCardProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="container mx-auto flex min-h-[400px] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="text-destructive h-5 w-5" />
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted rounded-md p-3">
            <p className="text-muted-foreground font-mono text-sm">
              {error.message ?? "An unexpected error occurred"}
            </p>
            {error.digest && (
              <p className="text-muted-foreground mt-1 text-xs">
                Error ID: {error.digest}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={reset} className="flex-1" variant="default">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
            {showHomeButton && (
              <Button asChild variant="outline" className="flex-1">
                <Link href={`/${lang}`}>
                  <Home className="mr-2 h-4 w-4" />
                  Go home
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
