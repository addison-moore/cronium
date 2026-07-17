import { isValidRedirectUri } from "@/lib/mcp-oauth/metadata";
import { randomId } from "@/lib/mcp-oauth/tokens";
import { registerClient, type OAuthClient } from "@/lib/mcp-oauth/store";
import { jsonResponse, oauthError, corsPreflight } from "@/lib/mcp-oauth/http";

// RFC 7591 Dynamic Client Registration for the MCP OAuth server. Public clients
// only (PKCE, no secret). Separate from /api/oauth/* (outbound tool OAuth).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return oauthError("invalid_request", "Body must be JSON");
  }

  const redirectUris = body.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    !redirectUris.every((u) => typeof u === "string" && isValidRedirectUri(u))
  ) {
    return oauthError(
      "invalid_redirect_uri",
      "redirect_uris must be a non-empty array of HTTPS (or loopback HTTP) URLs",
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
