"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { loggerLink, httpBatchLink } from "@trpc/client";
import { createTRPCReact, type CreateTRPCReact } from "@trpc/react-query";
import { useState } from "react";
import SuperJSON from "superjson";

import { type AppRouter } from "@/server/api/root";

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Data stays fresh for 1 minute
        staleTime: 60 * 1000,
        // Keep data in cache for 5 minutes after becoming stale
        gcTime: 5 * 60 * 1000,
        // Refetch on window focus for critical data
        refetchOnWindowFocus: true,
        // Don't refetch on reconnect for performance
        refetchOnReconnect: false,
        // Retry configuration
        retry: (failureCount, error) => {
          // Don't retry on 4xx errors (client errors)
          if (
            error &&
            typeof error === "object" &&
            "data" in error &&
            error.data &&
            typeof error.data === "object" &&
            "httpStatus" in error.data &&
            typeof error.data.httpStatus === "number"
          ) {
            const httpStatus = error.data.httpStatus;
            if (httpStatus >= 400 && httpStatus < 500) {
              return false;
            }
          }
          // Exponential backoff for retries
          return failureCount < 3;
        },
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      },
      mutations: {
        // Mutations should not retry by default
        retry: false,
        // Keep mutation data for debugging
        gcTime: 2 * 60 * 1000, // 2 minutes
      },
    },
  });

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = () => {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return createQueryClient();
  }
  // Browser: use singleton pattern to keep the same query client
  return (clientQueryClientSingleton ??= createQueryClient());
};

export const api: CreateTRPCReact<AppRouter, unknown> =
  createTRPCReact<AppRouter>();

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) => {
            const isDev = process.env.NODE_ENV === "development";

            // In development, log all operations
            if (isDev) {
              return true;
            }

            // In production, only log errors
            return op.direction === "down" && op.result instanceof Error;
          },
          // Enhanced logging for development
          logger: (opts) => {
            const { direction, type, path, input } = opts;
            const isDev = process.env.NODE_ENV === "development";

            if (isDev) {
              const emoji = direction === "up" ? "⬆️" : "⬇️";
              const operation = `${emoji} ${type.toUpperCase()} ${path}`;

              if (direction === "up") {
                console.groupCollapsed(
                  `%c${operation}`,
                  "color: #0070f3; font-weight: bold;",
                );
                if (input) {
                  console.log("Input:", input);
                }
                console.groupEnd();
              } else {
                // For down direction, we don't have access to result in logger
                console.groupCollapsed(
                  `%c${operation} - RESPONSE`,
                  "color: #00aa00; font-weight: bold;",
                );
                console.groupEnd();
              }
            }
          },
        }),
        httpBatchLink({
          transformer: SuperJSON,
          url: getBaseUrl() + "/api/trpc",
          headers: () => {
            const headers = new Headers();
            headers.set("x-trpc-source", "nextjs-react");
            return headers;
          },
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
        {process.env.NODE_ENV === "development" && (
          <ReactQueryDevtools
            initialIsOpen={false}
            position="bottom"
            buttonPosition="bottom-right"
          />
        )}
      </api.Provider>
    </QueryClientProvider>
  );
}

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 5001}`;
}
