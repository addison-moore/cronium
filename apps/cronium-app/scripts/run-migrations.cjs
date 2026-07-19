/**
 * Applies versioned Drizzle migrations at boot (drizzle/ next to this app).
 *
 * Three states:
 *  - Fresh database            → run the migrator (applies the baseline).
 *  - Migrated database         → run the migrator (applies anything pending).
 *  - Legacy database created by the old `drizzle-kit push` flow (schema
 *    exists, no migration records) → one-time transition: push to sync the
 *    schema to the current baseline, then stamp all existing migrations as
 *    applied so future boots use the migrator alone.
 */

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const process = require("node:process");
const { spawnSync } = require("node:child_process");

const APP_DIR = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(APP_DIR, "drizzle");

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

function readJournal() {
  const journalPath = path.join(MIGRATIONS_DIR, "meta", "_journal.json");
  return JSON.parse(fs.readFileSync(journalPath, "utf8"));
}

async function detectState(pool) {
  const { rows } = await pool.query(`
    select
      to_regclass('public.users') is not null as has_schema,
      to_regclass('drizzle.__drizzle_migrations') is not null as has_migrations_table
  `);
  const { has_schema, has_migrations_table } = rows[0];
  let hasRecords = false;
  if (has_migrations_table) {
    const res = await pool.query(
      `select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    hasRecords = res.rows[0].n > 0;
  }
  return { hasSchema: has_schema, hasRecords };
}

function runDrizzleKitPush() {
  console.log(
    "[MIGRATIONS] Legacy schema detected (created by drizzle-kit push); syncing it to the current baseline...",
  );
  const result = spawnSync(
    "npx",
    [
      "drizzle-kit",
      "push",
      "--config",
      path.join(APP_DIR, "drizzle.config.ts"),
    ],
    { stdio: "inherit", cwd: APP_DIR, env: process.env },
  );
  if (result.error || result.status !== 0) {
    console.error(
      "[MIGRATIONS] drizzle-kit push failed during legacy transition",
      result.error ?? `exit code ${result.status}`,
    );
    process.exit(result.status || 1);
  }
}

async function stampMigrations(pool) {
  // Record every existing migration as applied, exactly the way the drizzle
  // migrator would (hash = sha256 of the SQL file, created_at = journal
  // "when"), so the next boot's migrate() sees nothing pending.
  const journal = readJournal();
  await pool.query(`create schema if not exists "drizzle"`);
  await pool.query(`
    create table if not exists "drizzle"."__drizzle_migrations" (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(
      path.join(MIGRATIONS_DIR, `${entry.tag}.sql`),
      "utf8",
    );
    const hash = crypto.createHash("sha256").update(sql).digest("hex");
    await pool.query(
      `insert into "drizzle"."__drizzle_migrations" (hash, created_at) values ($1, $2)`,
      [hash, entry.when],
    );
  }
  console.log(
    `[MIGRATIONS] Stamped ${journal.entries.length} migration(s) as applied (legacy transition complete)`,
  );
}

async function main() {
  const { Pool } = require("pg");
  const { drizzle } = require("drizzle-orm/node-postgres");
  const { migrate } = require("drizzle-orm/node-postgres/migrator");

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const state = await detectState(pool);

    if (state.hasSchema && !state.hasRecords) {
      runDrizzleKitPush();
      await stampMigrations(pool);
      console.log("[MIGRATIONS] Database is up to date.");
      return;
    }

    console.log("[MIGRATIONS] Applying pending migrations...");
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    console.log("[MIGRATIONS] Database is up to date.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[MIGRATIONS] Migration run failed", err);
  process.exit(1);
});
