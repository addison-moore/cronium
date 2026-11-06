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

/**
 * What to tell a person when a tRPC call fails. A failed input validation's
 * `message` is its Zod issues as a JSON array, so for those this gives the
 * sentences from `data.zodError`, which the error formatter in
 * server/api/trpc.ts adds.
 */
export function trpcErrorMessage(error: unknown, fallback: string): string {
  const { message = "", data } = (error ?? {}) as Partial<TRPCError>;
  const zodError = data?.zodError;
  const sentences = zodError
    ? [...zodError.formErrors, ...Object.values(zodError.fieldErrors).flat()]
    : [];
  return sentences.join("; ") || message || fallback;
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
