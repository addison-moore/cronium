import { Skeleton } from "@/components/ui/skeleton";

export default function DocsLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex gap-8">
        {/* Sidebar skeleton */}
        <aside className="hidden w-64 shrink-0 md:block">
          <nav className="sticky top-8 space-y-4">
            <div className="space-y-2">
              <Skeleton className="mb-3 h-5 w-32" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
            <div className="space-y-2">
              <Skeleton className="mb-3 h-5 w-24" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
            <div className="space-y-2">
              <Skeleton className="mb-3 h-5 w-28" />
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </nav>
        </aside>

        {/* Main content skeleton */}
        <main className="max-w-4xl flex-1">
          <article className="prose prose-gray dark:prose-invert max-w-none">
            {/* Page title */}
            <Skeleton className="mb-4 h-10 w-3/4" />

            {/* Breadcrumb */}
            <div className="mb-6 flex items-center gap-2">
              <Skeleton className="h-4 w-16" />
              <span className="text-muted-foreground">/</span>
              <Skeleton className="h-4 w-24" />
            </div>

            {/* Content sections */}
            <div className="space-y-8">
              {/* Section 1 */}
              <div className="space-y-4">
                <Skeleton className="h-7 w-48" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/5" />
                </div>
              </div>

              {/* Code block skeleton */}
              <div className="bg-muted rounded-lg p-4">
                <Skeleton className="mb-3 h-3 w-24" />
                <div className="space-y-1">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>

              {/* Section 2 */}
              <div className="space-y-4">
                <Skeleton className="h-7 w-64" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>

              {/* List skeleton */}
              <div className="space-y-2 pl-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Skeleton className="mt-1.5 h-1.5 w-1.5 rounded-full" />
                    <Skeleton className="h-4 w-full max-w-md" />
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation footer */}
            <div className="mt-12 flex items-center justify-between border-t pt-6">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-10 w-32" />
            </div>
          </article>
        </main>

        {/* Table of contents skeleton (right sidebar) */}
        <aside className="hidden w-48 shrink-0 xl:block">
          <div className="sticky top-8">
            <Skeleton className="mb-4 h-5 w-32" />
            <nav className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-3 w-full"
                  style={{ marginLeft: `${(i % 3) * 12}px` }}
                />
              ))}
            </nav>
          </div>
        </aside>
      </div>
    </div>
  );
}
