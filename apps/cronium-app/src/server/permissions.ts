/**
 * Granular permission resolution and enforcement.
 *
 * The UserRole enum (ADMIN/USER/VIEWER) remains the primary gate; these
 * permissions refine what non-admin roles can access. ADMIN bypasses all
 * granular checks. Permissions live in the roles table (jsonb) and are
 * resolved via the user's roleId, falling back to a case-insensitive
 * role-enum name match, then the default role. Missing roles or keys
 * default to DENY.
 */

import { TRPCError } from "@trpc/server";
import { storage } from "@/server/storage";
import type { Role, RolePermissions } from "@/server/storage";
import { UserRole } from "@/shared/schema";

const ALL_GRANTED: RolePermissions = {
  console: true,
  localServerAccess: true,
};

const ALL_DENIED: RolePermissions = {
  console: false,
  localServerAccess: false,
};

function normalizePermissions(role: Role | undefined): RolePermissions {
  if (!role) return ALL_DENIED;
  const permissions = (role.permissions ?? {}) as Partial<RolePermissions>;
  return {
    console: permissions.console ?? false,
    localServerAccess: permissions.localServerAccess ?? false,
  };
}

/**
 * Resolve the effective granular permissions for a user.
 */
export async function getUserPermissions(
  userId: string,
): Promise<RolePermissions> {
  const user = await storage.getUser(userId);
  if (!user) return ALL_DENIED;
  if (user.role === UserRole.ADMIN) return ALL_GRANTED;

  let role: Role | undefined;
  if (user.roleId) {
    role = await storage.getRoleById(user.roleId);
  }
  role ??= await storage.getRoleByName(user.role);
  role ??= await storage.getDefaultRole();

  return normalizePermissions(role);
}

/**
 * Boolean permission check for route handlers and server components.
 */
export async function hasServerPermission(
  userId: string,
  key: keyof RolePermissions,
): Promise<boolean> {
  try {
    const permissions = await getUserPermissions(userId);
    return permissions[key];
  } catch (error) {
    console.error(`Permission check failed for ${userId}/${key}:`, error);
    return false;
  }
}

/**
 * tRPC permission check: throws FORBIDDEN when the user lacks the permission.
 */
export async function requirePermission(
  userId: string,
  key: keyof RolePermissions,
): Promise<void> {
  const allowed = await hasServerPermission(userId, key);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You do not have the '${key}' permission`,
    });
  }
}
