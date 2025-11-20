const path = require("node:path");
const process = require("node:process");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const shouldAutoMigrate =
  (process.env.AUTO_MIGRATE ?? "true").toLowerCase() !== "false";

if (!shouldAutoMigrate) {
  console.log("[MIGRATIONS] AUTO_MIGRATE=false, skipping migration check");
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.warn("[MIGRATIONS] DATABASE_URL is not set; cannot run migrations");
  process.exit(0);
}

const appDir = path.join(process.cwd(), "apps", "cronium-app");
const drizzleConfigPath = path.join(appDir, "drizzle.config.ts");
if (!fs.existsSync(drizzleConfigPath)) {
  console.error(`[MIGRATIONS] Missing drizzle config at ${drizzleConfigPath}`);
  process.exit(1);
}

console.log("[MIGRATIONS] Applying schema via drizzle-kit push...");
const result = spawnSync(
  "npx",
  ["drizzle-kit", "push", "--config", drizzleConfigPath],
  {
    stdio: "inherit",
    cwd: appDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  },
);

if (result.error) {
  console.error("[MIGRATIONS] Failed to launch drizzle-kit", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    `[MIGRATIONS] drizzle-kit push exited with code ${result.status}`,
  );
  process.exit(result.status);
}

console.log("[MIGRATIONS] Database is up to date.");
