#!/usr/bin/env tsx
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";

// Get database URL from environment or use default
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/cronium";

async function addEventRelationsIndexes() {
  console.log("Adding indexes for event relations...");
  console.log(`Database URL: ${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}`);

  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 1, // Single connection for migration
  });

  const db = drizzle(pool);

  try {
    const indexStatements = [
      // Indexes for conditional_actions foreign keys
      "CREATE INDEX IF NOT EXISTS idx_conditional_actions_success_event_id ON conditional_actions(success_event_id)",
      "CREATE INDEX IF NOT EXISTS idx_conditional_actions_fail_event_id ON conditional_actions(fail_event_id)",
      "CREATE INDEX IF NOT EXISTS idx_conditional_actions_always_event_id ON conditional_actions(always_event_id)",
      "CREATE INDEX IF NOT EXISTS idx_conditional_actions_condition_event_id ON conditional_actions(condition_event_id)",
      "CREATE INDEX IF NOT EXISTS idx_conditional_actions_target_event_id ON conditional_actions(target_event_id)",

      // Indexes for event_servers foreign keys
      "CREATE INDEX IF NOT EXISTS idx_event_servers_event_id ON event_servers(event_id)",
      "CREATE INDEX IF NOT EXISTS idx_event_servers_server_id ON event_servers(server_id)",

      // Index for env_vars foreign key
      "CREATE INDEX IF NOT EXISTS idx_env_vars_event_id ON env_vars(event_id)",

      // Additional composite indexes for common query patterns
      "CREATE INDEX IF NOT EXISTS idx_events_status_user_id ON events(status, user_id)",
      "CREATE INDEX IF NOT EXISTS idx_logs_event_id_start_time ON logs(event_id, start_time DESC)",
    ];

    // Execute each index creation
    for (const statement of indexStatements) {
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

    // Get table statistics
    try {
      const tableStats = await db.execute(sql`
        SELECT 
          schemaname,
          relname as tablename,
          n_live_tup as row_count
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        AND relname IN ('conditional_actions', 'event_servers', 'env_vars', 'events', 'logs')
        ORDER BY relname;
      `);

      console.log("\nTable statistics:");
      tableStats.rows.forEach((stat: any) => {
        console.log(`- ${stat.tablename}: ${stat.row_count} rows`);
      });
    } catch (statsError) {
      // Table stats are optional, don't fail if they're not available
      console.log("\nTable statistics not available");
    }
  } catch (error) {
    console.error("❌ Error adding indexes:", error);
    throw error;
  } finally {
    await pool.end();
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
