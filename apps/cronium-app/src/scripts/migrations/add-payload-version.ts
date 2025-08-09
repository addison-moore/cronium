#!/usr/bin/env tsx
/**
 * Migration: Add payload_version column and runner_payloads table
 *
 * This migration adds support for the runner payload system introduced in Phase 2.
 *
 * Run with: pnpm tsx src/scripts/migrations/add-payload-version.ts
 */

import { sql } from "drizzle-orm";
import { db } from "@/shared/db";

async function runMigration() {
  console.log("Starting migration: Add payload_version support...");

  try {
    // Start transaction
    await db.transaction(async (tx) => {
      // 1. Add payload_version column to events table
      console.log("Adding payload_version column to events table...");
      await tx.execute(sql`
        ALTER TABLE events 
        ADD COLUMN IF NOT EXISTS payload_version INTEGER DEFAULT 1 NOT NULL
      `);

      // 2. Create runner_payloads table
      console.log("Creating runner_payloads table...");
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS runner_payloads (
          id SERIAL PRIMARY KEY,
          event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          hash VARCHAR(64) NOT NULL,
          path VARCHAR(512) NOT NULL,
          size INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          UNIQUE(event_id, version)
        )
      `);

      // 3. Add indexes
      console.log("Adding indexes...");
      await tx.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_runner_payloads_event_id ON runner_payloads(event_id)
      `);

      await tx.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_runner_payloads_hash ON runner_payloads(hash)
      `);

      // 4. Add comment for documentation
      await tx.execute(sql`
        COMMENT ON COLUMN events.payload_version IS 'Version of the payload format for runner execution'
      `);

      console.log("✅ Migration completed successfully!");
    });

    // Verify the migration
    console.log("\nVerifying migration...");

    // Check if column exists
    const columnCheck = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'events' 
      AND column_name = 'payload_version'
    `);

    if (columnCheck.rows.length > 0) {
      console.log("✓ payload_version column exists");
    } else {
      console.error("✗ payload_version column not found");
      process.exit(1);
    }

    // Check if table exists
    const tableCheck = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'runner_payloads'
    `);

    if (tableCheck.rows.length > 0) {
      console.log("✓ runner_payloads table exists");
    } else {
      console.error("✗ runner_payloads table not found");
      process.exit(1);
    }

    console.log("\n✅ All migration checks passed!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run the migration
runMigration().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
