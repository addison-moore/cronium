/**
 * Remote MCP endpoint (Streamable HTTP, JSON-response mode) so the claude.ai web
 * app — and any HTTP MCP client — can create Cronium events/workflows.
 *
 * Auth: strict API-token bearer (claude.ai "custom header" connector auth / any
 * client that sends `Authorization: Bearer <cronium-api-token>`). We authenticate
 * explicitly here (NOT via the dev auto-auth fallback) since this is
 * internet-facing, then run tools through an in-process tRPC caller as that user.
 *
 * This is a stateless JSON-RPC handler: each POST is independent, responses are
 * plain `application/json` (no SSE) — sufficient for these quick, non-streaming
 * create tools. OAuth 2.1 discovery is a follow-up (see _plans/mcp/PLAN.md 3b).
 */
import { db } from "@/server/db";
import { createCaller } from "@/server/api/root";
import { sessionFromApiToken } from "@/server/api/trpc";
import { sessionFromOAuthToken } from "@/lib/mcp-oauth/resource";
import { getBearerToken } from "@/lib/api-auth";
import { getBaseUrl, resourceMetadataUrl } from "@/lib/mcp-oauth/metadata";
import { failureWithStack, messageForCaller } from "@/lib/pg-errors";
import { readBodyWithin } from "@/lib/request-body";
import { CredentialCheckFailedError } from "@/server/security/credential-check";
import {
  EVENT_TOO_LONG_MESSAGE,
  MAX_REQUEST_BODY_BYTES,
} from "@/shared/request-limits";
import { MCP_TOOLS, MCP_TOOL_BY_NAME } from "./tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVER_INFO = { name: "cronium", version: "0.2.0" };
// Tools run sequentially and can execute events, so a batch has to be bounded.
const MAX_BATCH_SIZE = 25;
const DEFAULT_PROTOCOL = "2025-06-18";
const INTERNAL_ERROR = -32603;
const INTERNAL_ERROR_MESSAGE =
  "Internal error: the reason is in Cronium's server log";

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}
function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function baseUrlFrom(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (env) return env.replace(/\/+$/, "");
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

// Handle one JSON-RPC message. Returns null for notifications (no response).
async function handleMessage(
  msg: JsonRpcRequest,
  caller: ReturnType<typeof createCaller>,
  baseUrl: string,
): Promise<object | null> {
  // JSON-RPC bodies are untrusted: `null` or `[null]` parse fine but are not
  // messages, and dereferencing them took the whole request down with a 500.
  if (typeof msg !== "object" || msg === null) {
    return rpcError(null, -32600, "Invalid Request");
  }
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize": {
      const requested =
        (msg.params?.protocolVersion as string) || DEFAULT_PROTOCOL;
      return rpcResult(id, {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notification — no response
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        })),
      });
    case "tools/call": {
      const name = msg.params?.name as string | undefined;
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = name ? MCP_TOOL_BY_NAME.get(name) : undefined;
      if (!tool) {
        return rpcError(id, -32602, `Unknown tool: ${String(name)}`);
      }
      try {
        const out = await tool.handler(caller, args, baseUrl);
        return rpcResult(id, {
          content: [{ type: "text", text: out.text }],
          isError: out.isError ?? false,
        });
      } catch (err) {
        // Tool execution errors are returned as a tool result (isError), not a
        // protocol error, so the model can read and correct them. createCaller
        // skips the error formatter, so nothing else stands in front of this.
        return rpcResult(id, {
          content: [{ type: "text", text: `Error: ${messageForCaller(err)}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    return await handlePost(req);
  } catch (error) {
    // Next's answer to a throw is a 500 with no body, which a client can't tell from a
    // proxy's. The id is null because the body may not have been read, so these aren't
    // a 200, for the same reason as the 413 below.
    if (error instanceof CredentialCheckFailedError) {
      return Response.json(rpcError(null, INTERNAL_ERROR, error.message), {
        status: 503,
      });
    }
    console.error("MCP request failed:", failureWithStack(error));
    return Response.json(
      rpcError(null, INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE),
      {
        status: 500,
      },
    );
  }
}

async function handlePost(req: Request): Promise<Response> {
  // Strict bearer auth (no dev auto-auth on this internet-facing route):
  // accept an OAuth 2.1 access token or a raw Cronium API token. Either may
  // carry scopes that limit what the caller can do.
  const auth =
    (await sessionFromOAuthToken(req.headers)) ??
    (await sessionFromApiToken(req.headers));
  if (!auth) {
    // Point MCP clients at the protected-resource metadata so they can discover
    // the OAuth authorization server (RFC 9728). Flag invalid_token when a
    // (bad/expired) token was supplied, vs. simply missing.
    const hadToken = getBearerToken(req.headers) !== null;
    const challenge =
      `Bearer resource_metadata="${resourceMetadataUrl(getBaseUrl(req))}"` +
      (hadToken
        ? ', error="invalid_token", error_description="The access token is invalid or expired"'
        : "");
    return new Response(
      JSON.stringify({
        error:
          "unauthorized: authenticate with an OAuth access token or a Cronium API token",
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": challenge,
        },
      },
    );
  }

  // No request id to answer with, since the body isn't parsed. So this isn't a 200: a
  // client couldn't match it to its call, and would wait until that timed out.
  const rawBody = await readBodyWithin(req, MAX_REQUEST_BODY_BYTES);
  if (rawBody === null) {
    return Response.json(rpcError(null, -32600, EVENT_TOO_LONG_MESSAGE), {
      status: 413,
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), {
      status: 400,
    });
  }

  const caller = createCaller({
    session: auth.session,
    db,
    headers: req.headers,
    tokenScopes: auth.scopes,
    requestSource: "mcp",
  });
  const baseUrl = baseUrlFrom(req);

  // Support a JSON-RPC batch (array) or a single message.
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length > MAX_BATCH_SIZE) {
    return Response.json(
      rpcError(null, -32600, `Batch limit is ${MAX_BATCH_SIZE} messages`),
      { status: 400 },
    );
  }
  const responses: object[] = [];
  for (const m of messages) {
    try {
      const res = await handleMessage(m as JsonRpcRequest, caller, baseUrl);
      if (res) responses.push(res);
    } catch (error) {
      // Earlier calls in a batch may have run, so this one can't lose their answers.
      console.error("MCP message failed:", failureWithStack(error));
      const { id } = m as JsonRpcRequest;
      responses.push(
        rpcError(id ?? null, INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE),
      );
    }
  }

  // Notifications only → 202 with no body.
  if (responses.length === 0) {
    return new Response(null, { status: 202 });
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  return Response.json(payload, {
    headers: { "mcp-protocol-version": DEFAULT_PROTOCOL },
  });
}

// No server-initiated SSE stream — clients use POST for everything.
export function GET(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { allow: "POST, OPTIONS" },
  });
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "POST, OPTIONS",
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "authorization, content-type, mcp-protocol-version",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}
