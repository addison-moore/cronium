/**
 * Pure retry-policy helpers for the job queue. Kept dependency-free so they
 * can be unit-tested without a database.
 */

export const RETRY_BASE_DELAY_MS = 5000; // 5s
export const RETRY_MAX_DELAY_MS = 5 * 60 * 1000; // 5 min

/**
 * Whether a failed job with `currentAttempts` prior attempts should be retried,
 * given its configured `maxAttempts` (0 = no retries).
 */
export function shouldRetry(
  currentAttempts: number,
  maxAttempts: number,
): boolean {
  return maxAttempts > 0 && currentAttempts < maxAttempts;
}

/**
 * Exponential backoff delay for the next retry: base · 2^attempts, capped.
 */
export function computeRetryBackoffMs(currentAttempts: number): number {
  return Math.min(
    RETRY_BASE_DELAY_MS * 2 ** currentAttempts,
    RETRY_MAX_DELAY_MS,
  );
}
