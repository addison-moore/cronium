import { Skeleton } from "./skeleton";

export function CodeEditorSkeleton() {
  return (
    <div className="w-full space-y-2">
      <div className="mb-2 flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export function TerminalSkeleton() {
  return (
    <div className="w-full space-y-2">
      <div className="bg-background border-border flex items-center space-x-2 rounded-t-lg border p-2">
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-3 w-3 rounded-full" />
      </div>
      <Skeleton className="h-96 w-full rounded-b-lg" />
    </div>
  );
}

export function WorkflowCanvasSkeleton() {
  return (
    <div className="border-border bg-muted/10 flex h-[600px] w-full items-center justify-center rounded-lg border">
      <div className="space-y-4 text-center">
        <Skeleton className="mx-auto h-12 w-12 rounded-full" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mx-auto h-4 w-36" />
      </div>
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex h-64 w-full items-end justify-between space-x-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1"
            style={{ height: `${Math.random() * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="w-full space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-32 w-full" />
      </div>
      <Skeleton className="h-10 w-24" />
    </div>
  );
}

export function ActionBuilderSkeleton() {
  return (
    <div className="border-border bg-muted/10 flex h-[500px] w-full items-center justify-center rounded-lg border">
      <div className="space-y-4 text-center">
        <Skeleton className="mx-auto h-16 w-16 rounded-lg" />
        <Skeleton className="h-4 w-48" />
        <div className="flex justify-center space-x-2">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      </div>
    </div>
  );
}
