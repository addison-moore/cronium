import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { cache } from "react";

/**
 * Cached version of getServerSession to avoid repeated database calls
 * Uses React's cache() to deduplicate requests within a single request lifecycle
 */
export const getCachedServerSession = cache(async () => {
  return await getServerSession(authOptions);
});
