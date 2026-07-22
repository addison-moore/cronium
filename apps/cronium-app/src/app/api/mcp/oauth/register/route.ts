import { isValidRedirectUri } from "@/lib/mcp-oauth/metadata";
import { randomId } from "@/lib/mcp-oauth/tokens";
import { registerClient, type OAuthClient } from "@/lib/mcp-oauth/store";
import { jsonResponse, oauthError, corsPreflight } from "@/lib/mcp-oauth/http";
import { consumeAtomicRateLimit } from "@/lib/security/atomic-rate-limiter";
import { clientIpFromHeaders } from "@/lib/security/client-ip";

// RFC 7591 Dynamic Client Registration for the MCP OAuth server. Public clients
// only (PKCE, no secret). Separate from /api/oauth/* (outbound tool OAuth).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// This endpoint is unauthenticated (DCR is open by design), so bound every input
// (Phase 4.1): a request body cap, an IP rate limit, and caps on the array and
// string fields so a caller cannot exhaust memory or the registration store.
const MAX_BODY_BYTES = 8 * 1024;
const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LEN = 2048;
const MAX_CLIENT_NAME_LEN = 255;

export async function POST(req: Request): Promise<Response> {
  // Rate-limit registrations per client IP (fail-closed atomic limiter).
  const ip = clientIpFromHeaders(req.headers) ?? "unknown";
  const limit = await consumeAtomicRateLimit(ip, "mcp-dcr", {
    maxRequests: 10,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return oauthError(
      "invalid_request",
      "Too many registration requests; retry later",
      429,
    );
  }

  // Cap the body before parsing so a huge payload can't be buffered.
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return oauthError("invalid_request", "Request body too large");
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return oauthError("invalid_request", "Body must be JSON");
  }

  const redirectUris = body.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > MAX_REDIRECT_URIS ||
    !redirectUris.every(
      (u) =>
        typeof u === "string" &&
        u.length <= MAX_REDIRECT_URI_LEN &&
        isValidRedirectUri(u),
    )
  ) {
    return oauthError(
      "invalid_redirect_uri",
      `redirect_uris must be a non-empty array (max ${MAX_REDIRECT_URIS}) of HTTPS (or loopback HTTP) URLs`,
    );
  }

  if (
    body.client_name !== undefined &&
    (typeof body.client_name !== "string" ||
      body.client_name.length > MAX_CLIENT_NAME_LEN)
  ) {
    return oauthError(
      "invalid_client_metadata",
      `client_name must be a string of at most ${MAX_CLIENT_NAME_LEN} characters`,
    );
  }

  const authMethod = (body.token_endpoint_auth_method as string) ?? "none";
  if (authMethod !== "none") {
    return oauthError(
      "invalid_client_metadata",
      "Only token_endpoint_auth_method 'none' (public client + PKCE) is supported",
    );
  }

  const client: OAuthClient = {
    client_id: `mcp_${randomId(18)}`,
    redirect_uris: redirectUris as string[],
    client_name:
      typeof body.client_name === "string" ? body.client_name : undefined,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    created_at: Math.floor(Date.now() / 1000),
  };
  await registerClient(client);

  return jsonResponse(
    {
      client_id: client.client_id,
      client_id_issued_at: client.created_at,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: client.grant_types,
      response_types: client.response_types,
      ...(client.client_name ? { client_name: client.client_name } : {}),
    },
    201,
  );
}

export function OPTIONS(): Response {
  return corsPreflight();
}
