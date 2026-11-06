#!/usr/bin/env node
/**
 * cronium-mcp — a thin stdio ↔ HTTP bridge to a Cronium instance's /api/mcp
 * endpoint (Streamable HTTP, stateless JSON mode).
 *
 * The MCP tools are defined once, inside the app
 * (apps/cronium-app/src/app/api/mcp/tools.ts). This process just forwards each
 * JSON-RPC message arriving on stdin to `POST <CRONIUM_BASE_URL>/api/mcp` with
 * `Authorization: Bearer <CRONIUM_API_TOKEN>` and writes the JSON response back
 * to stdout — which is exactly the MCP stdio transport (newline-delimited
 * JSON-RPC). Claude Desktop / Claude Code and any stdio-only client get the
 * same tool surface as remote clients, with no duplicated definitions.
 *
 * No runtime dependencies: framing is newline-delimited JSON and transport is
 * global fetch (Node 18+).
 */

const BASE_URL = process.env.CRONIUM_BASE_URL;
const API_TOKEN = process.env.CRONIUM_API_TOKEN;

if (!BASE_URL || !API_TOKEN) {
  console.error(
    "cronium-mcp: set CRONIUM_BASE_URL (e.g. http://localhost:5001) and " +
      "CRONIUM_API_TOKEN (create an MCP-scoped token in Cronium → Settings → API Tokens).",
  );
  process.exit(1);
}

const ENDPOINT = `${BASE_URL.replace(/\/+$/, "")}/api/mcp`;
const REQUEST_TIMEOUT_MS = 120_000;
const PROXY_CAUSES =
  "Cronium may be restarting, or a reverse proxy in front of it can't reach it.";

type JsonRpcId = string | number | null;

