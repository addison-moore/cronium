import { z } from "zod";

/**
 * Bounds on a webhook's delivery retries. Without them, `maxRetries: 1e9` with
 * `retryDelay: 0` keeps a failing delivery in the in-memory queue forever and
 * turns this server into a loop hammering whatever URL the webhook names.
 */
export const webhookRetryConfigSchema = z.object({
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryDelay: z.number().int().min(100).max(3_600_000).default(1000),
  backoffMultiplier: z.number().min(1).max(10).default(2),
});
