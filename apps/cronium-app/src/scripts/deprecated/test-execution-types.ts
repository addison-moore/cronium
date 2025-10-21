#!/usr/bin/env tsx

/**
 * Test script to verify different execution types in the containerized orchestrator
 * Tests local container execution and remote SSH execution
 */

import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { EventType, LogStatus, JobType, EventStatus } from "@/shared/schema";
import { buildJobPayload } from "@/lib/scheduler/job-payload-builder";

async function createTestEvent(
  name: string,
  type: EventType,
  content: string,
  serverId?: number,
): Promise<number> {
  const event = await storage.createScript({
    name,
    type,
    content,
    serverId,
    status: EventStatus.ACTIVE,
    userId: "test-user",
    environment: JSON.stringify({
      TEST_VAR: "test-value",
      NODE_ENV: "test",
    }),
    runLocation: serverId ? "REMOTE" : "LOCAL",
  });
  return event.id;
}

async function testLocalContainerExecution() {
  console.log("\n=== Testing Local Container Execution ===\n");

  // Test Bash script
  const bashEventId = await createTestEvent(
    "Test Bash Container",
    EventType.BASH,
    `#!/bin/bash
echo "Testing Bash execution in container"
echo "Environment: $NODE_ENV"
echo "Test variable: $TEST_VAR"
echo "Cronium Job ID: $CRONIUM_JOB_ID"
echo "Execution mode: $CRONIUM_EXECUTION_MODE"
`,
  );

  // Test Python script
  const pythonEventId = await createTestEvent(
    "Test Python Container",
    EventType.PYTHON,
    `import os
print("Testing Python execution in container")
print(f"Environment: {os.environ.get('NODE_ENV', 'not set')}")
print(f"Test variable: {os.environ.get('TEST_VAR', 'not set')}")
print(f"Cronium Job ID: {os.environ.get('CRONIUM_JOB_ID', 'not set')}")
print(f"Execution mode: {os.environ.get('CRONIUM_EXECUTION_MODE', 'not set')}")
`,
  );

  // Test Node.js script
  const nodeEventId = await createTestEvent(
    "Test Node.js Container",
    EventType.NODEJS,
    `console.log("Testing Node.js execution in container");
console.log("Environment:", process.env.NODE_ENV);
console.log("Test variable:", process.env.TEST_VAR);
console.log("Cronium Job ID:", process.env.CRONIUM_JOB_ID);
console.log("Execution mode:", process.env.CRONIUM_EXECUTION_MODE);
`,
  );

  // Create jobs for each event type
  const events = [
    { id: bashEventId, name: "Bash" },
    { id: pythonEventId, name: "Python" },
    { id: nodeEventId, name: "Node.js" },
  ];

  for (const { id, name } of events) {
    const event = await storage.getEventWithRelations(id);
    if (!event) continue;

    const log = await storage.createLog({
      eventId: id,
      status: LogStatus.PENDING,
      startTime: new Date(),
      eventName: event.name,
      eventType: event.type,
      userId: event.userId,
    });

    const jobPayload = buildJobPayload(event, log.id);
    const jobType =
      event.type === EventType.HTTP_REQUEST
        ? JobType.HTTP_REQUEST
        : event.type === EventType.TOOL_ACTION
          ? JobType.TOOL_ACTION
          : JobType.SCRIPT;

    const job = await jobService.createJob({
      eventId: id,
      userId: event.userId,
      type: jobType,
      payload: jobPayload,
      metadata: {
        eventName: event.name,
        triggeredBy: "test",
        logId: log.id,
      },
    });

    console.log(`Created ${name} job: ${job.id}`);
    console.log(`  Type: ${job.type}`);
    console.log(`  Status: ${job.status}`);
    console.log(`  Target: Local container`);
  }
}

