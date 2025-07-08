/**
 * Migration script to add security columns for Tool Actions
 * This adds encryption support and audit logging tables
 */

import { db } from "@/server/db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("Starting migration: Add security columns for Tool Actions\n");

  try {
    // Step 1: Check if columns already exist
    console.log("Checking existing schema...");
    const checkResult = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tool_credentials' 
      AND column_name IN ('encrypted', 'encryption_metadata')
    `);

    if (checkResult.rows.length > 0) {
      console.log(
        "✅ Security columns already exist in tool_credentials table",
      );
    } else {
      // Step 2: Add encryption columns to tool_credentials
      console.log("Adding encryption columns to tool_credentials table...");
      await db.execute(sql`
        ALTER TABLE tool_credentials 
        ADD COLUMN IF NOT EXISTS encrypted BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS encryption_metadata JSONB
      `);
      console.log("✅ Added encryption columns");

      // Add index
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_tool_credentials_encrypted ON tool_credentials(encrypted)
      `);
      console.log("✅ Added encryption index");
    }

    // Step 3: Create audit log table
    console.log("\nCreating tool_audit_logs table...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tool_audit_logs (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        tool_id INTEGER REFERENCES tool_credentials(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        action_details JSONB,
        ip_address TEXT,
        user_agent TEXT,
        success BOOLEAN NOT NULL DEFAULT true,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Created tool_audit_logs table");

    // Add indexes
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_tool_audit_logs_user_id ON tool_audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_tool_audit_logs_tool_id ON tool_audit_logs(tool_id);
      CREATE INDEX IF NOT EXISTS idx_tool_audit_logs_action ON tool_audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_tool_audit_logs_created_at ON tool_audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tool_audit_logs_user_tool ON tool_audit_logs(user_id, tool_id);
    `);
    console.log("✅ Added audit log indexes");

    // Step 4: Create rate limits table
    console.log("\nCreating tool_rate_limits table...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tool_rate_limits (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        tool_type TEXT NOT NULL,
        window_start TIMESTAMP WITH TIME ZONE NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        last_request TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Created tool_rate_limits table");

    // Add indexes
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_rate_limits_user_tool_window 
      ON tool_rate_limits(user_id, tool_type, window_start);
      
      CREATE INDEX IF NOT EXISTS idx_tool_rate_limits_window_start 
      ON tool_rate_limits(window_start);
    `);
    console.log("✅ Added rate limit indexes");

    // Step 5: Create user quotas table
    console.log("\nCreating user_tool_quotas table...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_tool_quotas (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        tool_type TEXT,
        daily_limit INTEGER,
        hourly_limit INTEGER,
        burst_limit INTEGER,
        tier TEXT DEFAULT 'free',
        custom_limits JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Created user_tool_quotas table");

    // Add index
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tool_quotas_user_tool 
      ON user_tool_quotas(user_id, tool_type)
    `);
    console.log("✅ Added quota index");

    // Step 6: Add comments
    console.log("\nAdding table comments...");
    await db.execute(sql`
      COMMENT ON COLUMN tool_credentials.encrypted IS 'Whether the credentials are encrypted';
      COMMENT ON COLUMN tool_credentials.encryption_metadata IS 'Encryption metadata (IV, algorithm, etc)';
      COMMENT ON TABLE tool_audit_logs IS 'Audit trail for tool-related security events';
      COMMENT ON TABLE tool_rate_limits IS 'Rate limiting tracking for tool usage';
      COMMENT ON TABLE user_tool_quotas IS 'User-specific quota configuration for tools';
    `);
    console.log("✅ Added comments");

    console.log("\n🎉 Migration completed successfully!");
    console.log("\nSummary:");
    console.log("- Added encryption columns to tool_credentials");
    console.log("- Created tool_audit_logs table for security auditing");
    console.log("- Created tool_rate_limits table for rate limiting");
    console.log("- Created user_tool_quotas table for user quotas");
    console.log("- Added all necessary indexes");
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  }
}

// Run the migration
runMigration()
  .then(() => {
    console.log("\n✅ Migration script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Migration script failed:", error);
    process.exit(1);
  });
