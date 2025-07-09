"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RefreshCw } from "lucide-react";

// Loading skeletons for each component
const ToolBrowserSkeleton = () => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i} className="animate-pulse">
          <CardHeader>
            <Skeleton className="h-6 w-3/4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="mb-2 h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  </div>
);

const CredentialManagerSkeleton = () => (
  <Card className="animate-pulse">
    <CardHeader>
      <Skeleton className="h-6 w-48" />
    </CardHeader>
    <CardContent className="space-y-4">
      <Skeleton className="h-10 w-full" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </CardContent>
  </Card>
);

const DefaultSkeleton = () => (
  <div className="flex items-center justify-center py-8">
    <RefreshCw className="text-muted-foreground h-6 w-6 animate-spin" />
  </div>
);

// Lazy-loaded components with proper error boundaries and loading states
export const LazyToolBrowser = dynamic(
  () =>
    import("../tool-browser/ToolBrowser").then((mod) => ({
      default: mod.ToolBrowser,
    })),
  {
    loading: () => (
      <Suspense fallback={<ToolBrowserSkeleton />}>
        <ToolBrowserSkeleton />
      </Suspense>
    ),
    ssr: false,
  },
);

export const LazyActionParameterForm = dynamic(
  () => import("../../event-form/ActionParameterForm"),
  {
    loading: () => <DefaultSkeleton />,
    ssr: false,
  },
);

export const LazyToolCredentialManager = dynamic(
  () => import("../ToolCredentialManager"),
  {
    loading: () => (
      <Suspense fallback={<CredentialManagerSkeleton />}>
        <CredentialManagerSkeleton />
      </Suspense>
    ),
    ssr: false,
  },
);

export const LazyCredentialHealthIndicator = dynamic(
  () => import("../CredentialHealthIndicator"),
  {
    loading: () => <DefaultSkeleton />,
    ssr: false,
  },
);

export const LazyCredentialTroubleshooter = dynamic(
  () => import("../CredentialTroubleshooter"),
  {
    loading: () => <DefaultSkeleton />,
    ssr: false,
  },
);

export const LazyTestDataGenerator = dynamic(
  () => import("../TestDataGenerator"),
  {
    loading: () => <DefaultSkeleton />,
    ssr: false,
  },
);

export const LazyErrorHandler = dynamic(() => import("../ErrorHandler"), {
  loading: () => <DefaultSkeleton />,
  ssr: false,
});

export const LazyRetryManager = dynamic(() => import("../RetryManager"), {
  loading: () => <DefaultSkeleton />,
  ssr: false,
});

export const LazyExecutionLogsViewer = dynamic(
  () =>
    import("../ExecutionLogsViewer").then((mod) => ({
      default: mod.ExecutionLogsViewer,
    })),
  {
    loading: () => <DefaultSkeleton />,
    ssr: false,
  },
);

export const LazyErrorRecoverySuggestions = dynamic(
  () => import("../ErrorRecoverySuggestions"),
  {
    loading: () => <DefaultSkeleton />,
    ssr: false,
  },
);

// Preload utilities for critical paths
export const preloadToolComponents = () => {
  // Preload critical components
  import("../tool-browser/ToolBrowser");
  import("../../event-form/ActionParameterForm");
  import("../ToolCredentialManager");
};

export const preloadErrorComponents = () => {
  // Preload error handling components
  import("../ErrorHandler");
  import("../ErrorRecoverySuggestions");
  import("../RetryManager");
};

export const preloadMonitoringComponents = () => {
  // Preload monitoring components
  import("../ExecutionLogsViewer");
  import("../CredentialHealthIndicator");
};
