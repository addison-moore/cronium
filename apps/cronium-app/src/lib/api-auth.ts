import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import type { Capability } from "@/server/security/authorization";
import {
  CREDENTIAL_CHECK_FAILED_MESSAGE,
  CredentialCheckFailedError,
  checkingCredentials,
} from "@/server/security/credential-check";
import { TokenStatus, type UserRole } from "@/shared/schema";
import { failureWithStack } from "@/lib/pg-errors";

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
 * the token is active and unexpired, otherwise null, which means it was looked at
 * and isn't good. Throws CredentialCheckFailedError when the lookup fails, which
 * means nothing is known about it. Bumps `lastUsed`.
 * Header-agnostic so both REST (NextRequest) and tRPC (Headers) paths reuse it.
 */
export async function authenticateApiToken(token: string): Promise<{
  userId: string;
  tokenId: number;
  scopes: string[] | null;
} | null> {
  const apiToken = await checkingCredentials("Error validating API token", () =>
    storage.getApiTokenByToken(token),
  );

  if (apiToken?.status !== TokenStatus.ACTIVE) {
    return null;
  }
  if (apiToken.expiresAt && apiToken.expiresAt.getTime() < Date.now()) {
    return null;
  }

  // Only a record of its use, and the token has passed by now, so a database that
  // reads but won't write, as during a failover, doesn't turn it away.
  try {
    await storage.updateApiToken(apiToken.id, { lastUsed: new Date() });
  } catch (error) {
    console.error("Error recording API token use:", failureWithStack(error));
  }

  return {
    userId: apiToken.userId,
    tokenId: apiToken.id,
    // A bearer token with no stored scopes is NOT full access: coerce to an
    // explicit empty (deny-all) scope set so legacy unscoped tokens fail
    // closed on scoped transports. New tokens always carry explicit scopes.
    scopes: apiToken.scopes ?? [],
  };
}

export type RestPrincipal =
  | {
      ok: true;
      userId: string;
      role: UserRole;
      /** The bearer token's scopes; null for a cookie session. */
      scopes: string[] | null;
    }
  | { ok: false; status: 401 | 403 | 503 };

/**
 * Single REST authentication + authorization choke point (security plan Phase
 * 1.1/1.2). Resolves the caller from a bearer API token or the NextAuth
 * session, re-checks live status/role/sessionVersion against the database
 * (fail closed), and enforces the route's declared role capability. There is
 * deliberately no fallback principal of any kind: unauthenticated requests are
 * rejected. Credentials that couldn't be checked are refused too, with a 503 because
 * that says nothing about them.
 */
export async function authenticateRestPrincipal(
  request: NextRequest,
  capability: Capability,
  // tRPC-equivalent path for this REST route. When the request is authenticated
  // by a bearer token, the token's scopes must permit this path — the same policy
  // tRPC enforces (HI-25), so a scoped token can't exceed its scope by switching
  // to the REST transport. A route that declares no path is reachable only by a
  // `full` token: omitting the argument must never mean "any token will do".
  // Cookie sessions are never scope-limited.
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
  let tokenAuth: Awaited<ReturnType<typeof authenticateApiToken>>;
  try {
    tokenAuth = token ? await authenticateApiToken(token) : null;
  } catch (error) {
    if (error instanceof CredentialCheckFailedError) {
      return { ok: false, status: 503 };
    }
    throw error;
  }
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
  if (tokenScopes !== null) {
    const { isPathAllowedForScopes } = await import("@/server/token-scopes");
    const allowed = scopePath
      ? isPathAllowedForScopes(tokenScopes, scopePath)
      : tokenScopes.includes("full");
    if (!allowed) {
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
    return {
      ok: true,
      userId: principal.id,
      role: principal.role,
      scopes: tokenScopes,
    };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof CredentialCheckFailedError ? 503 : 401,
    };
  }
}

const REST_REFUSALS = {
  401: "Unauthorized",
  403: "Forbidden",
  503: CREDENTIAL_CHECK_FAILED_MESSAGE,
};

export function restPrincipalErrorResponse(
  result: Extract<RestPrincipal, { ok: false }>,
): NextResponse {
  return NextResponse.json(
    { error: REST_REFUSALS[result.status] },
    { status: result.status },
  );
}
