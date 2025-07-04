/**
 * Migration script to add execution tracking fields to the scripts table.
 *
 * This adds:
 * - last_run_at: Timestamp of when the event was last executed
 * - next_run_at: Timestamp of when the event will next be executed
 * - success_count: Counter for successful executions
 * - failure_count: Counter for failed executions
 */
async function main() {
  const { db } = await import("../server/db");
  const { sql } = await import("drizzle-orm");

  console.log("Starting migration to add execution tracking fields...");

  try {
    // Add the new columns to the scripts table
    await db.execute(sql`
      ALTER TABLE scripts 
      ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS success_count INTEGER DEFAULT 0 NOT NULL,
      ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0 NOT NULL;
    `);

    console.log("Migration completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }

  // Exit the process
  process.exit(0);
}

main().catch(console.error);
