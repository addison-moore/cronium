/**
 * The most one request can carry, in bytes. This is the real limit on a script: every way
 * of saving one sends it in a single JSON request with the rest of the event, and nothing
 * else caps it. It counts what's sent, so a line break or a quote takes 2 bytes, and a
 * script of many short lines reaches it well before its own length does.
 *
 * Bodies up to exactly this length have always saved. Past it, Next used to cut them off
 * and leave the route with JSON that ended early. next.config.mjs now puts that cut-off
 * above this, so a longer body still reaches the route longer, and can be refused as such.
 */
export const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

/**
 * The refusal of a save past the limit. It stays general because a route refuses without
 * parsing the body, so it can't tell which field is long. It's short enough for the MCP
 * bridge to pass on whole: it quotes the first 300 characters of a failed response.
 */
export const EVENT_TOO_LONG_MESSAGE =
  "This event is too long to save, usually because of its script. One request can carry at most 10 MB, counted as JSON, where each line break or quote takes 2 bytes.";

/** The same refusal for a request that isn't saving an event. */
export const REQUEST_TOO_LONG_MESSAGE = "Request body too large (max 10 MB)";
