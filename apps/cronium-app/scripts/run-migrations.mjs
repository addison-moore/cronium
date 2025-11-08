import path from "node:path";
import process from "node:process";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import fs from "node:fs";

const shouldAutoMigrate = (process.env.AUTO_MIGRATE ?? "true").toLowerCase() !== "false";

if (!shouldAutoMigrate) {
  console.log("[MIGRATIONS] AUTO_MIGRATE=false, skipping migration check");
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.warn("[MIGRATIONS] DATABASE_URL is not set; cannot run migrations");
  process.exit(0);
}

const migrationsFolder = path.join(process.cwd(), "apps", "cronium-app", "drizzle");
if (!fs.existsSync(migrationsFolder)) {
  console.warn(`[MIGRATIONS] Migrations folder not found at ${migrationsFolder}; skipping`);
  process.exit(0);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

(async () => {
  console.log("[MIGRATIONS] Checking for pending database migrations...");
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    console.log("[MIGRATIONS] Database is up to date.");
  } catch (err) {
    console.error("[MIGRATIONS] Failed to run database migrations", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
