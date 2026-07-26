import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import type { Capability } from "@/server/security/authorization";
import { TokenStatus, type UserRole } from "@/shared/schema";

/** Extract a bearer token from an `Authorization` header, if present. */
export function getBearerToken(headers: Headers): string | null {
  const authHeader =
    headers.get("authorization") ?? headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Validate a raw API token string. Returns the owning user id + token id when
 * the token is active and unexpired, otherwise null. Bumps `lastUsed`.
 * Header-agnostic so both REST (NextRequest) and tRPC (Headers) paths reuse it.
 */
export async function authenticateApiToken(token: string): Promise<{
  userId: string;
  tokenId: number;
  scopes: string[] | null;
} | null> {
  try {
    const apiToken = await storage.getApiTokenByToken(token);

    if (apiToken?.status !== TokenStatus.ACTIVE) {
      return null;
    }
    if (apiToken.expiresAt && apiToken.expiresAt.getTime() < Date.now()) {
      return null;
    }

    // Update last used time
    await storage.updateApiToken(apiToken.id, { lastUsed: new Date() });

    return {
      userId: apiToken.userId,
      tokenId: apiToken.id,
      // A bearer token with no stored scopes is NOT full access: coerce to an
      // explicit empty (deny-all) scope set so legacy unscoped tokens fail
      // closed on scoped transports. New tokens always carry explicit scopes.
      scopes: apiToken.scopes ?? [],
    };
  } catch (error) {
    console.error("Error validating API token:", error);
    return null;
  }
}

/**
 * Middleware to authenticate API requests using API tokens
 * This allows API access without a session
 */
export async function authenticateApiRequest(request: NextRequest): Promise<{
  userId: string;
  authenticated: boolean;
  tokenId?: number;
}> {
  const token = getBearerToken(request.headers);
  if (!token) {
    return { authenticated: false, userId: "" };
  }

  const result = await authenticateApiToken(token);
  if (!result) {
    return { authenticated: false, userId: "" };
  }

  return {
    authenticated: true,
    userId: result.userId,
    tokenId: result.tokenId,
  };
}

/**
 * Helper function to create an error response for API authentication failures
 */
export function createApiAuthErrorResponse(error: string): NextResponse {
  return NextResponse.json(
    { error },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}

export type RestPrincipal =
  | { ok: true; userId: string; role: UserRole }
  | { ok: false; status: 401 | 403 };

/**
 * Single REST authentication + authorization choke point (security plan Phase
 * 1.1/1.2). Resolves the caller from a bearer API token or the NextAuth
 * session, re-checks live status/role/sessionVersion against the database
 * (fail closed), and enforces the route's declared role capability. There is
 * deliberately no fallback principal of any kind: unauthenticated requests are
 * rejected.
 */
export async function authenticateRestPrincipal(
  request: NextRequest,
  capability: Capability,
  // tRPC-equivalent path for this REST route. When the request is authenticated
  // by a *scoped* bearer token, the token's scopes must permit this path — the
  // same policy tRPC enforces (HI-25), so a scoped token can't exceed its scope
  // by switching to the REST transport. Cookie sessions are never scope-limited.
  scopePath?: string,
): Promise<RestPrincipal> {
  // Deferred imports keep this module light for token-only callers and avoid
  // pulling the NextAuth/env graph in at module load (mirrors trpc.ts).
  const { getAuthorizedPrincipal, roleAllowsCapability } =
    await import("@/server/security/authorization");

  let userId: string | null = null;
  let expectedSessionVersion: number | undefined;
  let tokenScopes: string[] | null = null;

  const token = getBearerToken(request.headers);
  const tokenAuth = token ? await authenticateApiToken(token) : null;
  if (tokenAuth) {
    userId = tokenAuth.userId;
    tokenScopes = tokenAuth.scopes;
  } else {
    const [{ getServerSession }, { authOptions }] = await Promise.all([
      import("next-auth"),
      import("@/lib/auth"),
    ]);
    const session = await getServerSession(authOptions);
    const sessionUser = session?.user;
    if (sessionUser?.id) {
      // Sessions issued before the sessionVersion upgrade are rejected.
      if (typeof sessionUser.sessionVersion !== "number") {
        return { ok: false, status: 401 };
      }
      userId = sessionUser.id;
      expectedSessionVersion = sessionUser.sessionVersion;
    }
  }

  if (!userId) {
    return { ok: false, status: 401 };
  }

  // Enforce token scope for bearer-authenticated requests.
  if (tokenScopes !== null && scopePath) {
    const { isPathAllowedForScopes } = await import("@/server/token-scopes");
    if (!isPathAllowedForScopes(tokenScopes, scopePath)) {
      return { ok: false, status: 403 };
    }
  }

  try {
    const principal = await getAuthorizedPrincipal(
      userId,
      expectedSessionVersion === undefined ? {} : { expectedSessionVersion },
    );
    if (!roleAllowsCapability(principal.role, capability)) {
      return { ok: false, status: 403 };
    }
    return { ok: true, userId: principal.id, role: principal.role };
  } catch {
    return { ok: false, status: 401 };
  }
}

export function restPrincipalErrorResponse(
  result: Extract<RestPrincipal, { ok: false }>,
): NextResponse {
  return NextResponse.json(
    { error: result.status === 401 ? "Unauthorized" : "Forbidden" },
    { status: result.status },
  );
}
