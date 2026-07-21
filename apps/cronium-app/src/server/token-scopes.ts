/**
 * Per-token scopes for least-privilege API / OAuth tokens.
 *
 * A token (or OAuth access token) may carry a scope list. `null`/absent scopes
 * mean full user rights (the default, and every pre-existing token). A non-null
 * list restricts the token to the tRPC procedure paths its scopes permit —
 * enforced centrally in `enforceTokenScopes` (src/server/api/trpc.ts).
 *
 * Cookie-session (browser) users are never scope-limited.
 */

/**
 * Scopes a user can grant when creating a token. `full` grants the user's
 * complete API rights and is the explicit opt-in for a broad token — chosen
 * deliberately so there is no implicit "no scopes = full access" default
 * (security plan Phase 1.5).
 */
export const API_TOKEN_SCOPES = ["full", "mcp"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export function isApiTokenScope(value: string): value is ApiTokenScope {
  return (API_TOKEN_SCOPES as readonly string[]).includes(value);
}

/**
 * Procedure paths each scope permits. The `mcp` scope covers exactly what the
 * MCP tools need — create/activate/read events & workflows, discovery, and the
 * credential/server lookups — and nothing else (no admin, no secrets, no other
 * routers), so an MCP connector token can't act beyond its purpose if leaked.
 * `full` is handled specially in `isPathAllowedForScopes` (any path).
 */
const SCOPE_PATHS: Record<
  Exclude<ApiTokenScope, "full">,
  ReadonlySet<string>
> = {
  mcp: new Set<string>([
    "mcp.getCapabilities",
    "mcp.validatePlan",
    "events.create",
    "events.activate",
    "events.getById",
    "events.getAll",
    "events.delete",
    "workflows.create",
    "workflows.getById",
    "workflows.getAll",
    "workflows.delete",
    "tools.getAll",
    "servers.getAll",
  ]),
};

/**
 * Whether a token holding `scopes` may call the tRPC procedure at `path`.
 *
 * `scopes === null` → unrestricted. This is reserved for COOKIE SESSIONS
 * (browser users), which are never scope-limited. API/OAuth bearer tokens never
 * reach this function with null: their scopes are coerced to an explicit list
 * (empty = deny-all) at the authentication boundary, so a legacy unscoped token
 * fails closed rather than acting with full rights. An empty array → deny all.
 * The `full` scope → allow any path.
 */
export function isPathAllowedForScopes(
  scopes: readonly string[] | null,
  path: string,
): boolean {
  if (scopes === null) return true;
  if (scopes.includes("full")) return true;
  return scopes.some(
    (s) => isApiTokenScope(s) && s !== "full" && SCOPE_PATHS[s].has(path),
  );
}
