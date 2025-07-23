#!/usr/bin/env tsx
/**
 * Migration: Add indexes to logs table for improved query performance
 *
 * This migration adds the following indexes:
 * 1. idx_logs_job_id - For efficient lookups by job ID
 * 2. idx_logs_status_created - For filtering by status and sorting by creation time
 * 3. idx_logs_event_id_start_time - For efficient event logs queries
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL not found in environment variables");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

async function addLogsIndexes() {
  console.log("Starting migration: Adding indexes to logs table...");

  try {
    // Index on job_id for efficient job-to-log lookups
    console.log("Creating index on job_id...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_logs_job_id 
      ON logs(job_id) 
      WHERE job_id IS NOT NULL
    `);

    // Composite index on status and start_time for filtering and sorting
    console.log("Creating composite index on status and start_time...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_logs_status_start_time 
      ON logs(status, start_time DESC)
    `);

    // Index on event_id and start_time for event logs queries
    console.log("Creating composite index on event_id and start_time...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_logs_event_id_start_time 
      ON logs(event_id, start_time DESC)
    `);

    // Index on user_id and start_time for user activity queries
    console.log("Creating composite index on user_id and start_time...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_logs_user_id_start_time 
      ON logs(user_id, start_time DESC) 
      WHERE user_id IS NOT NULL
    `);

    console.log("✅ Successfully added all indexes to logs table");
  } catch (error) {
    console.error("❌ Error adding indexes:", error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  addLogsIndexes()
    .then(async () => {
      console.log("Migration completed successfully");
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error("Migration failed:", error);
      await pool.end();
      process.exit(1);
    });
}

export { addLogsIndexes };
