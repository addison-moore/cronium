import { db } from "@/server/db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("Adding OAuth tables...");

  try {
    // Create oauth_tokens table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        tool_id INTEGER NOT NULL,
        provider_id VARCHAR(50) NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at TIMESTAMP,
        token_type VARCHAR(50) NOT NULL DEFAULT 'Bearer',
        scope TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (tool_id) REFERENCES tool_credentials(id) ON DELETE CASCADE,
        UNIQUE (user_id, tool_id, provider_id)
      );
    `);

    // Create oauth_states table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oauth_states (
        id SERIAL PRIMARY KEY,
        state VARCHAR(255) NOT NULL UNIQUE,
        user_id VARCHAR(255) NOT NULL,
        tool_id INTEGER NOT NULL,
        provider_id VARCHAR(50) NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_verifier TEXT,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (tool_id) REFERENCES tool_credentials(id) ON DELETE CASCADE
      );
    `);

    // Create indexes
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_tool 
      ON oauth_tokens(user_id, tool_id);
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at 
      ON oauth_states(expires_at);
    `);

    console.log("OAuth tables created successfully!");
  } catch (error) {
    console.error("Error creating OAuth tables:", error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log("Migration completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}

export { runMigration };
