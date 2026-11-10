/**
 * What Postgres can store of an event that came in at an inbound endpoint. It goes into
 * two `webhook_events` rows: the endpoint's own, under its name, and the one its
 * deliveries go out on, as `webhook.<name>`. Postgres refuses some of what a request can
 * carry, and it refuses it on every attempt, so the endpoint checks before it writes
 * anything and tells the sender what's wrong, rather than answering 500 each time.
 *
 * The same goes for JSON nested deeper than Cronium's own code can walk, which fails
 * long before Postgres would.
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

/**
 * How deep a request's JSON can nest, counting each array or object as a level, so
 * `{"items":[1]}` is 2 deep. Processing an event walks it recursively, and so do
 * `String`, `JSON.stringify`, and the superjson `webhookSystem.getEventHistory` answers
 * through. Each throws once it runs out of stack, on every attempt. On Node 22, through
 * a production build, the history gave out first, for an event 921 levels deep, then
 * the endpoint itself at 2,117 (Postgres's `jsonb` took 15,000). This leaves room
 * under both for other platforms and versions, and is far deeper than events go.
 */
export const MAX_INBOUND_JSON_DEPTH = 256;

/** Why a request's body nests too deep to process, said for its sender, or undefined. */
export function tooDeeplyNested(body: unknown): string | undefined {
  const depth = nestingDepth(body);
  if (depth <= MAX_INBOUND_JSON_DEPTH) return undefined;
  return `This event is nested too deeply: it has arrays and objects ${depth.toLocaleString("en-US")} levels deep, and the limit is ${MAX_INBOUND_JSON_DEPTH}.`;
}

/**
 * How many arrays and objects deep a value from JSON goes: 0 for a string or a number,
 * 1 for `{}` or `[1]`. A level at a time, without recursion, so how deep it goes can't
 * make this fail.
 */
function nestingDepth(value: unknown): number {
  let depth = 0;
  let level: object[] = isContainer(value) ? [value] : [];
  while (level.length > 0) {
    depth++;
    const inside: object[] = [];
    for (const container of level) {
      for (const item of Array.isArray(container)
        ? (container as unknown[])
        : Object.values(container)) {
        if (isContainer(item)) inside.push(item);
      }
    }
    level = inside;
  }
  return depth;
}

function isContainer(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
