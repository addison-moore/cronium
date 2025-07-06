/**
 * Shared utilities and types for tRPC usage across the application.
 * These helpers make working with tRPC procedures more convenient and type-safe.
 */

export type { AppRouter } from "@/server/api/root";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/api/root";

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

// Utility types for extracting specific procedure types
export type ProcedureInputs<T extends keyof RouterInputs> = RouterInputs[T];
export type ProcedureOutputs<T extends keyof RouterOutputs> = RouterOutputs[T];

// Helper type for extracting nested router types
export type NestedRouterInputs<
  TRouter extends keyof RouterInputs,
  TProcedure extends keyof RouterInputs[TRouter],
> = RouterInputs[TRouter][TProcedure];

export type NestedRouterOutputs<
  TRouter extends keyof RouterOutputs,
  TProcedure extends keyof RouterOutputs[TRouter],
> = RouterOutputs[TRouter][TProcedure];

// Common error handling types
export interface TRPCErrorData {
  code: string;
  httpStatus?: number;
  zodError?: {
    fieldErrors: Record<string, string[]>;
    formErrors: string[];
  };
}

export interface TRPCError extends Error {
  data?: TRPCErrorData;
}

// Helper function to check if an error is a tRPC error
export function isTRPCError(error: unknown): error is TRPCError {
  return (
    error instanceof Error &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data
  );
}

// Helper function to extract Zod validation errors
export function getZodErrors(error: unknown): Record<string, string[]> | null {
  if (isTRPCError(error) && error.data?.zodError?.fieldErrors) {
    return error.data.zodError.fieldErrors;
  }
  return null;
}

// Helper function to get field-specific error
export function getFieldError(
  error: unknown,
  fieldName: string,
): string | null {
  const zodErrors = getZodErrors(error);
  if (zodErrors?.[fieldName]?.[0]) {
    return zodErrors[fieldName][0];
  }
  return null;
}

// Common query options for different data types
export const QUERY_OPTIONS = {
  // Fast-changing data (real-time updates)
  realtime: {
    staleTime: 0,
    gcTime: 1 * 60 * 1000, // 1 minute
    refetchInterval: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  },
  // Medium-changing data (user interactions)
  dynamic: {
    staleTime: 1 * 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
    refetchOnReconnect: false,
  },
  // Slow-changing data (configuration, settings)
  static: {
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  },
  // Very stable data (rarely changes)
  stable: {
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  },
  // Background data (prefetched, low priority)
  background: {
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1, // Minimal retries for background data
  },
} as const;

// Advanced query patterns for specific use cases
export const ADVANCED_PATTERNS = {
  // Infinite query configuration
  infinite: {
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    maxPages: 10, // Limit cached pages
  },

  // Optimistic update configuration
  optimistic: {
    retry: false, // Don't retry optimistic updates
    gcTime: 1 * 60 * 1000, // Short cache time
  },

  // Critical data that should always be fresh
  critical: {
    staleTime: 0,
    gcTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 3,
  },
} as const;

// Middleware application helpers
export const MIDDLEWARE_COMBINATIONS = {
  // For API endpoints that need timing and caching
  cached: {
    timing: true,
    cache: 60000, // 1 minute cache
  },

  // For rate-limited endpoints
  rateLimited: {
    timing: true,
    rateLimit: { maxRequests: 100, windowMs: 60000 },
  },

  // For critical operations with full monitoring
  monitored: {
    timing: true,
    rateLimit: { maxRequests: 50, windowMs: 60000 },
    transaction: true,
  },

  // For public endpoints
  public: {
    timing: true,
    cache: 300000, // 5 minute cache
    rateLimit: { maxRequests: 200, windowMs: 60000 },
  },
} as const;
