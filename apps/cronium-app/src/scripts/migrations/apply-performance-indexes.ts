#!/usr/bin/env tsx

/**
 * Migration: Add performance indexes
 *
 * Applies the FK/lookup/composite indexes in
 * drizzle/add-performance-indexes.sql. All statements are idempotent
 * (CREATE INDEX IF NOT EXISTS), so this is safe to re-run.
 *
 * Run with: pnpm tsx src/scripts/migrations/apply-performance-indexes.ts
 */

import { readFileSync } from "fs";
import { join } from "path";
import { db } from "@/server/db";
import { sql } from "drizzle-orm";

async function applyPerformanceIndexes() {
  console.log("Starting migration: Adding performance indexes...");

  const sqlPath = join(process.cwd(), "drizzle", "add-performance-indexes.sql");
  const fileContents = readFileSync(sqlPath, "utf-8");

  // Split into individual statements (strip comments and blank lines)
  const statements = fileContents
    .split(";")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    const label = statement.replace(/\s+/g, " ").slice(0, 80);
    console.log(`Applying: ${label}...`);
    await db.execute(sql.raw(statement));
  }

  console.log(`✓ Applied ${statements.length} index statements`);
}

applyPerformanceIndexes()
  .then(() => {
    console.log("Migration complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
