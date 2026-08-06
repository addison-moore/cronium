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

/** Human-actionable message for an HTTP-level (non-JSON-RPC) failure. */
function httpFailureMessage(status: number, body: string): string {
  if (status === 401) {
    return (
      "Cronium rejected the API token (HTTP 401). Check CRONIUM_API_TOKEN — " +
      "create a token with the MCP scope under Settings → API Tokens (tokens expire)."
    );
  }
  const detail = body.slice(0, 300);
  return `Cronium /api/mcp returned HTTP ${status}${detail ? `: ${detail}` : ""}`;
}

/** Forward one raw JSON-RPC message (already parsed) and emit the response. */
async function forward(msg: unknown): Promise<void> {
  const ids = requestIds(msg);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_TOKEN}`,
        accept: "application/json",
      },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // Notifications-only → 202 with no body; nothing to write back.
    if (res.status === 202) return;

    const text = await res.text();
    if (!res.ok) {
      const message = httpFailureMessage(res.status, text);
      console.error(`cronium-mcp: ${message}`);
      for (const id of ids) emit(rpcError(id, -32001, message));
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      const message = `Cronium /api/mcp returned non-JSON: ${text.slice(0, 300)}`;
      console.error(`cronium-mcp: ${message}`);
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
    const cause = err instanceof Error ? err.message : String(err);
    const message =
      `Could not reach Cronium at ${ENDPOINT}: ${cause}. ` +
      "Check CRONIUM_BASE_URL and that the instance is running.";
    console.error(`cronium-mcp: ${message}`);
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
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) {
      console.error(`cronium-mcp: ${httpFailureMessage(401, "")}`);
      process.exit(1);
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
