import Redis, { type Redis as RedisClient } from "ioredis";
import { normalizeValkeyUrl } from "@/lib/valkey-url";

/**
 * Revocation of per-job execution tokens (HI-14). When a job reaches a terminal
 * state, its execution token (the JWT scripts present to the runtime) must stop
 * working immediately — a leaked or lingering token cannot outlive the job.
 *
 * The app writes a job-scoped revocation marker to the shared Valkey the moment
 * a job transitions to a terminal state; the Go runtime checks it on every
 * request (see `internal/middleware` revocation check) and rejects tokens for
 * revoked jobs. The key is the exact string the runtime reads.
 *
 * The marker carries a TTL comfortably larger than the token's absolute
 * lifetime cap (2h in the runtime), so it self-expires once no valid token
 * could remain, keeping the keyspace bounded.
 *
 * Uses its own lazily-connected ioredis client (mirrors the other security
 * stores). The WRITE is best-effort: if it fails the token still expires at its
 * hard cap, and the runtime fails CLOSED on its own read errors — so a transient
 * outage cannot turn revocation into silent acceptance.
 */

const KEY_PREFIX = "cronium:exec-revoked:";
const DEFAULT_TTL_SECONDS = 3 * 60 * 60; // > the runtime's 2h absolute token cap
const CONNECT_TIMEOUT_MS = 5_000;

let commandClientPromise: Promise<RedisClient> | null = null;

function redisUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.VALKEY_URL ?? environment.REDIS_URL;
  if (!value) {
    throw new Error(
      "VALKEY_URL or REDIS_URL is required for execution-token revocation",
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
      "Execution-token revocation store Valkey error:",
      error.message || String(error),
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
          () => reject(new Error("Revocation store connection timed out")),
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

/** The exact Valkey key the runtime checks for a job's revocation marker. */
export function revocationKey(jobId: string): string {
  return `${KEY_PREFIX}${jobId}`;
}

/**
 * Revoke every execution token for a job (called when the job goes terminal).
 * Best-effort: a failure is logged and swallowed — the token's absolute
 * lifetime cap is the backstop, and the runtime's read fails closed.
 */
export async function revokeJobExecutionTokens(
  jobId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  if (!jobId) return;
  try {
    const client = await commandClient();
    await client.set(revocationKey(jobId), "1", "EX", ttlSeconds);
  } catch (error) {
    console.error(
      `Failed to write execution-token revocation for job ${jobId} (token still expires at its hard cap):`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Whether a job's execution tokens have been revoked (test/introspection). */
export async function isJobExecutionRevoked(jobId: string): Promise<boolean> {
  const client = await commandClient();
  const n = await client.exists(revocationKey(jobId));
  return n > 0;
}

export async function closeExecutionRevocationStore(): Promise<void> {
  const promise = commandClientPromise;
  commandClientPromise = null;
  if (!promise) return;
  const client = await promise.catch(() => null);
  client?.disconnect();
}
