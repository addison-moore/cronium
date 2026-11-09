import Redis, { type Redis as RedisClient } from "ioredis";
import { normalizeValkeyUrl } from "@/lib/valkey-url";
import { describeFailure } from "@/lib/pg-errors";

/**
 * Atomic, fail-closed rate limiter for authentication and other high-risk
 * endpoints (security plan Phase 1.3).
 *
 * Unlike the general-purpose `RateLimitService` (fixed-window, read-modify-
 * write, fail-open — acceptable for ordinary API throttling), this limiter:
 *   - increments atomically with a single `INCR` + first-hit `PEXPIRE`, so
 *     concurrent requests cannot race past the limit;
 *   - fails CLOSED (denies) when Valkey is unavailable, so brute-force
 *     protection cannot be removed by knocking out the cache.
 *
 * It uses its own ioredis client (mirroring socket-security-store) so its
 * availability is independent of the best-effort cache client.
 */

const CONNECT_TIMEOUT_MS = 5_000;
const KEY_PREFIX = "cronium:ratelimit:v1:";

// Atomic fixed-window: INCR the counter, set the window TTL only on the first
// hit, and report the current count. KEYS[1]=key ARGV[1]=windowMs.
const INCR_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

let commandClientPromise: Promise<RedisClient> | null = null;

function redisUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.VALKEY_URL ?? environment.REDIS_URL;
  if (!value) {
    throw new Error(
      "VALKEY_URL or REDIS_URL is required for fail-closed rate limiting",
    );
  }
  return normalizeValkeyUrl(value);
}

function newClient(url: string): RedisClient {
  const client = new Redis(url, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
  });
  client.on("error", (error) => {
    console.error(
      "Atomic rate limiter Valkey connection error:",
      describeFailure(error),
    );
  });
  return client;
}

async function connectClient(client: RedisClient): Promise<RedisClient> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Atomic rate limiter connection timed out")),
          CONNECT_TIMEOUT_MS,
        );
      }),
    ]);
    await client.ping();
    return client;
  } catch (error) {
    client.disconnect();
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function commandClient(): Promise<RedisClient> {
  commandClientPromise ??= connectClient(newClient(redisUrl())).catch(
    (error) => {
      commandClientPromise = null;
      throw error;
    },
  );
  return commandClientPromise;
}

export interface AtomicRateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface AtomicRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Atomically consume one unit against `bucket` for `identifier`, as
 * consumeAtomicRateLimit does, but throw when Valkey can't answer, for a caller
 * that decides for itself what an outage means.
 */
export async function consumeAtomicRateLimitOrThrow(
  identifier: string,
  bucket: string,
  config: AtomicRateLimitConfig,
): Promise<AtomicRateLimitResult> {
  const { maxRequests, windowMs } = config;
  const key = `${KEY_PREFIX}${bucket}:${identifier}`;
  const client = await commandClient();
  const [countRaw, ttlRaw] = (await client.eval(
    INCR_SCRIPT,
    1,
    key,
    String(windowMs),
  )) as [number, number];

  const count = Number(countRaw);
  const ttl = Number(ttlRaw);
  const resetAt = new Date(Date.now() + (ttl > 0 ? ttl : windowMs));
  if (count > maxRequests) {
    return { allowed: false, remaining: 0, resetAt };
  }
  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - count),
    resetAt,
  };
}

/**
 * Atomically consume one unit against `bucket` for `identifier`. Denies when
 * the limit is exceeded, and denies (fail closed) when Valkey is unreachable.
 *
 * @throws never — availability failures resolve to `{ allowed: false }`.
 */
export async function consumeAtomicRateLimit(
  identifier: string,
  bucket: string,
  config: AtomicRateLimitConfig,
): Promise<AtomicRateLimitResult> {
  const { windowMs } = config;
  try {
    return await consumeAtomicRateLimitOrThrow(identifier, bucket, config);
  } catch (error) {
    // Fail CLOSED: a missing limiter must not open the auth endpoint.
    console.error(
      "Atomic rate limiter unavailable — denying request (fail closed):",
      describeFailure(error),
    );
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + windowMs),
    };
  }
}
