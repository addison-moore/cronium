"use server";

import { hash } from "bcrypt";
import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";
import { UserRole, UserStatus, roles } from "@/shared/schema";
import { storage } from "@/server/storage";
import { db } from "@/server/db";
import { isSetupRequired } from "@/lib/first-run";

type SetupFormData = {
  username: string;
  email: string;
  password: string;
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
    if (!(await isSetupRequired())) {
      return {
        success: false,
        error: "Setup has already been completed. Sign in instead.",
      };
    }

    if (
      !formData.username ||
      formData.username.length < 3 ||
      !formData.email ||
      !formData.password ||
      formData.password.length < 8
    ) {
      return { success: false, error: "Invalid setup details." };
    }

    const hashedPassword = await hash(formData.password, 12);

    await storage.createUser({
      id: nanoid(),
      username: formData.username,
      email: formData.email,
      password: hashedPassword,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
      skipPasswordHashing: true,
    });

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
