import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { createCaller } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";

/**
 * Enhanced context creation with optimizations for App Router.
 * Uses React cache for request deduplication and proper session handling.
 */
const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");

  return createTRPCContext({
    headers: heads,
  });
});

/**
 * Server-side tRPC caller optimized for Next.js 15 App Router.
 * Automatically handles context creation and caching for Server Components.
 */
export const api = createCaller(createContext);

/**
 * Create a context for testing or manual server-side calls.
 * This bypasses the cache and creates a fresh context.
 */
export const createTestContext = async (overrides?: { userId?: string }) => {
  const heads = new Headers();
  heads.set("x-trpc-source", "test");

  if (overrides?.userId) {
    heads.set("x-test-user-id", overrides.userId);
  }

  return createTRPCContext({
    headers: heads,
  });
};

/**
 * Create a caller with custom context - useful for testing or background jobs.
 */
export const createTestCaller = async (overrides?: { userId?: string }) => {
  const context = await createTestContext(overrides);
  return createCaller(async () => context);
};
