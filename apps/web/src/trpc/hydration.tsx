"use client";

import { type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Advanced hydration component for optimizing Server Component data in Client Components.
 * Automatically prefetches and hydrates tRPC queries for better performance.
 */

interface HydrationWrapperProps {
  children: ReactNode;
  // Pre-hydrated data from Server Components
  initialData?: Record<string, unknown>;
  // Queries to prefetch on mount
  prefetch?: Array<{
    queryKey: string[];
    queryFn: () => Promise<unknown>;
    staleTime?: number;
  }>;
}

export function HydrationWrapper({
  children,
  initialData,
  prefetch,
}: HydrationWrapperProps) {
  const queryClient = useQueryClient();

  // Hydrate initial data on mount
  if (initialData) {
    Object.entries(initialData).forEach(([key, data]) => {
      queryClient.setQueryData(JSON.parse(key), data);
    });
  }

  // Prefetch queries on mount
  if (prefetch) {
    prefetch.forEach(({ queryKey, queryFn, staleTime = 60000 }) => {
      void queryClient.prefetchQuery({
        queryKey,
        queryFn,
        staleTime,
      });
    });
  }

  return <>{children}</>;
}

/**
 * Hook for server-side data hydration patterns.
 * Provides utilities for managing server/client data synchronization.
 */
export function useServerHydration() {
  const queryClient = useQueryClient();

  const hydrateQuery = function <T>(
    queryKey: string[],
    data: T,
    staleTime = 60000,
  ) {
    queryClient.setQueryData(queryKey, data, {
      updatedAt: Date.now() - staleTime + 1000, // Make slightly stale to allow refetch
    });
  };

  const prefetchQuery = async function <T>(
    queryKey: string[],
    queryFn: () => Promise<T>,
    options?: { staleTime?: number; gcTime?: number },
  ) {
    return queryClient.prefetchQuery({
      queryKey,
      queryFn,
      staleTime: options?.staleTime ?? 60000,
      gcTime: options?.gcTime ?? 5 * 60000,
    });
  };

  return {
    hydrateQuery,
    prefetchQuery,
    queryClient,
  };
}

/**
 * Higher-order component for pages that need advanced hydration.
 * Automatically handles common patterns for Server Component + Client Component data flow.
 */
export function withServerHydration<P extends object>(
  Component: React.ComponentType<P>,
  config?: {
    prefetchQueries?: Array<{
      condition?: (props: P) => boolean;
      queryKey: (props: P) => string[];
      queryFn: (props: P) => () => Promise<unknown>;
      staleTime?: number;
    }>;
  },
) {
  return function HydratedComponent(props: P) {
    const { prefetchQuery } = useServerHydration();

    // Prefetch queries based on configuration
    if (config?.prefetchQueries) {
      config.prefetchQueries.forEach(
        ({ condition, queryKey, queryFn, staleTime }) => {
          if (!condition || condition(props)) {
            const key = queryKey(props);
            const fn = queryFn(props);
            void prefetchQuery(key, fn, staleTime ? { staleTime } : {});
          }
        },
      );
    }

    return <Component {...props} />;
  };
}

/**
 * Utility for creating optimized page components with tRPC data fetching.
 * Combines Server Component data fetching with Client Component interactivity.
 */
export interface OptimizedPageConfig<TServerData, TClientQueries> {
  // Server-side data fetching function
  getServerData: () => Promise<TServerData>;
  // Client-side queries to prefetch
  getClientQueries?: (serverData: TServerData) => TClientQueries[];
  // Component that receives both server and client data
  component: React.ComponentType<{
    serverData: TServerData;
    clientQueries?: TClientQueries[];
  }>;
}

/**
 * Cache management utilities for advanced use cases.
 */
export function useCacheManagement() {
  const queryClient = useQueryClient();

  const invalidatePattern = (pattern: string) => {
    const queries = queryClient.getQueryCache().getAll();
    const matchingQueries = queries.filter((query) =>
      query.queryKey.some((key) =>
        typeof key === "string" ? key.includes(pattern) : false,
      ),
    );

    matchingQueries.forEach((query) => {
      void queryClient.invalidateQueries({ queryKey: query.queryKey });
    });
  };

  const clearPattern = (pattern: string) => {
    const queries = queryClient.getQueryCache().getAll();
    const matchingQueries = queries.filter((query) =>
      query.queryKey.some((key) =>
        typeof key === "string" ? key.includes(pattern) : false,
      ),
    );

    matchingQueries.forEach((query) => {
      queryClient.removeQueries({ queryKey: query.queryKey });
    });
  };

  const getStaleQueries = () => {
    return queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.isStale());
  };

  const getCacheStats = () => {
    const queries = queryClient.getQueryCache().getAll();
    return {
      total: queries.length,
      stale: queries.filter((q) => q.isStale()).length,
      loading: queries.filter((q) => q.state.status === "pending").length,
      error: queries.filter((q) => q.state.status === "error").length,
      success: queries.filter((q) => q.state.status === "success").length,
    };
  };

  return {
    invalidatePattern,
    clearPattern,
    getStaleQueries,
    getCacheStats,
    queryClient,
  };
}
