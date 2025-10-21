import { Skeleton } from "@cronium/ui";

export interface TableSkeletonProps {
  /**
   * Number of rows to display
   * @default 10
   */
  rows?: number;
  /**
   * Number of columns to display
   * @default 5
   */
  columns?: number;
  /**
   * Whether to show header
   * @default true
   */
  showHeader?: boolean;
  /**
   * Whether to show checkbox column
   * @default false
   */
  showCheckbox?: boolean;
  /**
   * Whether to show actions column
   * @default false
   */
  showActions?: boolean;
}

export function TableSkeleton({
  rows = 10,
  columns = 5,
  showHeader = true,
  showCheckbox = false,
  showActions = false,
}: TableSkeletonProps) {
  // const totalColumns = columns + (showCheckbox ? 1 : 0) + (showActions ? 1 : 0);

  return (
    <div className="w-full">
      <div className="border-border rounded-md border">
        {showHeader && (
          <div className="border-border bg-muted/50 border-b">
            <div className="flex items-center p-4">
              {showCheckbox && (
                <div className="mr-4">
                  <Skeleton className="h-4 w-4" />
                </div>
              )}
              {Array.from({ length: columns }).map((_, i) => (
                <div key={i} className="flex-1 px-2">
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
              {showActions && (
                <div className="w-24 px-2">
                  <Skeleton className="h-4 w-16" />
                </div>
              )}
            </div>
          </div>
        )}
        <div>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="border-border flex items-center border-b p-4 last:border-b-0"
            >
              {showCheckbox && (
                <div className="mr-4">
                  <Skeleton className="h-4 w-4" />
                </div>
              )}
              {Array.from({ length: columns }).map((_, colIndex) => (
                <div key={colIndex} className="flex-1 px-2">
                  <Skeleton className="h-4 w-full max-w-[200px]" />
                </div>
              ))}
              {showActions && (
                <div className="flex w-24 items-center justify-end gap-2 px-2">
                  <Skeleton className="h-8 w-8" />
                  <Skeleton className="h-8 w-8" />
                  <Skeleton className="h-8 w-8" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EventsTableSkeleton() {
  return (
    <div className="mt-6">
      <div className="bg-secondary-bg border-border rounded-lg border p-4">
        {/* Filters skeleton */}
        <div className="mb-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {/* Search input */}
            <Skeleton className="h-9 w-64" />
            {/* Filter dropdowns */}
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-32" />
            ))}
          </div>
        </div>

        {/* Table skeleton */}
        <TableSkeleton
          rows={10}
          columns={6}
          showCheckbox={true}
          showActions={true}
        />

        {/* Pagination skeleton */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">
              Items per page:
            </span>
            <Skeleton className="h-9 w-20" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-9" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkflowsTableSkeleton() {
  return (
    <div className="mt-6">
      <div className="bg-secondary-bg border-border rounded-lg border p-4">
        {/* Filters */}
        <div className="mb-4">
          <Skeleton className="h-9 w-64" />
        </div>

        {/* Table */}
        <TableSkeleton
          rows={10}
          columns={5}
          showCheckbox={false}
          showActions={true}
        />

        {/* Pagination */}
        <div className="mt-4 flex justify-end">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-9" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ServersTableSkeleton() {
  return (
    <div className="mt-6">
      <div className="bg-secondary-bg border-border rounded-lg border p-4">
        {/* Search */}
        <div className="mb-4">
          <Skeleton className="h-9 w-64" />
        </div>

        {/* Table */}
        <TableSkeleton
          rows={10}
          columns={4}
          showCheckbox={false}
          showActions={true}
        />

        {/* Pagination */}
        <div className="mt-4 flex justify-end">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-9" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function JobsTableSkeleton() {
  return (
    <div className="bg-card border-border rounded-lg border">
      <div className="border-border border-b p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <TableSkeleton
        rows={10}
        columns={7}
        showCheckbox={false}
        showActions={true}
        showHeader={true}
      />
    </div>
  );
}

export function UsersTableSkeleton() {
  return (
    <div className="space-y-4">
      {/* Search and filters */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Table */}
      <TableSkeleton
        rows={10}
        columns={6}
        showCheckbox={false}
        showActions={true}
      />

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-48" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>
    </div>
  );
}