async function testRemoteSSHExecution() {
  console.log("\n=== Testing Remote SSH Execution ===\n");

  // Note: This requires a configured SSH server in the database
  const servers = await storage.getServersByUserId("test-user");
  if (servers.length === 0) {
    console.log("No SSH servers configured. Skipping SSH execution tests.");
    console.log(
      "To test SSH execution, add a server using the UI or database.",
    );
    return;
  }

  const serverId = servers[0].id;
  console.log(`Using server: ${servers[0].name} (${servers[0].host})`);

  // Test Bash script via SSH
  const sshEventId = await createTestEvent(
    "Test SSH Bash",
    EventType.BASH,
    `#!/bin/bash
echo "Testing Bash execution via SSH"
echo "Hostname: $(hostname)"
echo "User: $(whoami)"
echo "Environment: $NODE_ENV"
echo "Test variable: $TEST_VAR"
echo "Cronium Job ID: $CRONIUM_JOB_ID"
echo "Execution mode: $CRONIUM_EXECUTION_MODE"
`,
    serverId,
  );

  const event = await storage.getEventWithRelations(sshEventId);
  if (!event) return;

  const log = await storage.createLog({
    eventId: sshEventId,
    status: LogStatus.PENDING,
    startTime: new Date(),
    eventName: event.name,
    eventType: event.type,
    userId: event.userId,
  });

  const jobPayload = buildJobPayload(event, log.id);
  const job = await jobService.createJob({
    eventId: sshEventId,
    userId: event.userId,
    type: JobType.SCRIPT,
    payload: jobPayload,
    metadata: {
      eventName: event.name,
      triggeredBy: "test",
      logId: log.id,
    },
  });

  console.log(`Created SSH job: ${job.id}`);
  console.log(`  Type: ${job.type}`);
  console.log(`  Status: ${job.status}`);
  console.log(`  Target: SSH server ${serverId}`);
}

async function testWithRuntimeHelpers() {
  console.log("\n=== Testing Runtime Helper Access ===\n");

  // Test script that uses runtime helpers (only works in container mode)
  const helperEventId = await createTestEvent(
    "Test Runtime Helpers",
    EventType.NODEJS,
    `const cronium = require('cronium');

async function test() {
  try {
    console.log("Testing runtime helper functions...");
    
    // Test getting input
    const input = await cronium.input();
    console.log("Input data:", input);
    
    // Test setting output
    await cronium.output({ message: "Hello from runtime helper", timestamp: new Date() });
    console.log("Output set successfully");
    
    // Test variable operations
    await cronium.setVariable("test_var", "test_value");
    const value = await cronium.getVariable("test_var");
    console.log("Variable test_var:", value);
    
    // Test event context
    const event = await cronium.event();
    console.log("Event context:", event);
    
  } catch (error) {
    console.error("Runtime helper error:", error.message);
  }
}

test();
`,
  );

  const event = await storage.getEventWithRelations(helperEventId);
  if (!event) return;

  const log = await storage.createLog({
    eventId: helperEventId,
    status: LogStatus.PENDING,
    startTime: new Date(),
    eventName: event.name,
    eventType: event.type,
    userId: event.userId,
  });

  const jobPayload = buildJobPayload(event, log.id, { test: "input data" });
  const job = await jobService.createJob({
    eventId: helperEventId,
    userId: event.userId,
    type: JobType.SCRIPT,
    payload: jobPayload,
    metadata: {
      eventName: event.name,
      triggeredBy: "test",
      logId: log.id,
    },
  });

  console.log(`Created runtime helper test job: ${job.id}`);
  console.log("  This will demonstrate runtime API access in containers");
}

async function listCreatedJobs() {
  console.log("\n=== Created Jobs Summary ===\n");

  const { jobs } = await jobService.listJobs({ status: "queued" }, 10);
  console.log(`Total queued jobs: ${jobs.length}`);

  for (const job of jobs) {
    const payload = job.payload as any;
    console.log(`\nJob ${job.id}:`);
    console.log(`  Event ID: ${job.eventId}`);
    console.log(`  Type: ${job.type}`);
    console.log(`  Priority: ${job.priority}`);
    console.log(`  Script Type: ${payload.script?.type || "N/A"}`);
    console.log(
      `  Target: ${payload.target?.serverId ? `Server ${payload.target.serverId}` : "Local container"}`,
    );
  }

  console.log(
    "\n✅ Jobs are now queued and ready for the orchestrator to process",
  );
  console.log(
    "📋 Monitor execution with: docker logs -f cronium-orchestrator-dev",
  );
  console.log(
    "📊 Check job status with: pnpm tsx src/scripts/check-job-status.ts",
  );
}

async function main() {
  console.log("🚀 Testing Cronium Execution Types\n");
  console.log("This script creates test jobs to verify:");
  console.log("- Local container execution (Bash, Python, Node.js)");
  console.log("- Remote SSH execution");
  console.log("- Environment variable injection");
  console.log("- Runtime helper access\n");

  try {
    await testLocalContainerExecution();
    await testRemoteSSHExecution();
    await testWithRuntimeHelpers();
    await listCreatedJobs();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

// Run the tests
main().catch(console.error);