/** Write one JSON-RPC message to stdout (single atomic line write). */
function emit(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function rpcError(id: JsonRpcId, code: number, message: string): object {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Extract the request id(s) so HTTP-level failures can be answered with a
 * proper JSON-RPC error. Notifications (no id) get no response.
 */
function requestIds(msg: unknown): JsonRpcId[] {
  const one = (m: unknown): JsonRpcId[] => {
    if (m && typeof m === "object" && "id" in m) {
      const id = (m as { id: unknown }).id;
      if (typeof id === "string" || typeof id === "number" || id === null) {
        // Responses have no `method`; never answer a response with an error.
        return "method" in m ? [id] : [];
      }
    }
    return [];
  };
  return Array.isArray(msg) ? msg.flatMap(one) : one(msg);
}

/**
 * A response body if it's JSON-RPC, one message or a batch of them, and otherwise undefined.
 * This is how the bridge tells Cronium from anything else in front of it. It goes by the body,
 * not the status or the content type, because /api/mcp itself answers at 200, 400 and 413, a
 * proxy's page can come at 200, and real Kong answers in JSON, at 200 as well. The route's
 * other answers, its 401 and its empty 202 for notifications, go by their status.
 */
function parseJsonRpc(body: string): unknown {
  const isMessage = (value: unknown): boolean =>
    (value as { jsonrpc?: unknown } | null)?.jsonrpc === "2.0";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const isJsonRpc = Array.isArray(parsed)
    ? parsed.length > 0 && parsed.every(isMessage)
    : isMessage(parsed);
  return isJsonRpc ? parsed : undefined;
}

/** Whether this message, or one in a batch, is a tool call: nothing else here changes anything. */
function hasToolCall(msg: unknown): boolean {
  const isCall = (m: unknown): boolean =>
    (m as { method?: unknown } | null)?.method === "tools/call";
  return Array.isArray(msg) ? msg.some(isCall) : isCall(msg);
}

/**
 * Where a redirect was going. It leaves out the query, which on the way to a sign-in page is
 * long and says nothing to whoever reads this.
 */
function redirectTarget(res: Response): string {
  const location = res.headers.get("location");
  if (!location) return "";
  try {
    const target = new URL(location, ENDPOINT);
    return ` to ${target.origin}${target.pathname}`;
  } catch {
    return "";
  }
}

/** A 3xx or 4xx is a refusal. Anything else can come after Cronium acted on the request. */
function isRefusal(status: number): boolean {
  return status >= 300 && status < 500;
}

/** Says what happened and why it might have, and warns an agent about to repeat a tool call. */
function failureMessage(
  what: string,
  causes: string,
  mayHaveGoneThrough: boolean,
): string {
  return mayHaveGoneThrough
    ? `${what}, so this call may still have gone through: check before repeating it. ${causes}`
    : `${what}. ${causes}`;
}

/**
 * What to say when something other than Cronium answers. All the bridge knows is the status and
 * that the body isn't Cronium's, so it offers causes without choosing one, and it leaves out the
 * body, because an MCP client hands this to an agent. nginx giving up early gave a real 504, and
 * with `error_page` a real 200, with the event saved, so a tool call says it may have gone through
 * unless it was refused.
 */
function notCroniumMessage(res: Response, isToolCall: boolean): string {
  const isRedirect = res.status >= 300 && res.status < 400;
  const answer = `Got HTTP ${res.status}${isRedirect ? redirectTarget(res) : ""}, not Cronium's answer`;
  const causes =
    res.status >= 500
      ? PROXY_CAUSES
      : "It may be from a reverse proxy, firewall or sign-in page, or CRONIUM_BASE_URL may be wrong.";
  return failureMessage(answer, causes, isToolCall && !isRefusal(res.status));
}

/** Human-actionable message for an HTTP answer that can't be passed on as it is. */
function httpFailureMessage(
  res: Response,
  body: string,
  isToolCall: boolean,
): string {
  if (res.status === 401) {
    return (
      "Cronium rejected the API token (HTTP 401). Check CRONIUM_API_TOKEN — " +
      "create a token with the MCP scope under Settings → API Tokens (tokens expire)."
    );
  }
  if (parseJsonRpc(body) !== undefined) {
    return `Cronium /api/mcp returned HTTP ${res.status}: ${body.slice(0, 300)}`;
  }
  // Cronium never saw this one, and the proxy's own page, such as nginx's HTML, doesn't say
  // what to do about it.
  if (res.status === 413) {
    return (
      "A reverse proxy in front of Cronium refused this request as too long (HTTP 413). " +
      "It should allow up to 10 MB, as Cronium does. In nginx, that's client_max_body_size."
    );
  }
  return notCroniumMessage(res, isToolCall);
}

/** Logs a failure, with the start of a body that isn't Cronium's, which only the log gets. */
function logFailure(message: string, body: string): void {
  console.error(`cronium-mcp: ${message}`);
  if (parseJsonRpc(body) === undefined) {
    console.error(
      `cronium-mcp: the answer began ${JSON.stringify(body.slice(0, 300))}`,
    );
  }
}

/** The reason fetch gives for a failure, on the error's `cause`. */
type FailureCause = {
  code?: unknown;
  syscall?: unknown;
  message?: unknown;
  errors?: unknown;
};

/**
 * Causes that mean no request went out, other than failing to look up or connect. By code: undici's
 * limit of 10 seconds to connect, an address that doesn't parse, `https://` to a port that speaks
 * http, and a refused certificate, which has many codes, most of them saying CERT. By message, since
 * fetch gives these no code: a scheme it doesn't speak, and the ports it blocks, 6000 among them.
 */
const NEVER_SENT_CODE =
  /^(UND_ERR_CONNECT_TIMEOUT|ERR_INVALID_URL|ERR_SSL_WRONG_VERSION_NUMBER|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$|CERT/;
const NEVER_SENT_MESSAGE = /^(unknown scheme|bad port)$/;

/**
 * Whether a request with no answer can't have left this machine. This goes by what Node really
 * reports, measured on Node 18, 22 and 24 on macOS and Linux. Anything else counts as possibly
 * sent, unknown causes included, because an agent told it may have gone through checks first, and
 * one told it couldn't reach Cronium repeats the call.
 *
 * `syscall` is what shows a failed connection, not `code`: ETIMEDOUT really comes as `connect` and
 * as `read`, and the second is a connection already made. Node 20 and later try each address of a
 * name, and report the attempts in `errors`.
 */
function neverSent(err: unknown): boolean {
  const { name, cause } = (err ?? {}) as {
    name?: unknown;
    cause?: FailureCause;
  };
  // fetch wouldn't start, as for a token that can't go in a header. A timeout has no cause either.
  if (!cause) return name === "TypeError";
  const attempts: FailureCause[] = Array.isArray(cause.errors)
    ? cause.errors
    : [cause];
  return (
    attempts.every(
      (a) => a.syscall === "getaddrinfo" || a.syscall === "connect",
    ) ||
    NEVER_SENT_CODE.test(String(cause.code)) ||
    NEVER_SENT_MESSAGE.test(String(cause.message))
  );
}

/**
 * What to say when no whole answer came. `status` is the answer's, if that much of it arrived.
 * Only a request that can't have left says it couldn't reach Cronium: with nginx closing the
 * connection after the request reached the app, all 8 calls read that, and 3 of the 8 events were
 * saved.
 */
function noAnswerMessage(
  err: unknown,
  status: number | undefined,
  isToolCall: boolean,
): string {
  if (status !== undefined) {
    return failureMessage(
      `Got HTTP ${status}, but not the whole answer`,
      PROXY_CAUSES,
      isToolCall && !isRefusal(status),
    );
  }
  if (neverSent(err)) {
    const reason = err instanceof Error ? err.message : String(err);
    return (
      `Could not reach Cronium at ${ENDPOINT}: ${reason}. ` +
      "Check CRONIUM_BASE_URL and that the instance is running."
    );
  }
  if ((err as { name?: unknown } | null)?.name === "TimeoutError") {
    return failureMessage(
      `Got no answer from Cronium in ${REQUEST_TIMEOUT_MS / 1000} seconds`,
      "Cronium may still be working on it, or a reverse proxy in front of it may be holding it up.",
      isToolCall,
    );
  }
  return failureMessage(
    "The connection to Cronium closed with no answer",
    "Cronium may be restarting, a reverse proxy in front of it can't reach it, or CRONIUM_BASE_URL may be wrong.",
    isToolCall,
  );
}

/** Logs a request with no answer, with Node's reason for it, which only the log gets. */
function logNoAnswer(message: string, err: unknown): void {
  console.error(`cronium-mcp: ${message}`);
  const cause = (err as { cause?: FailureCause } | null)?.cause;
  if (cause) {
    const reason = [cause.code, cause.message].filter(Boolean).join(": ");
    console.error(
      `cronium-mcp: the cause was ${reason.replace(/\s+/g, " ").trim()}`,
    );
  }
}

/** Forward one raw JSON-RPC message (already parsed) and emit the response. */
async function forward(msg: unknown): Promise<void> {
  const ids = requestIds(msg);
  let status: number | undefined;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_TOKEN}`,
        accept: "application/json",
      },
      body: JSON.stringify(msg),
      // Cronium never redirects this. Following one would turn a call into a GET, or send it
      // on without the token, and then whatever answered that would be taken for the answer.
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    status = res.status;

    // Notifications-only → 202 with no body; nothing to write back. Cronium doesn't answer a
    // request with one, and a client would wait for an answer that isn't coming.
    if (res.status === 202 && ids.length === 0) return;

    const text = await res.text();
    const payload = parseJsonRpc(text);
    if (!res.ok || payload === undefined) {
      const message = httpFailureMessage(res, text, hasToolCall(msg));
      logFailure(message, text);
      for (const id of ids) emit(rpcError(id, -32001, message));
      return;
    }

    // A batch response is an array of messages; write each on its own line
    // (the stdio transport has no batch framing).
    if (Array.isArray(payload)) {
      for (const item of payload) emit(item);
    } else {
      emit(payload);
    }
  } catch (err) {
    const message = noAnswerMessage(err, status, hasToolCall(msg));
    logNoAnswer(message, err);
    for (const id of ids) emit(rpcError(id, -32001, message));
  }
}

/**
 * Startup probe: a `ping` round-trip validates the URL and token immediately,
 * so a bad configuration fails at connect time (visible in the client) rather
 * than on the first tool call mid-conversation.
 */
async function probe(): Promise<void> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "probe", method: "ping" }),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text();
    if (res.status === 401) {
      logFailure(httpFailureMessage(res, body, false), body);
      process.exit(1);
    }
    if (parseJsonRpc(body) === undefined) {
      const message = httpFailureMessage(res, body, false);
      logFailure(`warning — ${message} Will retry per request.`, body);
      return;
    }
    console.error(`cronium-mcp: connected to ${ENDPOINT}`);
  } catch (err) {
    // The instance may simply not be up yet; keep running — each request
    // will report the connection failure.
    const cause = err instanceof Error ? err.message : String(err);
    console.error(
      `cronium-mcp: warning — could not reach ${ENDPOINT} (${cause}); will retry per request.`,
    );
  }
}

/** Newline-delimited JSON framing over stdin. */
function main(): void {
  // In-flight forwards, so stdin closing doesn't drop pending responses.
  const inFlight = new Set<Promise<void>>();
  const track = (p: Promise<void>): void => {
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
  };

  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;

      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        emit(rpcError(null, -32700, "Parse error"));
        continue;
      }
      // Concurrent, not serialized: responses are matched by id, order need
      // not be preserved, and one slow tool call must not block the next.
      track(forward(msg));
    }
  });
  process.stdin.on("end", () => {
    // Client closed our stdin: finish what's outstanding, then exit.
    void Promise.allSettled([...inFlight]).then(() => process.exit(0));
  });
  void probe();
}

main();
