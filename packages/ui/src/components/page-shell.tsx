import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface PageShellProps {
  children: ReactNode;
  /**
   * "default": centered container for standard pages.
   * "full": full-width for canvas-heavy pages (workflow editor, console).
   */
  width?: "default" | "full";
  className?: string;
}

/**
 * Standard page wrapper for dashboard pages: one container width and one
 * vertical rhythm everywhere. Page padding is owned by the dashboard layout's
 * <main> element — pages must not add their own.
 */
export function PageShell({
  children,
  width = "default",
  className,
}: PageShellProps) {
  return (
    <div
      className={cn(
        width === "default" ? "container mx-auto" : "w-full",
        "space-y-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
