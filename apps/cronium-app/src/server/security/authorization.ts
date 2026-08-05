import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { cacheService } from "@/lib/cache/cache-service";
import { users, UserRole, UserStatus } from "@/shared/schema";

/**
 * Central deny-by-default authorization for every transport (tRPC, REST,
 * server actions, Socket.IO, MCP, webhook dispatch, execution dispatch).
 *
 * Two questions are answered here:
 *  1. Is this principal still valid right now? (`getAuthorizedPrincipal`) —
 *     re-reads status/role/sessionVersion instead of trusting values frozen
 *     into a JWT or bearer token at issuance.
 *  2. May this role perform this capability? (`assertRoleCapability`) —
 *     resource-level ownership stays in resource-access.ts; this layer decides
 *     what a role may ever do, regardless of ownership.
 */

export type Capability =
  "view" | "fork" | "edit" | "execute" | "use-secret" | "admin";

export interface AuthorizedPrincipal {
  id: string;
  role: UserRole;
  roleId: number | null;
  status: UserStatus;
  sessionVersion: number;
  mfaEnabled: boolean;
}

/**
 * Whether Admin accounts must have MFA enabled to perform admin operations.
 * Enforced by default in production; relaxed in development unless explicitly
 * set (so the dev auto-admin is not locked out).
 */
export function isAdminMfaEnforced(): boolean {
  const value = process.env.CRONIUM_ENFORCE_ADMIN_MFA;
  if (value === "true") return true;
  if (value === "false") return false;
  return process.env.NODE_ENV === "production";
}

/**
 * Deny-by-default role matrix. A role not listed here (or a capability not
 * listed for a role) is denied. Admin has no implicit secret-use bypass:
 * "admin" here gates platform administration procedures; resource-level
 * secret use is still ownership-checked at execution/resolution time.
 */
const ROLE_CAPABILITIES: Record<string, readonly Capability[]> = {
  [UserRole.ADMIN]: ["view", "fork", "edit", "execute", "use-secret", "admin"],
  [UserRole.USER]: ["view", "fork", "edit", "execute", "use-secret"],
  [UserRole.VIEWER]: ["view"],
};

export function roleAllowsCapability(
  role: string,
  capability: Capability,
): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

export function assertRoleCapability(
  role: string,
  capability: Capability,
): void {
  if (!roleAllowsCapability(role, capability)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your role does not permit this action`,
    });
  }
}

const PRINCIPAL_CACHE_PREFIX = "principal:v1:";
// Short shared cache to absorb per-request reads. Revocation deletes the key
// through the shared cache, so this TTL only bounds staleness when an
// invalidation is lost, not the normal revocation latency.
const PRINCIPAL_CACHE_TTL_SECONDS = 15;

function principalCacheKey(userId: string): string {
  return `${PRINCIPAL_CACHE_PREFIX}${userId}`;
}

async function loadPrincipal(
  userId: string,
): Promise<AuthorizedPrincipal | null> {
  const cached = await cacheService
    .get<AuthorizedPrincipal>(principalCacheKey(userId))
    .catch(() => null);
  if (cached?.id === userId) return cached;

  const [row] = await db
    .select({
      id: users.id,
      role: users.role,
      roleId: users.roleId,
      status: users.status,
      sessionVersion: users.sessionVersion,
      mfaEnabled: users.mfaEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;

  await cacheService
    .set(principalCacheKey(userId), row, { ttl: PRINCIPAL_CACHE_TTL_SECONDS })
    .catch(() => false);
  return row;
}

/**
 * Remove a user's cached principal so the next sensitive request re-reads the
 * database. Call this in the same security event that changes status, role, or
 * sessionVersion. The cache lives in shared Valkey, so all replicas converge.
 */
export async function invalidatePrincipal(userId: string): Promise<void> {
  await cacheService.delete(principalCacheKey(userId)).catch(() => false);
}

export class PrincipalRevokedError extends TRPCError {
  constructor(message: string) {
    super({ code: "UNAUTHORIZED", message });
  }
}

/**
 * Resolve the live principal for a request and fail closed.
 *
 * Throws UNAUTHORIZED when the user no longer exists, is not ACTIVE, the
 * expected session version no longer matches (password/role/status changed
 * since the session or token was issued), or current state cannot be
 * established at all (database unreachable).
 */
export async function getAuthorizedPrincipal(
  userId: string,
  options: { expectedSessionVersion?: number } = {},
): Promise<AuthorizedPrincipal> {
  if (!userId) {
    throw new PrincipalRevokedError("No authenticated user");
  }

  let principal: AuthorizedPrincipal | null;
  try {
    principal = await loadPrincipal(userId);
  } catch {
    // Sensitive actions must fail closed when current state is unknowable.
    throw new PrincipalRevokedError("Unable to verify account status");
  }

  if (!principal) {
    throw new PrincipalRevokedError("Account no longer exists");
  }
  if (principal.status !== UserStatus.ACTIVE) {
    throw new PrincipalRevokedError("Account is not active");
  }
  if (
    options.expectedSessionVersion !== undefined &&
    principal.sessionVersion !== options.expectedSessionVersion
  ) {
    throw new PrincipalRevokedError("Session is no longer valid");
  }
  return principal;
}
