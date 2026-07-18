import { db } from "@server/db";
import { roles, users } from "@shared/schema";
import { isNull, sql } from "drizzle-orm";

// Roles mirror the UserRole enum (matched case-insensitively by name).
// Permissions here are only the insert-if-missing defaults — existing rows
// are never overwritten, so admin customizations survive re-seeding.
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
    permissions: {
      console: false,
      localServerAccess: false,
    },
    isDefault: false,
  },
] as const;

async function seedRoles() {
  console.log("Starting to seed roles...");

  try {
    for (const role of DEFAULT_ROLES) {
      const existing = await db
        .select()
        .from(roles)
        .where(sql`lower(${roles.name}) = ${role.name.toLowerCase()}`)
        .limit(1);

      if (existing.length > 0) {
        console.log(`Role '${role.name}' already exists, skipping.`);
        continue;
      }

      const [created] = await db
        .insert(roles)
        .values({
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          isDefault: role.isDefault,
        })
        .returning();

      console.log(`✓ Created '${role.name}' role with ID:`, created?.id);
    }

    // Assign the default role to users without one
    const defaultRole = await db
      .select()
      .from(roles)
      .where(sql`${roles.isDefault} = true`)
      .limit(1);

    const defaultRoleRow = defaultRole[0];
    if (defaultRoleRow) {
      const usersWithoutRoles = await db
        .select()
        .from(users)
        .where(isNull(users.roleId));

      if (usersWithoutRoles.length > 0) {
        await db
          .update(users)
          .set({ roleId: defaultRoleRow.id })
          .where(isNull(users.roleId));
        console.log(
          `✓ Updated ${usersWithoutRoles.length} users to use default role`,
        );
      }
    }

    console.log("Role seeding completed successfully!");
  } catch (error) {
    console.error("Error seeding roles:", error);
    process.exit(1);
  }
}

// Run the seeding function
void seedRoles();
