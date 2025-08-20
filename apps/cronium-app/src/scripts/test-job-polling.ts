#!/usr/bin/env tsx
/**
 * Test script to verify job polling is working correctly
 */

import { scheduler } from "@/lib/scheduler";
import { storage } from "@/server/storage";
import { EventType, EventStatus, RunLocation } from "@/shared/schema";

async function testJobPolling() {
  console.log("=== Testing Job Polling ===\n");

  // Get a user
  const users = await storage.getAllUsers();
  if (users.length === 0) {
    console.error("No users found");
    process.exit(1);
  }
  const userId = users[0]!.id;

  // Create a test event that takes a few seconds
  const testEvent = await storage.createEvent({
    name: "Test Polling Event",
    description: "Event to test job polling",
    type: EventType.BASH,
    content: `
echo "Starting job..."
sleep 3
echo "Job completed after 3 seconds"
`,
    status: EventStatus.ACTIVE,
    triggerType: "MANUAL",
    runLocation: RunLocation.LOCAL,
    userId,
    timeoutValue: 30,
    timeoutUnit: "SECONDS",
    retries: 0,
    scheduleNumber: 1,
    scheduleUnit: "MINUTES",
    executionCount: 0,
    maxExecutions: 0,
    resetCounterOnActive: false,
    payloadVersion: 1,
    successCount: 0,
    failureCount: 0,
    tags: ["test"],
    shared: false,
  });

  console.log(`Created test event: ${testEvent.id}\n`);

  try {
    // Test 1: Execute WITHOUT waiting (should return immediately)
    console.log("Test 1: Execute WITHOUT waiting for completion");
    const startTime1 = Date.now();

    const result1 = await scheduler.executeEvent(
      testEvent.id,
      undefined, // workflowExecutionId
      undefined, // sequenceOrder
      {}, // input
      undefined, // workflowId
      false, // waitForCompletion = false
    );

    const duration1 = Date.now() - startTime1;
    console.log(`Result 1 (no wait):`, result1);
    console.log(`Duration 1: ${duration1}ms (should be < 1000ms)\n`);

    // Wait a bit before second test
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Test 2: Execute WITH waiting (should wait ~3 seconds)
    console.log("Test 2: Execute WITH waiting for completion");
    const startTime2 = Date.now();

    const result2 = await scheduler.executeEvent(
      testEvent.id,
      undefined, // workflowExecutionId
      undefined, // sequenceOrder
      {}, // input
      undefined, // workflowId
      true, // waitForCompletion = true
    );

    const duration2 = Date.now() - startTime2;
    console.log(`Result 2 (with wait):`, result2);
    console.log(`Duration 2: ${duration2}ms (should be >= 3000ms)\n`);

    // Verify results
    if (duration1 < 1000 && result1.output?.includes("queued")) {
      console.log("✅ Test 1 PASSED: Returned immediately without waiting");
    } else {
      console.log("❌ Test 1 FAILED: Should have returned immediately");
    }

    if (duration2 >= 3000 && result2.output?.includes("completed")) {
      console.log("✅ Test 2 PASSED: Waited for job completion");
    } else {
      console.log("❌ Test 2 FAILED: Should have waited for completion");
    }
  } finally {
    // Cleanup
    await storage.deleteEvent(testEvent.id);
    console.log("\nTest event cleaned up");
  }

  process.exit(0);
}

testJobPolling().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
