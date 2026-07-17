import { getBaseUrl, authServerMetadata } from "@/lib/mcp-oauth/metadata";
import { jsonResponse, corsPreflight } from "@/lib/mcp-oauth/http";

// Served publicly at /.well-known/oauth-authorization-server via a next.config
// rewrite (a literal .well-known route dir isn't picked up by tsc/eslint).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return jsonResponse(authServerMetadata(getBaseUrl(req)));
}

export function OPTIONS(): Response {
  return corsPreflight();
}
