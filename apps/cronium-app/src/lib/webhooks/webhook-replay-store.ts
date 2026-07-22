import Redis, { type Redis as RedisClient } from "ioredis";
import { normalizeValkeyUrl } from "@/lib/valkey-url";

/**
 * Atomic single-use consumption of inbound webhook delivery IDs, so a captured
 * signed request cannot be replayed within the timestamp window (HI-12). Uses
 * its own lazily-connected ioredis client (mirrors socket-security-store) and
 * fails CLOSED: if the store is unavailable the delivery is rejected rather
 * than accepted, since replay protection is exactly what it guards. Senders
 * retry, so a transient outage does not lose events permanently.
 */

const KEY_PREFIX = "cronium:webhook:delivery:";
const CONNECT_TIMEOUT_MS = 5_000;

let commandClientPromise: Promise<RedisClient> | null = null;

function redisUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.VALKEY_URL ?? environment.REDIS_URL;
  if (!value) {
    throw new Error(
      "VALKEY_URL or REDIS_URL is required for webhook replay protection",
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
      "Webhook replay store Valkey error:",
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
          () => reject(new Error("Webhook replay store connection timed out")),
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

/**
 * Consume a delivery ID once for a webhook. Returns true when this is the first
 * time the ID is seen (delivery allowed), false on replay OR when the store is
 * unavailable (fail closed).
 */
export async function consumeWebhookDeliveryOnce(
  webhookId: number,
  deliveryId: string,
  ttlSeconds: number,
): Promise<boolean> {
  if (ttlSeconds <= 0) return false;
  try {
    const client = await commandClient();
    const result = await client.set(
      `${KEY_PREFIX}${webhookId}:${deliveryId}`,
      "1",
      "EX",
      ttlSeconds,
      "NX",
    );
    return result === "OK";
  } catch (error) {
    console.error(
      "Webhook replay store unavailable — rejecting delivery (fail closed):",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

export async function closeWebhookReplayStore(): Promise<void> {
  const promise = commandClientPromise;
  commandClientPromise = null;
  if (!promise) return;
  const client = await promise.catch(() => null);
  client?.disconnect();
}
