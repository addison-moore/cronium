import { Skeleton } from "@cronium/ui";
import { Card, CardContent, CardHeader } from "@cronium/ui";

export function DashboardStatsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="mb-2 h-8 w-20" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-3 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-3 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Execution Metrics */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-2 w-full" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-2 w-full" />
            </div>
            <Skeleton className="h-5 w-32" />
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-12" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-12" />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Activity Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-9 w-24" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Table headers */}
            <div className="border-border grid grid-cols-5 gap-4 border-b pb-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
            {/* Table rows */}
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-5 items-center gap-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-8" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function MonitoringPageSkeleton() {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <Skeleton className="mb-2 h-8 w-48" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="space-y-6">
        {/* User Statistics */}
        <div>
          <Skeleton className="mb-4 h-6 w-32" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-5" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Events and Executions */}
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="mb-4 h-6 w-40" />
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <div key={j} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-4 w-12" />
                        </div>
                        <Skeleton className="h-2 w-full" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>

        {/* System Information */}
        <div>
          <Skeleton className="mb-4 h-6 w-40" />
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-32" />
                </CardHeader>
                <CardContent className="space-y-4">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j}>
                      <div className="mb-2 flex items-center justify-between">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-16" />
                      </div>
                      <Skeleton className="h-2 w-full" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
