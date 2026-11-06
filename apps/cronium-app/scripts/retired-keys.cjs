/**
 * The one rule for ENCRYPTION_KEYS_RETIRED: unset, empty, or a JSON array of former
 * ENCRYPTION_KEY values, each 64 hex characters.
 *
 * A bad list has to stop a process when it starts, because one that carries on looks
 * healthy while it can't read a secret: webhooks and variables get a 500, env vars read
 * back blank, and saving an event then stores them blank. validate-env.cjs applies this
 * in the image, before anything else starts. src/env.mjs applies it everywhere else:
 * `next start`, the driver, and the worker and socket server when they're run by hand.
 * The code that reads the list uses it too, so all of them agree on what's in it.
 *
 * This is plain CommonJS in scripts/ because validate-env.cjs runs in the image with no
 * build step, and this directory is what the image copies.
 *
 * Nothing here may put the value in a message, not even part of it. A malformed list
 * still holds key material, and JSON.parse's own error quotes its input.
 */

const KEY_FORMAT = /^[0-9a-fA-F]{64}$/;
const KEY_LENGTH = 64;

const EXPECTED =
  "It has to be a JSON array of 64-hex keys in double quotes. In .env, that's ENCRYPTION_KEYS_RETIRED='[\"<old-hex-key>\"]'.";

/**
 * What's wrong with one entry, or null if it's a well-formed key.
 *
 * @param {unknown} entry
 * @returns {string | null}
 */
function entryProblem(entry) {
  if (typeof entry !== "string") return "isn't a string";
  const key = entry.trim();
  if (key.length !== KEY_LENGTH) {
    return `has ${key.length} characters, not ${KEY_LENGTH}`;
  }
  return KEY_FORMAT.test(key)
    ? null
    : `has ${KEY_LENGTH} characters, but they aren't all hex`;
}

/**
 * Reads the variable's value. A reader that can't stop the process can use `keys`, which
 * holds only well-formed keys, however bad the rest of the list is.
 *
 * @param {string | undefined} raw
 * @returns {{ keys: string[], problem: string | null }} the well-formed keys, trimmed,
 *   and what's wrong with the list, to follow the variable's name in a message.
 */
function parseRetiredKeys(raw) {
  if (!raw) return { keys: [], problem: null };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { keys: [], problem: `isn't valid JSON. ${EXPECTED}` };
  }
  if (!Array.isArray(parsed)) {
    return { keys: [], problem: `is JSON, but not an array. ${EXPECTED}` };
  }

  const keys = parsed
    .filter((entry) => entryProblem(entry) === null)
    .map((entry) => entry.trim());
  const firstBad = parsed.findIndex((entry) => entryProblem(entry) !== null);
  if (firstBad === -1) return { keys, problem: null };

  return {
    keys,
    problem: `has an entry that won't work: entry ${firstBad + 1} of ${parsed.length} ${entryProblem(parsed[firstBad])}. ${EXPECTED}`,
  };
}

module.exports = { parseRetiredKeys };
