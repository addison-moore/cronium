import { db } from "@/server/db";
import { sql } from "drizzle-orm";

/**
 * Migration script to add new execution counter fields to the scripts table.
 * 
 * This adds:
 * - execution_count: Tracks how many times an event has been executed
 * - max_executions: Sets a limit on how many times an event can run (0 means unlimited)
 * - reset_counter_on_active: Controls whether the counter resets when an event is activated
 */
async function main() {
  console.log("Starting migration to add execution counter fields");

  try {
    // Add execution_count column
    await db.execute(sql`
      ALTER TABLE scripts 
      ADD COLUMN IF NOT EXISTS execution_count INTEGER NOT NULL DEFAULT 0
    `);
    console.log("Added execution_count column");

    // Add max_executions column (0 means unlimited)
    await db.execute(sql`
      ALTER TABLE scripts 
      ADD COLUMN IF NOT EXISTS max_executions INTEGER NOT NULL DEFAULT 0
    `);
    console.log("Added max_executions column");

    // Add reset_counter_on_active column
    await db.execute(sql`
      ALTER TABLE scripts 
      ADD COLUMN IF NOT EXISTS reset_counter_on_active BOOLEAN NOT NULL DEFAULT false
    `);
    console.log("Added reset_counter_on_active column");

    console.log("Migration completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Unhandled error:", err);
    process.exit(1);
  });