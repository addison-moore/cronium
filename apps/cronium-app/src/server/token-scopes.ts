/**
 * Per-token scopes for least-privilege API / OAuth tokens.
 *
 * Every API/OAuth bearer token carries an explicit scope list; the paths its
 * scopes permit are enforced centrally in `enforceTokenScopes`
 * (src/server/api/trpc.ts). There is no implicit default: a token without a
 * recognized scope is deny-all (legacy unscoped tokens fail closed), and broad
 * access requires the explicit `full` scope (security plan Phase 1.5).
 *
 * `null` scopes exist only for cookie-session (browser) users, who are never
 * scope-limited.
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
 * MCP tools need — the full build→run→inspect→fix→activate loop over events &
 * workflows, discovery, and the credential/server lookups — and nothing else
 * (no admin, no secret reads, no other routers), so an MCP connector token
 * can't act beyond its purpose if leaked. Env-var values, credential secrets,
 * and webhook keys are not readable through any of these paths.
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
    "events.update",
    "events.activate",
    "events.deactivate",
    "events.execute",
    "events.getById",
    "events.getAll",
    "events.getLogs",
    "events.delete",
    "workflows.create",
    "workflows.update",
    "workflows.execute",
    "workflows.getById",
    "workflows.getAll",
    "workflows.getExecutions",
    "workflows.getExecution",
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
