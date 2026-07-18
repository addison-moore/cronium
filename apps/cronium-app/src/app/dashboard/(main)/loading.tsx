import { PageShell, Skeleton, TableSkeleton } from "@cronium/ui";

export default function DashboardMainLoading() {
  return (
    <PageShell>
      {/* Page header: title + description + action button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* List container: filter row + table, matching the list pages */}
      <div className="border-border bg-secondary-bg space-y-4 rounded-lg border p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
        <TableSkeleton rows={6} columns={5} showActions />
      </div>
    </PageShell>
  );
}
