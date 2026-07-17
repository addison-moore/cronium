import { getBaseUrl, resourceMetadata } from "@/lib/mcp-oauth/metadata";
import { jsonResponse, corsPreflight } from "@/lib/mcp-oauth/http";

// Served publicly at /.well-known/oauth-protected-resource (and the
// /api/mcp-suffixed RFC 9728 variant) via next.config rewrites.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return jsonResponse(resourceMetadata(getBaseUrl(req)));
}

export function OPTIONS(): Response {
  return corsPreflight();
}
