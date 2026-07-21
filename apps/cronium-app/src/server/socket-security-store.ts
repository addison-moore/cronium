import Redis, { type Redis as RedisClient } from "ioredis";
import { normalizeValkeyUrl } from "@/lib/valkey-url";

const SOCKET_TICKET_PREFIX = "cronium:socket-ticket:consumed:";
const SOCKET_SECURITY_CHANNEL = "cronium:socket-security:v1";
const CONNECT_TIMEOUT_MS = 5_000;

export interface SocketSecurityEvent {
  v: 1;
  type: "revoke-user" | "revoke-all";
  userId?: string;
  reason: string;
  issuedAt: string;
}

let commandClientPromise: Promise<RedisClient> | null = null;

function redisUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.VALKEY_URL ?? environment.REDIS_URL;
  if (!value) {
    throw new Error(
      "VALKEY_URL or REDIS_URL is required for socket replay protection",
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
      "Socket security Valkey connection error:",
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
          () =>
            reject(new Error("Socket security Valkey connection timed out")),
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

export async function assertSocketSecurityStoreAvailable(): Promise<void> {
  const client = await commandClient();
  await client.ping();
}

/** Atomically consume a socket ticket across every app/socket replica. */
export async function consumeSocketTicketOnce(
  jti: string,
  expiresAt: number,
  now: number,
): Promise<boolean> {
  const ttlSeconds = expiresAt - now;
  if (ttlSeconds <= 0) return false;

  const client = await commandClient();
  const result = await client.set(
    `${SOCKET_TICKET_PREFIX}${jti}`,
    "1",
    "EX",
    ttlSeconds,
    "NX",
  );
  return result === "OK";
}

async function publish(event: SocketSecurityEvent): Promise<void> {
  const client = await commandClient();
  await client.publish(SOCKET_SECURITY_CHANNEL, JSON.stringify(event));
}

export async function publishUserSocketRevocation(
  userId: string,
  reason: string,
): Promise<void> {
  if (!userId) throw new Error("A user ID is required for socket revocation");
  await publish({
    v: 1,
    type: "revoke-user",
    userId,
    reason: reason.slice(0, 128),
    issuedAt: new Date().toISOString(),
  });
}

export async function publishAllSocketRevocation(
  reason: string,
): Promise<void> {
  await publish({
    v: 1,
    type: "revoke-all",
    reason: reason.slice(0, 128),
    issuedAt: new Date().toISOString(),
  });
}

function parseSocketSecurityEvent(value: string): SocketSecurityEvent | null {
  try {
    const event = JSON.parse(value) as Partial<SocketSecurityEvent>;
    if (
      event.v !== 1 ||
      (event.type !== "revoke-user" && event.type !== "revoke-all") ||
      typeof event.reason !== "string" ||
      typeof event.issuedAt !== "string" ||
      (event.type === "revoke-user" &&
        (typeof event.userId !== "string" || !event.userId))
    ) {
      return null;
    }
    return event as SocketSecurityEvent;
  } catch {
    return null;
  }
}

export async function subscribeToSocketSecurityEvents(
  handler: (event: SocketSecurityEvent) => void | Promise<void>,
): Promise<() => Promise<void>> {
  const subscriber = newClient(redisUrl());
  await connectClient(subscriber);
  await subscriber.subscribe(SOCKET_SECURITY_CHANNEL);

  subscriber.on("message", (channel, message) => {
    if (channel !== SOCKET_SECURITY_CHANNEL) return;
    const event = parseSocketSecurityEvent(message);
    if (!event) {
      console.warn("Ignored malformed socket security event");
      return;
    }
    void Promise.resolve(handler(event)).catch((error) => {
      console.error("Socket security event handler failed:", error);
    });
  });

  return async () => {
    await subscriber.unsubscribe(SOCKET_SECURITY_CHANNEL).catch(() => 0);
    subscriber.disconnect();
  };
}

export async function closeSocketSecurityStore(): Promise<void> {
  const promise = commandClientPromise;
  commandClientPromise = null;
  if (!promise) return;
  const client = await promise.catch(() => null);
  client?.disconnect();
}
