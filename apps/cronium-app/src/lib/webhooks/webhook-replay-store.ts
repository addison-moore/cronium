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
 *
 * Valkey can also stop answering with its connection still open, as a paused container
 * or a network partition does, and the client would wait as long as that lasts. So a
 * request waits at most ANSWER_TIMEOUT_MS, and while Valkey owes an answer to one that
 * stopped waiting, nothing more is sent.
 */

const KEY_PREFIX = "cronium:webhook:delivery:";
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * How long a request waits for Valkey, from asking for the connection to the script's
 * answer, before it's told delivery ids can't be checked. A check takes well under a
 * millisecond, and what holds Valkey up in normal running, such as forking to rewrite
 * its append-only file, takes milliseconds at the 256 MB the shipped Compose file gives
 * it by default. So 2 seconds without an answer means Valkey has stopped answering, and a stall in
 * this process's own event loop would have to last as long to pass for one. It's still
 * soon enough for a sender to hear the 503 long before it would give up on the request,
 * and only requests that reach Valkey before the first of them gives up wait this long:
 * the rest are answered at once (see `unanswered`).
 */
export const ANSWER_TIMEOUT_MS = 2_000;

/**
 * The most stranded claims kept (see `stranded`), oldest dropped first. Since nothing is
 * sent while Valkey owes an answer, a pause strands about one claim for each request
 * that reached Valkey before the first gave up, so this is far more than a pause
 * strands. It's here so that no run of pauses can grow memory without end. A dropped
 * claim's id stays used until it expires, as after a restart.
 */
export const MAX_STRANDED_CLAIMS = 10_000;

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
 * have run, or may run when it answers again. By key, then token, to when the id
 * expires anyway, in the order they were stranded.
 *
 * The next consume of the same id here takes them back in its own script, so a sender
 * keeping its id isn't told it's replaying, and no retry can get there first. Only
 * this process knows they did nothing, so after a restart, or for a request another
 * replica takes, they stay until they expire.
 */
const stranded = new Map<string, Map<string, number>>();
let strandedClaims = 0;

function strand(claim: DeliveryClaim): void {
  const now = Date.now();
  if (claim.expiresAt <= now) return;
  const tokens = stranded.get(claim.key) ?? new Map<string, number>();
  if (!tokens.has(claim.token)) strandedClaims++;
  tokens.set(claim.token, claim.expiresAt);
  stranded.set(claim.key, tokens);

  // Oldest first. Every claim is kept as long, so that's about the order they expire
  // in, and this stops at the first one still needed.
  for (const [key, held] of stranded) {
    for (const [token, expiresAt] of held) {
      if (expiresAt > now && strandedClaims <= MAX_STRANDED_CLAIMS) return;
      if (expiresAt > now) {
        console.error(
          `Webhook replay store is holding ${MAX_STRANDED_CLAIMS} delivery ids it couldn't let go of, so it forgets the oldest, which stays used until ${new Date(expiresAt).toISOString()}`,
        );
      }
      held.delete(token);
      strandedClaims--;
    }
    stranded.delete(key);
  }
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
  for (const token of tokens) {
    if (held.delete(token)) strandedClaims--;
  }
  if (held.size === 0) stranded.delete(key);
}

/**
 * Scripts sent for requests that stopped waiting, which Valkey hasn't answered yet.
 * Nothing more is sent while there are any: the connection answers in order, so a
 * script sent now would only wait behind them, and through a long pause every request
 * would leave one more command queued in the client and one more claim stranded. Each
 * is counted off when Valkey answers it, or when the client gives up on it after
 * losing the connection.
 *
 * The connection isn't dropped to get going again sooner. A paused Valkey still runs
 * what was sent on it once it resumes, possibly after checks sent on a new connection,
 * and taking stranded claims back relies on the order Valkey runs them in.
 */
let unanswered = 0;

/** Thrown when a request has waited ANSWER_TIMEOUT_MS. */
class NoAnswerInTime extends Error {
  constructor() {
    super(`Valkey didn't answer within ${ANSWER_TIMEOUT_MS} ms`);
  }
}

/** Fails with NoAnswerInTime once a request has waited long enough, unless stopped. */
function timeLimit(): { up: Promise<never>; stop: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const up = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NoAnswerInTime()), ANSWER_TIMEOUT_MS);
  });
  // Handled, whatever the request is waiting for when it goes off.
  up.catch(() => undefined);
  return { up, stop: () => clearTimeout(timer) };
}

/**
 * Valkey's answer to a script just sent, or NoAnswerInTime if the request's time runs out
 * first. A script given up on counts as unanswered until it's settled.
 */
async function answerTo<T>(script: Promise<T>, timeUp: Promise<never>) {
  try {
    return await Promise.race([script, timeUp]);
  } catch (error) {
    if (error instanceof NoAnswerInTime) {
      unanswered++;
      const answered = () => {
        unanswered--;
      };
      script.then(answered, answered);
    }
    throw error;
  }
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
 * Throws unless a script sent now can be answered. A client that isn't connected would
 * hold it until it reconnects, and when it can't, fail it the same way as one Valkey
 * ran and whose answer was lost. Not sending it answers at once, and leaves nothing to
 * take back. The same goes while Valkey owes an answer (see `unanswered`).
 */
function readyToSend(client: RedisClient): void {
  if (client.status !== "ready") {
    throw new Error(`Valkey isn't connected (${client.status})`);
  }
  if (unanswered > 0) {
    throw new Error(
      `Valkey hasn't answered ${unanswered} earlier ${unanswered === 1 ? "script" : "scripts"}, so nothing more is sent until it does`,
    );
  }
}

/**
 * Consume a delivery ID once for a webhook: `fresh` the first time the ID is seen
 * (delivery allowed), `used` on replay, and `unavailable` when the store can't be
 * asked, which allows nothing either (fail closed) and leaves the ID unused. Answers
 * within ANSWER_TIMEOUT_MS.
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
  const time = timeLimit();
  let sent = false;
  try {
    const client = await Promise.race([commandClient(), time.up]);
    readyToSend(client);
    sent = true;
    const taken = await answerTo(
      client.eval(
        CONSUME_SCRIPT,
        1,
        claim.key,
        claim.token,
        String(ttlSeconds),
        ...takingBack,
      ),
      time.up,
    );
    takenBack(claim.key, takingBack);
    return taken === 1 ? { outcome: "fresh", claim } : { outcome: "used" };
  } catch (error) {
    console.error(
      "Webhook replay store unavailable — rejecting delivery (fail closed):",
      describeFailure(error),
    );
    // Valkey may have run it and the answer been lost on the way, or be holding it, to
    // run once it answers again.
    if (sent && !answeredWithAnError(error)) strand(claim);
    return { outcome: "unavailable" };
  } finally {
    time.stop();
  }
}

/**
 * Forget a delivery ID, because its request was refused before anything was done. Only
 * for that: a request that had any effect has to stay consumed. If the store is
 * unavailable, or doesn't answer within ANSWER_TIMEOUT_MS, the next consume of the same
 * ID in this process does it first.
 */
export async function releaseWebhookDelivery(
  claim: DeliveryClaim,
): Promise<void> {
  const time = timeLimit();
  try {
    const client = await Promise.race([commandClient(), time.up]);
    readyToSend(client);
    await answerTo(
      client.eval(RELEASE_SCRIPT, 1, claim.key, claim.token),
      time.up,
    );
  } catch (error) {
    console.error(
      "Webhook replay store unavailable — a refused delivery's id is released when it's next used:",
      describeFailure(error),
    );
    strand(claim);
  } finally {
    time.stop();
  }
}
