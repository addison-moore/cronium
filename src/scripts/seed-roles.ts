import { db } from "../server/db";
import { roles, users } from "../shared/schema";
import { eq, isNull } from "drizzle-orm";

async function seedRoles() {
  console.log("Starting to seed roles...");

  try {
    // Check if default role already exists
    const existingRole = await db
      .select()
      .from(roles)
      .where(eq(roles.isDefault, true))
      .limit(1);

    if (existingRole.length > 0) {
      console.log("Default role already exists, skipping creation.");
      return;
    }

    // Create default "users" role
    const [defaultRole] = await db
      .insert(roles)
      .values({
        name: "Users",
        description: "Default role for regular users with basic permissions",
        permissions: {
          console: true,
          monitoring: true,
        },
        isDefault: true,
      })
      .returning();

    if (defaultRole) {
      console.log("✓ Created default 'Users' role with ID:", defaultRole.id);
    } else {
      console.error("Failed to create default role");
      return;
    }

    // Update existing users without roles to use the default role
    const usersWithoutRoles = await db
      .select()
      .from(users)
      .where(isNull(users.roleId));

    if (usersWithoutRoles.length > 0) {
      await db
        .update(users)
        .set({ roleId: defaultRole!.id })
        .where(isNull(users.roleId));

      console.log(`✓ Updated ${usersWithoutRoles.length} users to use default role`);
    }

    console.log("Role seeding completed successfully!");

  } catch (error) {
    console.error("Error seeding roles:", error);
    process.exit(1);
  }
}

// Run the seeding function
seedRoles();