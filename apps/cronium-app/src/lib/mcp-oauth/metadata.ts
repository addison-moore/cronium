/**
 * URLs, scopes, redirect-URI policy, and discovery-metadata builders for the MCP
 * OAuth server (RFC 8414 authorization-server metadata + RFC 9728
 * protected-resource metadata).
 */
export const SCOPES_SUPPORTED = ["mcp"];
export const DEFAULT_SCOPE = "mcp";

/** Absolute origin of this instance — env override, else the request origin. */
export function getBaseUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (env) return env.replace(/\/+$/, "");
  return new URL(req.url).origin;
}

/** The protected MCP resource identifier (RFC 8707 audience). */
export function resourceUrl(base: string): string {
  return `${base}/api/mcp`;
}

export function resourceMetadataUrl(base: string): string {
  // RFC 9728 path-based well-known for the resource at /api/mcp.
  return `${base}/.well-known/oauth-protected-resource/api/mcp`;
}

/**
 * Allowed redirect URIs: HTTPS anywhere, or HTTP only on loopback (native/CLI
 * clients per RFC 8252). Everything else (http on a real host, non-http schemes)
 * is rejected to prevent open redirects / token leakage.
 */
export function isValidRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (
    u.protocol === "http:" &&
    (u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "[::1]" ||
      u.hostname === "::1")
  ) {
    return true;
  }
  return false;
}

export function resourceMetadata(base: string) {
  return {
    resource: resourceUrl(base),
    authorization_servers: [base],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ["header"],
    resource_documentation: `${base}/api/mcp`,
  };
}

export function authServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/mcp/oauth/authorize`,
    token_endpoint: `${base}/api/mcp/oauth/token`,
    registration_endpoint: `${base}/api/mcp/oauth/register`,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}
