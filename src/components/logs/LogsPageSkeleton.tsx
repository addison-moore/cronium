import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TableSkeleton } from "@/components/ui/table-skeleton";

export function LogsPageSkeleton() {
  return (
    <div className="container mx-auto p-4">
      <div className="space-y-6">
        {/* Page Header */}
        <div>
          <Skeleton className="mb-2 h-8 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>

        <Tabs defaultValue="events" className="space-y-4">
          <TabsList>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="workflows">Workflows</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-9 w-24" />
                </div>
              </CardHeader>
              <CardContent>
                {/* Filters */}
                <div className="mb-4 flex flex-wrap gap-2">
                  <Skeleton className="h-9 w-32" />
                  <Skeleton className="h-9 w-40" />
                  <Skeleton className="h-9 w-32" />
                  <Skeleton className="h-9 w-40" />
                </div>

                {/* Table */}
                <TableSkeleton
                  rows={10}
                  columns={5}
                  showCheckbox={false}
                  showActions={true}
                />

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
          </TabsContent>

          <TabsContent value="workflows" className="space-y-4">
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-48" />
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="rounded-lg border border-border p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-6 w-20" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Skeleton className="mb-1 h-4 w-24" />
                          <Skeleton className="h-4 w-32" />
                        </div>
                        <div>
                          <Skeleton className="mb-1 h-4 w-24" />
                          <Skeleton className="h-4 w-32" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
