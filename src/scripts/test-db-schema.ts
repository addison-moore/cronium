/**
 * Quick test to check database schema
 */

import { db } from "@/server/db";
import { sql } from "drizzle-orm";

async function testSchema() {
  console.log("Testing database schema...\n");

  try {
    // Check tool_credentials table structure
    const result = await db.execute(sql`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'tool_credentials'
      ORDER BY ordinal_position
    `);

    console.log("tool_credentials columns:");
    console.log(result.rows);

    // Check if table exists
    const tableExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'tool_credentials'
      )
    `);

    console.log("\nTable exists:", tableExists.rows[0].exists);
  } catch (error) {
    console.error("Error checking schema:", error);
  }
}

testSchema().then(() => process.exit(0));
