import { db } from "../server/db";
import { users, events, workflows } from "../shared/schema";
import { sql } from "drizzle-orm";

async function testConnection() {
  console.log("Testing new PostgreSQL connection...");

  try {
    // Test basic connection
    const result = await db.execute(sql`SELECT version()`);
    console.log("✓ Connected to:", result.rows[0]);

    // Test table counts
    const userCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(users);
    const eventCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(events);
    const workflowCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(workflows);

    console.log("\nTable counts:");
    console.log(`- Users: ${userCount[0]?.count ?? 0}`);
    console.log(`- Events: ${eventCount[0]?.count ?? 0}`);
    console.log(`- Workflows: ${workflowCount[0]?.count ?? 0}`);

    console.log("\n✓ All tests passed!");
    process.exit(0);
  } catch (error) {
    console.error("✗ Test failed:", error);
    process.exit(1);
  }
}

void testConnection();
