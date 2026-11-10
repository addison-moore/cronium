import Redis, { type Redis as RedisClient } from "ioredis";
import { normalizeValkeyUrl } from "@/lib/valkey-url";
import { VALKEY_ANSWER_LIMITS } from "@/lib/valkey-answer-limit";
import { describeFailure } from "@/lib/pg-errors";

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
 * stores). The WRITE is best-effort: if it fails it is written again once Valkey
 * answers, the token still expires at its hard cap, and the runtime fails CLOSED
 * on its own read errors — so a transient outage cannot turn revocation into
 * silent acceptance.
 */

const KEY_PREFIX = "cronium:exec-revoked:";
const DEFAULT_TTL_SECONDS = 3 * 60 * 60; // > the runtime's 2h absolute token cap
const CONNECT_TIMEOUT_MS = 5_000;
const MAX_UNWRITTEN = 10_000;

let commandClientPromise: Promise<RedisClient> | null = null;

/**
 * Markers that couldn't be written, by job, with their TTL, to write as soon as a
 * connection is ready. The job's end has stopped waiting for its marker, and without
 * this the job's token would work again once Valkey answered, until the token's own
 * 2-hour cap. Held in this process only, at most MAX_UNWRITTEN, the oldest let go first.
 */
const unwritten = new Map<string, number>();

function remember(jobId: string, ttlSeconds: number): void {
  unwritten.delete(jobId);
  if (unwritten.size >= MAX_UNWRITTEN) {
    // Its token is the nearest its own cap.
    const oldest = unwritten.keys().next().value;
    if (oldest !== undefined) unwritten.delete(oldest);
  }
  unwritten.set(jobId, ttlSeconds);
}

async function writeUnwritten(client: RedisClient): Promise<void> {
  for (const [jobId, ttlSeconds] of [...unwritten]) {
    try {
      await client.set(revocationKey(jobId), "1", "EX", ttlSeconds);
    } catch {
      // Not answering again. The next connection that's ready starts over.
      return;
    }
    unwritten.delete(jobId);
  }
}

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
    // Every job that ends waits on this write (job-transition.ts), after its new state
    // has committed. A Valkey that accepts connections and never answers held it for
    // good: jobs.cancel and the orchestrator's job reports waited with it, and the
    // worker kept each in-process job's slot, so after ten it started nothing more. Now
    // the write gives up within VALKEY_ANSWER_MS, and is made again once Valkey answers.
    ...VALKEY_ANSWER_LIMITS,
  });
  client.on("error", (error) => {
    console.error(
      "Execution-token revocation store Valkey error:",
      describeFailure(error),
    );
  });
  // ioredis can't keep these writes itself: a new connection whose ready check isn't
  // answered fails every command waiting for it, the given-up ones included.
  client.on("ready", () => void writeUnwritten(client));
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
 * Best-effort: a failure is logged and swallowed, and the marker is written once a
 * connection is ready — the token's absolute lifetime cap is the backstop, and the
 * runtime's read fails closed.
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
    remember(jobId, ttlSeconds);
    console.error(
      `Failed to write execution-token revocation for job ${jobId} (written once Valkey answers; the token expires at its hard cap regardless):`,
      describeFailure(error),
    );
  }
}
