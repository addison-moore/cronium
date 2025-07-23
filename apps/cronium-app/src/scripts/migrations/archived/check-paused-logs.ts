#!/usr/bin/env tsx
/**
 * Migration: Check and update any logs with PAUSED status
 *
 * Since PAUSED status has been removed from LogStatus enum,
 * we need to check if any logs have this status and update them.
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

async function checkPausedLogs() {
  console.log("Checking for logs with PAUSED status...");

  try {
    // Check if any logs have PAUSED status
    const result = await db.execute(sql`
      SELECT COUNT(*) as count 
      FROM logs 
      WHERE status = 'PAUSED'
    `);

    const count = Number(result.rows[0]?.count) || 0;

    if (count > 0) {
      console.log(
        `Found ${count} logs with PAUSED status. Updating to FAILURE...`,
      );

      // Update PAUSED logs to FAILURE
      await db.execute(sql`
        UPDATE logs 
        SET status = 'FAILURE', 
            error = COALESCE(error, 'Event was paused and has been marked as failed')
        WHERE status = 'PAUSED'
      `);

      console.log("✅ Successfully updated all PAUSED logs to FAILURE");
    } else {
      console.log("✅ No logs found with PAUSED status");
    }

    // Also check for any other invalid statuses
    const validStatuses = [
      "PENDING",
      "SUCCESS",
      "FAILURE",
      "RUNNING",
      "TIMEOUT",
      "PARTIAL",
    ];

    const invalidResult = await db.execute(sql`
      SELECT DISTINCT status, COUNT(*) as count
      FROM logs
      WHERE status NOT IN (${sql.join(
        validStatuses.map((s) => sql`${s}`),
        sql`, `,
      )})
      GROUP BY status
    `);

    if (invalidResult.rows.length > 0) {
      console.log("\n⚠️  Found logs with invalid statuses:");
      for (const row of invalidResult.rows) {
        console.log(`  - ${row.status}: ${row.count} logs`);
      }
      console.log("\nConsider updating these logs to valid statuses.");
    } else {
      console.log("✅ All logs have valid statuses");
    }
  } catch (error) {
    console.error("❌ Error checking PAUSED logs:", error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  checkPausedLogs()
    .then(async () => {
      console.log("\nMigration completed successfully");
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error("\nMigration failed:", error);
      await pool.end();
      process.exit(1);
    });
}

export { checkPausedLogs };
