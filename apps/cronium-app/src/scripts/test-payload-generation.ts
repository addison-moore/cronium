import { db } from "@/server/db";
import { events, runnerPayloads } from "@/shared/schema";
import { payloadService } from "@/lib/services/payload-service";
import {
  EventType,
  EventStatus,
  EventTriggerType,
  RunLocation,
  TimeUnit,
} from "@/shared/schema";
import * as fs from "fs/promises";
import * as path from "path";
import * as tar from "tar";
import * as yaml from "js-yaml";

async function testPayloadGeneration() {
  console.log("🧪 Testing payload generation...");

  try {
    // Create a test event
    const testEvent = {
      id: 999999,
      userId: "test-user",
      name: "Test Payload Event",
      description: "Testing payload generation",
      type: EventType.BASH,
      content: `#!/bin/bash
echo "Hello from payload test!"
echo "Current time: $(date)"
echo "Environment variable TEST_VAR: $TEST_VAR"`,
      status: EventStatus.ACTIVE,
      triggerType: EventTriggerType.MANUAL,
      runLocation: RunLocation.REMOTE,
      serverId: null,
      timeoutValue: 30,
      timeoutUnit: TimeUnit.SECONDS,
      retries: 0,
      maxExecutions: 1,
      executionCount: 0,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      httpMethod: null,
      httpUrl: null,
      httpHeaders: null,
      httpBody: null,
      httpAuthType: null,
      shared: false,
      scheduleNumber: 1,
      scheduleUnit: TimeUnit.MINUTES,
      customSchedule: null,
      startTime: null,
      resetCounterOnActive: false,
      payloadVersion: 0,
      lastRunAt: null,
      nextRunAt: null,
      successCount: 0,
      failureCount: 0,
      toolActionConfig: null,
    };

    // Test environment variables
    const envVars = [
      { key: "TEST_VAR", value: "Hello from env!" },
      { key: "NODE_ENV", value: "test" },
    ];

    // Generate payload
    console.log("📦 Generating payload...");
    const payload = await payloadService.generatePayload(testEvent, envVars);
    console.log("✅ Payload generated:", {
      id: payload.id,
      eventId: payload.eventId,
      eventVersion: payload.eventVersion,
      payloadPath: payload.payloadPath,
      payloadSize: payload.payloadSize,
      checksum: payload.checksum,
    });

    // Verify payload file exists
    const payloadExists = await fs
      .access(payload.payloadPath)
      .then(() => true)
      .catch(() => false);
    console.log("📁 Payload file exists:", payloadExists);

    // Extract and verify payload contents
    if (payloadExists) {
      const tempDir = path.join(
        process.cwd(),
        "storage",
        "payloads",
        "verify",
        `test-${Date.now()}`,
      );
      await fs.mkdir(tempDir, { recursive: true });

      try {
        // Extract payload
        await tar.extract({
          file: payload.payloadPath,
          cwd: tempDir,
        });
        console.log("📂 Payload extracted to:", tempDir);

        // Read manifest
        const manifestPath = path.join(tempDir, "manifest.yaml");
        const manifestContent = await fs.readFile(manifestPath, "utf-8");
        const manifest = yaml.load(manifestContent) as any;
        console.log("📄 Manifest:", manifest);

        // Read script
        const scriptPath = path.join(tempDir, manifest.entrypoint);
        const scriptContent = await fs.readFile(scriptPath, "utf-8");
        console.log("📜 Script content:");
        console.log(scriptContent);

        // Cleanup
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.error("❌ Error verifying payload:", error);
      }
    }

    // Test generating a second version
    console.log("\n📦 Generating second version...");
    testEvent.content = `#!/bin/bash
echo "Updated script - version 2!"
echo "This is the new content"`;

    const payload2 = await payloadService.generatePayload(testEvent, envVars);
    console.log("✅ Second payload generated:", {
      id: payload2.id,
      eventVersion: payload2.eventVersion,
      payloadPath: payload2.payloadPath,
    });

    // Check that both payloads exist
    const [allPayloads] = await Promise.all([
      db
        .select()
        .from(runnerPayloads)
        .where(eq(runnerPayloads.eventId, testEvent.id)),
    ]);

    console.log("\n📊 All payloads for event:", allPayloads.length);
    allPayloads.forEach((p) => {
      console.log(
        `  - Version ${p.eventVersion}: ${p.isActive ? "ACTIVE" : "inactive"}`,
      );
    });

    // Test cleanup
    console.log("\n🧹 Testing cleanup (keeping only latest)...");
    await payloadService.removeOldPayloads(testEvent.id, 1);

    const remainingPayloads = await db
      .select()
      .from(runnerPayloads)
      .where(eq(runnerPayloads.eventId, testEvent.id));

    console.log("📊 Remaining payloads:", remainingPayloads.length);

    // Cleanup test payloads
    console.log("\n🧹 Cleaning up all test payloads...");
    await payloadService.cleanupEventPayloads(testEvent.id);

    console.log("\n✅ Payload generation test completed successfully!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Import helpers
import { eq } from "drizzle-orm";

// Run test
testPayloadGeneration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
