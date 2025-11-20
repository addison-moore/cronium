import { Skeleton } from "@cronium/ui";

export default function ToolsLoading() {
  return (
    <div className="container mx-auto p-4">
      <div className="mb-6">
        <Skeleton className="mb-2 h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-border rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-6 w-6" />
              <Skeleton className="h-4 w-4 rounded-full" />
            </div>
            <Skeleton className="mb-2 h-5 w-24" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
