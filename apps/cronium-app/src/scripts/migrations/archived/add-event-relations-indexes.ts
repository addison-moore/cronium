import { db } from "@/server/db";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

async function addEventRelationsIndexes() {
  console.log("Adding indexes for event relations...");

  try {
    // Read the SQL file
    const sqlPath = join(
      process.cwd(),
      "src/db/migrations/add-event-relations-indexes.sql",
    );
    const sqlContent = readFileSync(sqlPath, "utf-8");

    // Split into individual statements and execute
    const statements = sqlContent
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      console.log(`Executing: ${statement.substring(0, 50)}...`);
      await db.execute(sql.raw(statement));
    }

    console.log("✅ Successfully added all indexes");

    // Verify indexes were created
    const indexes = await db.execute(sql`
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND (
        indexname LIKE 'idx_conditional_actions_%'
        OR indexname LIKE 'idx_event_servers_%'
        OR indexname LIKE 'idx_env_vars_%'
        OR indexname LIKE 'idx_events_%'
        OR indexname LIKE 'idx_logs_%'
      )
      ORDER BY tablename, indexname;
    `);

    console.log("\nCreated indexes:");
    indexes.rows.forEach((index: any) => {
      console.log(`- ${index.tablename}: ${index.indexname}`);
    });
  } catch (error) {
    console.error("❌ Error adding indexes:", error);
    throw error;
  }
}

// Run the migration
addEventRelationsIndexes()
  .then(() => {
    console.log("\n✅ Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  });
