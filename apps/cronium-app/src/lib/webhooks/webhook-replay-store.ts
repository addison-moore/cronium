import { randomUUID } from "crypto";
import Redis, { type Redis as RedisClient } from "ioredis";
import { normalizeValkeyUrl } from "@/lib/valkey-url";
import { describeFailure } from "@/lib/pg-errors";

/**
 * Atomic single-use consumption of inbound webhook delivery IDs, so a captured
 * signed request cannot be replayed within the timestamp window (HI-12). Uses
 * its own lazily-connected ioredis client (mirrors socket-security-store) and
 * fails CLOSED: if the store is unavailable the delivery is rejected rather
 * than accepted, since replay protection is exactly what it guards. Senders
 * retry, so a transient outage does not lose events permanently.
 *
 * A store that can't be asked is not a replay, so callers are told which it was. A
 * sender told its id was used stops, and one told to come back keeps the event.
 */

const KEY_PREFIX = "cronium:webhook:delivery:";
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * A delivery id one request has taken. Valkey holds the request's own random token for
 * it, so letting go can't free an id another request took since.
 */
export interface DeliveryClaim {
  readonly key: string;
  readonly token: string;
  /** When Valkey forgets the id by itself. */
  readonly expiresAt: number;
}

export type DeliveryIdCheck =
  | { readonly outcome: "fresh"; readonly claim: DeliveryClaim }
  | { readonly outcome: "used" }
  /** Valkey couldn't be asked, so nothing is known about the id. */
  | { readonly outcome: "unavailable" };

/**
 * Takes the id when nothing holds it, first taking back any claim on it that this
 * process left stranded. KEYS[1] is the id's key, ARGV[1] this request's token, ARGV[2]
 * how many seconds to keep it, and ARGV[3] onwards the stranded tokens. Answers 1 when
 * the id is this request's, which it also is when Valkey holds this request's own
 * token: the client sends a command again when the connection drops before its answer,
 * and Valkey may have run it already.
 */
const CONSUME_SCRIPT = `
local held = redis.call('GET', KEYS[1])
for i = 3, #ARGV do
  if held == ARGV[i] then
    redis.call('DEL', KEYS[1])
    held = false
    break
  end
end
if not held then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
end
if held == ARGV[1] then
  return 1
end
return 0
`;

/** Lets go of the id only if this request still holds it. ARGV[1] is its token. */
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Claims taken for requests that did nothing, which Valkey couldn't be told to let go
 * of: a release that failed, or a consume whose answer never came, which Valkey may
 * have run. By key, then token, to when the id expires anyway.
 *
 * The next consume of the same id here takes them back in its own script, so a sender
 * keeping its id isn't told it's replaying, and no retry can get there first. Only
 * this process knows they did nothing, so after a restart, or for a request another
 * replica takes, they stay until they expire.
 */
const stranded = new Map<string, Map<string, number>>();

function strand(claim: DeliveryClaim): void {
  const now = Date.now();
  for (const [key, tokens] of stranded) {
    for (const [token, expiresAt] of tokens) {
      if (expiresAt <= now) tokens.delete(token);
    }
    if (tokens.size === 0) stranded.delete(key);
  }
  if (claim.expiresAt <= now) return;
  const tokens = stranded.get(claim.key) ?? new Map<string, number>();
  tokens.set(claim.token, claim.expiresAt);
  stranded.set(claim.key, tokens);
}

function strandedOn(key: string): string[] {
  const now = Date.now();
  return [...(stranded.get(key) ?? [])]
    .filter(([, expiresAt]) => expiresAt > now)
    .map(([token]) => token);
}

/** A script that ran has taken back the tokens it was given, or found them gone. */
function takenBack(key: string, tokens: string[]): void {
  const held = stranded.get(key);
  if (!held) return;
  for (const token of tokens) held.delete(token);
  if (held.size === 0) stranded.delete(key);
}

/** Valkey's own answer, saying the command failed. It can't have taken the id. */
function answeredWithAnError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "ReplyError";
}

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
    console.error("Webhook replay store Valkey error:", describeFailure(error));
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
 * A client that's connected. One that isn't would hold a command until it reconnects,
 * and when it can't, fail it the same way as one Valkey ran and whose answer was lost.
 * Not sending it answers at once, and leaves nothing to take back.
 */
async function connectedClient(): Promise<RedisClient> {
  const client = await commandClient();
  if (client.status !== "ready") {
    throw new Error(`Valkey isn't connected (${client.status})`);
  }
  return client;
}

/**
 * Consume a delivery ID once for a webhook: `fresh` the first time the ID is seen
 * (delivery allowed), `used` on replay, and `unavailable` when the store can't be
 * asked, which allows nothing either (fail closed) and leaves the ID unused.
 */
export async function consumeWebhookDeliveryOnce(
  webhookId: number,
  deliveryId: string,
  ttlSeconds: number,
): Promise<DeliveryIdCheck> {
  // Nothing can be remembered for no time, so nothing is accepted.
  if (ttlSeconds <= 0) return { outcome: "unavailable" };
  const claim: DeliveryClaim = {
    key: `${KEY_PREFIX}${webhookId}:${deliveryId}`,
    token: randomUUID(),
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  const takingBack = strandedOn(claim.key);
  let sent = false;
  try {
    const client = await connectedClient();
    sent = true;
    const taken = await client.eval(
      CONSUME_SCRIPT,
      1,
      claim.key,
      claim.token,
      String(ttlSeconds),
      ...takingBack,
    );
    takenBack(claim.key, takingBack);
    return taken === 1 ? { outcome: "fresh", claim } : { outcome: "used" };
  } catch (error) {
    console.error(
      "Webhook replay store unavailable — rejecting delivery (fail closed):",
      describeFailure(error),
    );
    // Valkey may have run it and the answer been lost on the way.
    if (sent && !answeredWithAnError(error)) strand(claim);
    return { outcome: "unavailable" };
  }
}

/**
 * Forget a delivery ID, because its request was refused before anything was done. Only
 * for that: a request that had any effect has to stay consumed. If the store is
 * unavailable, the next consume of the same ID in this process does it first.
 */
export async function releaseWebhookDelivery(
  claim: DeliveryClaim,
): Promise<void> {
  try {
    const client = await connectedClient();
    await client.eval(RELEASE_SCRIPT, 1, claim.key, claim.token);
  } catch (error) {
    console.error(
      "Webhook replay store unavailable — a refused delivery's id is released when it's next used:",
      describeFailure(error),
    );
    strand(claim);
  }
}
