import { TRPCError } from "@trpc/server";
import type { AtomicRateLimitRefusal } from "@/lib/security/atomic-rate-limiter";
import { RATE_LIMIT_UNAVAILABLE_MESSAGE } from "@/shared/rate-limit";

/**
 * tRPC's answer to a request the atomic limiter refused. Over the limit is a 429 with the time
 * to try again after. A limiter that couldn't be asked is a 503: nothing was counted, so it
 * isn't too many attempts, and there's no time to give.
 */
export function rateLimitRefusal(refusal: AtomicRateLimitRefusal): TRPCError {
  if (refusal.reason === "unavailable") {
    return new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: RATE_LIMIT_UNAVAILABLE_MESSAGE,
    });
  }
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Too many attempts. Please try again after ${refusal.resetAt.toISOString()}`,
  });
}
