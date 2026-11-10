import Redis, { type Redis as RedisClient } from "ioredis";
import { normalizeValkeyUrl } from "@/lib/valkey-url";
import { VALKEY_ANSWER_LIMITS } from "@/lib/valkey-answer-limit";
import { describeFailure, failureWithStack } from "@/lib/pg-errors";

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

function newClient(
  url: string,
  options: { autoResubscribe?: boolean } = {},
): RedisClient {
  const client = new Redis(url, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    // A Valkey that accepts connections and never answers held every command here for
    // good: each socket handshake's ticket, and each change that ends a user's sessions,
    // which checks this store before it writes. Both now refuse within VALKEY_ANSWER_MS.
    //
    // The subscriber gets the same limits, and they never close it for being quiet:
    // socketTimeout runs only while a command waits for its answer, and a subscriber
    // sends nothing between SUBSCRIBE and UNSUBSCRIBE, however long no event comes.
    ...VALKEY_ANSWER_LIMITS,
    autoResubscribe: options.autoResubscribe ?? true,
  });
  client.on("error", (error) => {
    console.error(
      "Socket security Valkey connection error:",
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

/**
 * Tells every socket server to disconnect a user's sockets, or everyone's, now.
 *
 * Every caller has already committed the change that calls for this, so a failure to
 * send is logged, not thrown. Throwing told the admin their change had failed when it
 * was in effect: requests read the account from Postgres, and every 10 seconds each
 * socket server re-reads its connected users from Postgres (server.ts), disconnects
 * those whose account changed, and ends terminals that lost their server or console
 * access. The event only makes that immediate, and while Valkey isn't answering no
 * socket server could hear it anyway.
 */
async function publish(event: SocketSecurityEvent): Promise<void> {
  try {
    const client = await commandClient();
    await client.publish(SOCKET_SECURITY_CHANNEL, JSON.stringify(event));
  } catch (error) {
    const whose = event.userId ? `user ${event.userId}` : "everyone";
    console.error(
      `Couldn't tell socket servers to disconnect ${whose} (${event.reason}). They will at their next check of connected users, within 10 seconds:`,
      describeFailure(error),
    );
  }
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
  // This subscribes again on each new connection itself. ioredis resubscribes only to
  // channels the closed connection had confirmed, and under VALKEY_ANSWER_LIMITS a
  // resubscribe left unanswered closes its connection before Valkey confirms anything.
  // The connection after that would subscribe to nothing, for good, and the timed-out
  // resubscribe would be an unhandled rejection, which ends the socket server.
  const subscriber = newClient(redisUrl(), { autoResubscribe: false });
  await connectClient(subscriber);
  try {
    await subscriber.subscribe(SOCKET_SECURITY_CHANNEL);
  } catch (error) {
    // Unanswered, it now fails rather than waiting, and the client would otherwise go
    // on connecting for good with no one to close it.
    subscriber.disconnect();
    throw error;
  }
  const subscribeAgain = () => {
    // Unanswered, this connection is closed and the next one tries again.
    subscriber.subscribe(SOCKET_SECURITY_CHANNEL).catch((error: unknown) => {
      console.error(
        "Socket security subscriber couldn't subscribe on its new connection:",
        describeFailure(error),
      );
    });
  };
  subscriber.on("ready", subscribeAgain);

  subscriber.on("message", (channel, message) => {
    if (channel !== SOCKET_SECURITY_CHANNEL) return;
    const event = parseSocketSecurityEvent(message);
    if (!event) {
      console.warn("Ignored malformed socket security event");
      return;
    }
    void Promise.resolve(handler(event)).catch((error) => {
      console.error(
        "Socket security event handler failed:",
        failureWithStack(error),
      );
    });
  });

  return async () => {
    subscriber.off("ready", subscribeAgain);
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
