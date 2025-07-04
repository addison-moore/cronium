import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  try {
    console.log("Dropping all existing tables...");
    
    // Drop tables in reverse order to avoid foreign key constraints
    await db.execute(sql`DROP TABLE IF EXISTS "sessions" CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS "settings" CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS "events" CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS "logs" CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS "env_vars" CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS "scripts" CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS "servers" CASCADE`);
    await db.execute(sql`DROP TABLE IF EXISTS "users" CASCADE`);
    
    console.log("All tables dropped successfully");
    
    // Create tables from schema
    console.log("Creating tables from schema...");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" VARCHAR(255) PRIMARY KEY NOT NULL,
        "email" VARCHAR(255) UNIQUE,
        "first_name" VARCHAR(255),
        "last_name" VARCHAR(255),
        "profile_image_url" VARCHAR(255),
        "role" VARCHAR(50) DEFAULT 'USER' NOT NULL,
        "github_access_token" VARCHAR(255),
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "sessions" (
        "sid" VARCHAR PRIMARY KEY,
        "sess" JSONB NOT NULL,
        "expire" TIMESTAMP NOT NULL
      )
    `);
    
    await db.execute(sql`
      CREATE INDEX "IDX_session_expire" ON "sessions" ("expire")
    `);
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "servers" (
        "id" SERIAL PRIMARY KEY,
        "user_id" VARCHAR(255) REFERENCES "users"("id") NOT NULL,
        "name" VARCHAR(255) NOT NULL,
        "address" VARCHAR(255) NOT NULL,
        "ssh_key" TEXT NOT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "scripts" (
        "id" SERIAL PRIMARY KEY,
        "user_id" VARCHAR(255) REFERENCES "users"("id") NOT NULL,
        "name" VARCHAR(255) NOT NULL,
        "type" VARCHAR(50) NOT NULL,
        "content" TEXT NOT NULL,
        "status" VARCHAR(50) DEFAULT 'DRAFT' NOT NULL,
        "schedule_number" INTEGER DEFAULT 1 NOT NULL,
        "schedule_unit" VARCHAR(50) DEFAULT 'MINUTES' NOT NULL,
        "custom_schedule" VARCHAR(255),
        "run_location" VARCHAR(50) DEFAULT 'LOCAL' NOT NULL,
        "server_id" INTEGER REFERENCES "servers"("id"),
        "gist_id" VARCHAR(255),
        "gist_filename" VARCHAR(255),
        "timeout_value" INTEGER DEFAULT 30 NOT NULL,
        "timeout_unit" VARCHAR(50) DEFAULT 'SECONDS' NOT NULL,
        "retries" INTEGER DEFAULT 0 NOT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "env_vars" (
        "id" SERIAL PRIMARY KEY,
        "script_id" INTEGER REFERENCES "scripts"("id") NOT NULL,
        "key" VARCHAR(255) NOT NULL,
        "value" VARCHAR(255) NOT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "logs" (
        "id" SERIAL PRIMARY KEY,
        "script_id" INTEGER REFERENCES "scripts"("id") NOT NULL,
        "status" VARCHAR(50) DEFAULT 'RUNNING' NOT NULL,
        "output" TEXT,
        "start_time" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "end_time" TIMESTAMP,
        "duration" INTEGER,
        "successful" BOOLEAN DEFAULT false
      )
    `);
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "events" (
        "id" SERIAL PRIMARY KEY,
        "type" VARCHAR(50) NOT NULL,
        "value" VARCHAR(255),
        "success_script_id" INTEGER REFERENCES "scripts"("id"),
        "fail_script_id" INTEGER REFERENCES "scripts"("id"),
        "target_script_id" INTEGER REFERENCES "scripts"("id"),
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "settings" (
        "id" SERIAL PRIMARY KEY,
        "key" VARCHAR(255) NOT NULL UNIQUE,
        "value" VARCHAR(255) NOT NULL,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    
    console.log("All tables created successfully");
    
  } catch (error) {
    console.error("Error recreating database:", error);
  } finally {
    process.exit(0);
  }
}

main();