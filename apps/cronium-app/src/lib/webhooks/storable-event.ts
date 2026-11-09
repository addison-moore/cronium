/**
 * What Postgres can store of an event that came in at an inbound endpoint. It goes into
 * two `webhook_events` rows: the endpoint's own, under its name, and the one its
 * deliveries go out on, as `webhook.<name>`. Postgres refuses some of what a request can
 * carry, and it refuses it on every attempt, so the endpoint checks before it writes
 * anything and tells the sender what's wrong, rather than answering 500 each time.
 */

/** What deliveries call an event that came in at an inbound endpoint. */
export const INBOUND_EVENT_PREFIX = "webhook.";

/** `webhook_events.event` is a varchar(255), and Postgres counts its characters. */
const EVENT_COLUMN_CHARS = 255;

/**
 * The longest name a request can give its event, so that `webhook.<name>` fits too. A
 * longer one is refused even when nothing subscribes to it yet, because then it could
 * never be delivered, and so a sender's answer doesn't depend on who subscribes.
 */
export const MAX_INBOUND_EVENT_NAME_CHARS =
  EVENT_COLUMN_CHARS - INBOUND_EVENT_PREFIX.length;

/**
 * NUL, which Postgres refuses in any text, and half of a surrogate pair on its own, which
 * `jsonb` refuses. Only JSON can carry the second, with an escape such as `\ud83d`: other
 * bodies and headers are read as text, which replaces anything that isn't valid.
 */
const UNSTORABLE_CHARACTER = /[\u0000\p{Cs}]/u;

/** Why Postgres would refuse this event, said for its sender, or undefined if it wouldn't. */
export function unstorableEvent(
  name: string,
  payload: Record<string, unknown>,
): string | undefined {
  const characters = characterCount(name);
  if (characters > MAX_INBOUND_EVENT_NAME_CHARS) {
    return `This event's name is too long: it has ${characters} characters, and the limit is ${MAX_INBOUND_EVENT_NAME_CHARS}.`;
  }

  const found = firstUnstorableCharacter([name, payload]);
  if (found === undefined) return undefined;
  if (found === "\u0000") {
    return "This event can't be stored: it has a NUL character (U+0000), which Postgres doesn't allow in text.";
  }
  const codeUnit = found.charCodeAt(0).toString(16).toUpperCase();
  return `This event can't be stored: it has half of a UTF-16 surrogate pair (U+${codeUnit}) on its own, which isn't valid Unicode.`;
}

/** Characters as Postgres counts them: an emoji is one, where `length` says two. */
function characterCount(text: string): number {
  let count = 0;
  for (const _character of text) count++;
  return count;
}

/**
 * The first character Postgres can't store anywhere in a value from JSON, keys included.
 * Without recursion, so how deep a request nests can't make this fail.
 */
function firstUnstorableCharacter(value: unknown): string | undefined {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next === "string") {
      const found = UNSTORABLE_CHARACTER.exec(next);
      if (found) return found[0];
    } else if (Array.isArray(next)) {
      for (const item of next as unknown[]) pending.push(item);
    } else if (typeof next === "object" && next !== null) {
      for (const [key, item] of Object.entries(next)) pending.push(key, item);
    }
  }
  return undefined;
}
