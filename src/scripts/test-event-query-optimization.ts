import { db } from "@/server/db";
import { sql } from "drizzle-orm";
import { storage } from "@/server/storage";

async function testEventQueryOptimization() {
  console.log("Testing event query optimization...\n");

  try {
    // Get a sample event ID
    const sampleEvent = await db.query.events.findFirst();
    if (!sampleEvent) {
      console.log("No events found in database");
      return;
    }

    const eventId = sampleEvent.id;
    console.log(`Testing with event ID: ${eventId}\n`);

    // Test 1: Direct query test (no cache)
    console.log("1. Testing direct optimized query (no cache):");
    // Access private method via prototype
    const storageProto = Object.getPrototypeOf(storage) as {
      getEventWithRelationsOptimized?: (eventId: number) => Promise<unknown>;
    };
    const directStart = Date.now();
    const directResult =
      (await storageProto.getEventWithRelationsOptimized?.call(
        storage,
        eventId,
      )) as
        | {
            envVars: unknown[];
            servers: unknown[];
            successEvents: unknown[];
            failEvents: unknown[];
            alwaysEvents: unknown[];
          }
        | undefined;
    const directTime = Date.now() - directStart;
    console.log(`   Time: ${directTime}ms`);
    console.log(
      `   Relations: envVars=${directResult?.envVars.length ?? 0}, servers=${directResult?.servers.length ?? 0}`,
    );
    console.log(
      `   Conditional actions: success=${directResult?.successEvents.length ?? 0}, fail=${directResult?.failEvents.length ?? 0}, always=${directResult?.alwaysEvents.length ?? 0}`,
    );

    // Test 3: Cached version (first call - cache miss)
    console.log("\n3. Testing cached version (cache miss):");
    const cachedMissStart = Date.now();
    const _cachedMissResult = await storage.getEventWithRelations(eventId);
    const cachedMissTime = Date.now() - cachedMissStart;
    console.log(`   Time: ${cachedMissTime}ms`);

    // Test 4: Cached version (second call - cache hit)
    console.log("\n4. Testing cached version (cache hit):");
    const cachedHitStart = Date.now();
    const _cachedHitResult = await storage.getEventWithRelations(eventId);
    const cachedHitTime = Date.now() - cachedHitStart;
    console.log(`   Time: ${cachedHitTime}ms`);

    // Performance improvement summary
    console.log("\n=== Performance Summary ===");
    console.log(`Direct optimized query: ${directTime}ms`);
    console.log(`Cached (miss): ${cachedMissTime}ms`);
    console.log(
      `Cached (hit): ${cachedHitTime}ms (${Math.round(((cachedMissTime - cachedHitTime) / cachedMissTime) * 100)}% improvement)`,
    );

    // Test 5: Check if indexes exist
    console.log("\n=== Index Verification ===");
    const indexes = await db.execute(sql`
      SELECT 
        tablename,
        indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND (
        indexname LIKE 'idx_conditional_actions_%'
        OR indexname LIKE 'idx_event_servers_%'
        OR indexname LIKE 'idx_env_vars_%'
      )
      ORDER BY tablename, indexname;
    `);

    if (indexes.rows.length > 0) {
      console.log("Indexes found:");
      indexes.rows.forEach((index: unknown) => {
        const idx = index as { tablename: string; indexname: string };
        console.log(`- ${idx.tablename}: ${idx.indexname}`);
      });
    } else {
      console.log(
        "⚠️  No optimization indexes found. Run the migration script:",
      );
      console.log(
        "   pnpm tsx src/scripts/migrations/add-event-relations-indexes.ts",
      );
    }
  } catch (error) {
    console.error("Test failed:", error);
  }
}

// Run the test
testEventQueryOptimization()
  .then(() => {
    console.log("\n✅ Test completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
