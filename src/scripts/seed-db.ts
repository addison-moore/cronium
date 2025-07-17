import { db, pool } from "@server/db";
import { env } from "@/env.mjs";
import { users, systemSettings, UserRole, UserStatus } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";
import { nanoid } from "nanoid";

async function seedAdminUser() {
  console.log("Checking for admin user...");

  // Check if admin user already exists
  const existingAdmin = await db
    .select()
    .from(users)
    .where(eq(users.username, "admin"))
    .limit(1);

  if (existingAdmin.length > 0) {
    console.log("Admin user already exists, skipping creation.");
    return;
  }

  // Create default admin user
  console.log("Creating default admin user...");
  const hashedPassword = await hash("admin", 10);

  await db.insert(users).values({
    id: nanoid(),
    username: "admin",
    email: "admin@example.com",
    password: hashedPassword,
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(
    "Default admin user created with username: 'admin' and password: 'admin'",
  );
  console.log(
    "IMPORTANT: Please change the default admin password after first login!",
  );
}

async function seedDefaultSettings() {
  console.log("Checking for default system settings...");

  // Default AI settings
  const aiSettings = [
    { key: "aiEnabled", value: "false" },
    { key: "aiModel", value: "gpt-4o" },
    { key: "openaiApiKey", value: env.OPENAI_API_KEY || "" },
  ];

  // Check and insert each AI setting if it doesn't exist
  for (const setting of aiSettings) {
    const existingSetting = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, setting.key))
      .limit(1);

    if (existingSetting.length === 0) {
      console.log(`Creating default setting: ${setting.key}`);
      await db.insert(systemSettings).values({
        key: setting.key,
        value: setting.value,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  console.log("Default system settings completed");
}

async function main() {
  try {
    await seedAdminUser();
    await seedDefaultSettings();
    console.log("Database seeding completed successfully.");
  } catch (error) {
    console.error("Error seeding database:", error);
    process.exit(1);
  } finally {
    // Close the database connection pool
    await pool.end();
  }
}

main();
