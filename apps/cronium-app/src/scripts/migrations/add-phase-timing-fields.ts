#!/usr/bin/env tsx

/**
 * Migration: Add Phase-Based Timing Fields
 *
 * This migration adds phase-based execution timing fields to the executions
 * and logs tables to track setup, execution, and cleanup phases separately.
 *
 * Run with: pnpm tsx src/scripts/migrations/add-phase-timing-fields.ts
 */

import { db } from "@/server/db";
import { sql } from "drizzle-orm";

async function addPhaseTiming() {
  console.log("Starting migration: Adding phase-based timing fields...");

  try {
    // Add timing fields to executions table
    console.log("Adding timing fields to executions table...");

    await db.execute(sql`
      ALTER TABLE executions 
      ADD COLUMN IF NOT EXISTS setup_started_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS execution_started_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS execution_completed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS cleanup_started_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS cleanup_completed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS setup_duration INTEGER,
      ADD COLUMN IF NOT EXISTS execution_duration INTEGER,
      ADD COLUMN IF NOT EXISTS cleanup_duration INTEGER,
      ADD COLUMN IF NOT EXISTS total_duration INTEGER,
      ADD COLUMN IF NOT EXISTS execution_metadata JSONB
    `);

    console.log("✅ Added timing fields to executions table");

    // Add timing fields to logs table
    console.log("Adding timing fields to logs table...");

    await db.execute(sql`
      ALTER TABLE logs 
      ADD COLUMN IF NOT EXISTS execution_duration INTEGER,
      ADD COLUMN IF NOT EXISTS setup_duration INTEGER
    `);

    console.log("✅ Added timing fields to logs table");

    // Create indexes for better query performance
    console.log("Creating indexes for timing fields...");

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_executions_execution_duration 
      ON executions(execution_duration) 
      WHERE execution_duration IS NOT NULL
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_executions_total_duration 
      ON executions(total_duration) 
      WHERE total_duration IS NOT NULL
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_logs_execution_duration 
      ON logs(execution_duration) 
      WHERE execution_duration IS NOT NULL
    `);

    console.log("✅ Created indexes for timing fields");

    // Update existing records with calculated values where possible
    console.log("Calculating timing values for existing records...");

    // For executions table: Calculate total_duration from completed_at - started_at
    await db.execute(sql`
      UPDATE executions 
      SET total_duration = EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
      WHERE completed_at IS NOT NULL 
        AND started_at IS NOT NULL 
        AND total_duration IS NULL
    `);

    // For logs table: Keep existing duration as total, we can't determine execution vs setup time retroactively
    console.log(
      "Note: Existing log durations represent total time. Execution vs setup time cannot be determined retroactively.",
    );

    console.log("\n✅ Migration completed successfully!");
    console.log("\nSummary:");
    console.log("- Added phase timing fields to executions table");
    console.log("- Added execution_duration and setup_duration to logs table");
    console.log("- Created performance indexes");
    console.log("- Updated existing records where possible");
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  }
}

// Run the migration
addPhaseTiming()
  .then(() => {
    console.log("\nMigration script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nMigration script failed:", error);
    process.exit(1);
  });
