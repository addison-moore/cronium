"use server";

import { hash } from "bcrypt";
import { nanoid } from "nanoid";
import { createHash, timingSafeEqual } from "crypto";
import { sql } from "drizzle-orm";
import { UserRole, UserStatus, roles, users } from "@/shared/schema";
import { storage } from "@/server/storage";
import { db } from "@/server/db";
import { env } from "@/env.mjs";
import { isSetupRequired } from "@/lib/first-run";
import { MIN_PASSWORD_LENGTH } from "@/shared/schemas/password";

/**
 * Whether the first-admin flow requires a bootstrap token. True when the
 * installer provisioned a token hash. Exposed so the setup page can render the
 * token field only when it is actually needed.
 */
export async function isBootstrapTokenRequired(): Promise<boolean> {
  return Boolean(env.BOOTSTRAP_TOKEN_HASH);
}

function bootstrapTokenMatches(token: string): boolean {
  const expected = env.BOOTSTRAP_TOKEN_HASH;
  if (!expected) return true; // No token configured → not required.
  const actual = createHash("sha256").update(token).digest("hex");
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// A fixed key for a Postgres transaction-scoped advisory lock. Serializes
// concurrent first-admin creation so the "zero users" check and the insert are
// effectively atomic (closes the setup TOCTOU: two simultaneous submissions on
// a fresh database could otherwise both pass the check and both create an
// admin). Arbitrary constant, unique to this operation.
const FIRST_ADMIN_LOCK_KEY = 4815162342;

type SetupFormData = {
  username: string;
  email: string;
  password: string;
  bootstrapToken?: string;
};

// Mirrors src/scripts/seed-roles.ts — insert-if-missing only, so the two
// paths (browser setup here, AUTO_SEED_ADMIN in scripts/bootstrap-seed.cjs)
// produce the same defaults.
const DEFAULT_ROLES = [
  {
    name: "Admin",
    description: "Administrators with full access",
    permissions: { console: true, localServerAccess: true },
    isDefault: false,
  },
  {
    name: "User",
    description: "Default role for regular users",
    permissions: { console: true, localServerAccess: false },
    isDefault: true,
  },
  {
    name: "Viewer",
    description: "Read-only users",
    permissions: { console: false, localServerAccess: false },
    isDefault: false,
  },
] as const;

async function ensureDefaultRoles() {
  for (const role of DEFAULT_ROLES) {
    const existing = await db
      .select({ id: roles.id })
      .from(roles)
      .where(sql`lower(${roles.name}) = ${role.name.toLowerCase()}`)
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(roles).values({
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      isDefault: role.isDefault,
    });
  }
}

async function assignDefaultRoleToUnassigned() {
  // Same as the headless bootstrap seed: users without a granular role get
  // the default one.
  await db.execute(sql`
    update users set role_id = (select id from roles where is_default = true limit 1)
    where role_id is null
  `);
}

async function ensureSetting(key: string, value: string) {
  const existing = await storage.getSetting(key);
  if (existing) return;
  await storage.upsertSetting(key, value);
}

export async function createFirstAdmin(formData: SetupFormData) {
  try {
    if (
      !formData.username ||
      formData.username.length < 3 ||
      !formData.email ||
      !formData.password ||
      formData.password.length < MIN_PASSWORD_LENGTH
    ) {
      return { success: false, error: "Invalid setup details." };
    }

    // Require and verify the installer's one-time bootstrap token (HI-05).
    // Constant-time comparison; a wrong/missing token is rejected before any
    // account is created.
    if (env.BOOTSTRAP_TOKEN_HASH) {
      if (
        !formData.bootstrapToken ||
        !bootstrapTokenMatches(formData.bootstrapToken)
      ) {
        return {
          success: false,
          error:
            "Invalid setup token. Use the token shown by the installer at the end of installation.",
        };
      }
    }

    const hashedPassword = await hash(formData.password, 12);

    // Serialize the whole check-and-create under a transaction-scoped advisory
    // lock and re-check "zero users" inside it, so concurrent submissions on a
    // fresh database cannot each create an admin.
    const created = await db.transaction(async (trx) => {
      await trx.execute(
        sql`select pg_advisory_xact_lock(${FIRST_ADMIN_LOCK_KEY})`,
      );

      const [existing] = await trx
        .select({ id: users.id })
        .from(users)
        .limit(1);
      if (existing) return false;

      await trx.insert(users).values({
        id: nanoid(),
        username: formData.username,
        email: formData.email,
        password: hashedPassword,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return true;
    });

    if (!created) {
      return {
        success: false,
        error: "Setup has already been completed. Sign in instead.",
      };
    }

    // Same defaults the headless bootstrap seed applies: registration closed
    // until the admin opens it (the signup path treats a MISSING
    // allowRegistration setting as open).
    await ensureDefaultRoles();
    await assignDefaultRoleToUnassigned();
    await ensureSetting("allowRegistration", "false");
    await ensureSetting("requireAdminApproval", "false");
    await ensureSetting("bootstrapSeedComplete", "true");

    return { success: true };
  } catch (error) {
    console.error("First-run setup error:", error);
    return {
      success: false,
      error: "An unexpected error occurred. Please try again.",
    };
  }
}
