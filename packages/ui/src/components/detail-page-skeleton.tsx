import { Skeleton } from "./skeleton";
import { Card, CardContent, CardHeader } from "./card";
import { PageShell } from "./page-shell";

interface DetailPageSkeletonProps {
  /** Show the two-column (content + sidebar) layout used by most detail pages */
  withSidebar?: boolean;
  /** Show a tab bar between the header and the content */
  withTabs?: boolean;
  /**
   * "default": content cards. "canvas": one tall block, matching
   * canvas/graph-heavy pages like the workflow detail view.
   */
  variant?: "default" | "canvas";
}

/**
 * Loading skeleton for detail/edit pages: page header (back link, title,
 * actions) plus content mirroring the standard detail layouts so the real
 * content swaps in without layout shift.
 */
export function DetailPageSkeleton({
  withSidebar = true,
  withTabs = false,
  variant = "default",
}: DetailPageSkeletonProps) {
  return (
    <PageShell>
      {/* Header: back link, title + description, actions */}
      <div>
        <Skeleton className="mb-3 h-4 w-32" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      {withTabs && (
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      )}

      {/* Content */}
      {variant === "canvas" ? (
        <Card>
          <CardContent className="p-4">
            <Skeleton className="h-[28rem] w-full" />
          </CardContent>
        </Card>
      ) : (
        <div
          className={
            withSidebar
              ? "grid gap-6 md:grid-cols-3"
              : "grid gap-6 md:grid-cols-1"
          }
        >
          <Card className={withSidebar ? "md:col-span-2" : ""}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
          {withSidebar && (
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-28" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PageShell>
  );
}
