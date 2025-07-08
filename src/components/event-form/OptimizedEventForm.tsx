"use client";

import { lazy, Suspense } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// Lazy load the main EventForm
const EventForm = dynamic(() => import("./EventForm"), {
  loading: () => <EventFormSkeleton />,
  ssr: false,
});

// Preload components on hover or focus
const preloadEventForm = () => {
  import("./EventForm");
  import("./ConditionalActionsSection");
  import("./ToolActionSection");
  import("../ui/monaco-editor");
};

// Loading skeleton for the event form
function EventFormSkeleton() {
  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-48" />
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic fields skeleton */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>

          {/* Editor skeleton */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-64 w-full" />
          </div>

          {/* Action buttons skeleton */}
          <div className="flex gap-4">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Optimized EventForm with preloading
export default function OptimizedEventForm(props: any) {
  return (
    <div onMouseEnter={preloadEventForm} onFocus={preloadEventForm}>
      <Suspense fallback={<EventFormSkeleton />}>
        <EventForm {...props} />
      </Suspense>
    </div>
  );
}

// Export individual components for selective importing
export const OptimizedToolActionSection = dynamic(
  () => import("./ToolActionSection"),
  {
    loading: () => <Skeleton className="h-96 w-full" />,
    ssr: false,
  },
);

export const OptimizedConditionalActionsSection = dynamic(
  () => import("./ConditionalActionsSection"),
  {
    loading: () => <Skeleton className="h-64 w-full" />,
    ssr: false,
  },
);
