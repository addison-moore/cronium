import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { authOptions } from "@/lib/auth";
import { users, userVariables } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";

const createCaller = createCallerFactory(appRouter);

async function testRuntimeHelpers() {
  console.log("🧪 Testing Runtime Helper Functions...\n");

  try {
    // Get or create test user
    const testEmail = "runtime-helpers@example.com";
    let testUser = await db.query.users.findFirst({
      where: eq(users.email, testEmail),
    });

    if (!testUser) {
      const hashedPassword = await hash("password123", 10);
      const [newUser] = await db
        .insert(users)
        .values({
          id: randomUUID(),
          email: testEmail,
          password: hashedPassword,
          role: "admin",
        })
        .returning();
      testUser = newUser;
    }

    const session = {
      user: {
        id: testUser.id,
        email: testUser.email,
        name: testUser.firstName ?? "Test User",
        role: testUser.role,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    const caller = createCaller({
      session,
      headers: new Headers(),
      db,
      auth: authOptions,
    });

    // Create test variables
    console.log("📝 Creating test variables...");

    // Clean up any existing test variables
    await db
      .delete(userVariables)
      .where(
        and(
          eq(userVariables.userId, testUser.id),
          eq(userVariables.key, "TEST_VAR"),
        ),
      );

    // Create a test variable
    await db.insert(userVariables).values({
      key: "TEST_VAR",
      value: "Hello from database!",
      description: "Test variable for runtime helpers",
      userId: testUser.id,
    });
    console.log("✅ Created test variable\n");

    // Test 1: cronium.getVariable()
    console.log("🧪 Test 1: cronium.getVariable()");
    const getVarEvent = await caller.events.create({
      name: "Test getVariable",
      type: "BASH",
      content: `#!/bin/bash
source /usr/local/bin/cronium.sh

echo "Testing cronium.getVariable()..."
value=$(cronium_get_variable "TEST_VAR")
echo "Retrieved value: $value"

# Test non-existent variable
missing=$(cronium_get_variable "MISSING_VAR")
echo "Missing variable (should be empty): '$missing'"
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    let execution = await caller.events.execute({ id: getVarEvent.id });
    await waitForJobCompletion(caller, execution.jobId, "getVariable");

    // Test 2: cronium.setVariable()
    console.log("\n🧪 Test 2: cronium.setVariable()");
    const setVarEvent = await caller.events.create({
      name: "Test setVariable",
      type: "BASH",
      content: `#!/bin/bash
source /usr/local/bin/cronium.sh

echo "Testing cronium.setVariable()..."
cronium_set_variable "NEW_VAR" "Created by runtime helper"
echo "Variable set successfully"

# Update existing variable
cronium_set_variable "TEST_VAR" "Updated value!"
echo "Updated existing variable"
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    execution = await caller.events.execute({ id: setVarEvent.id });
    await waitForJobCompletion(caller, execution.jobId, "setVariable");

    // Verify variables were set
    const newVar = await db.query.userVariables.findFirst({
      where: and(
        eq(userVariables.userId, testUser.id),
        eq(userVariables.key, "NEW_VAR"),
      ),
    });
    console.log(`   NEW_VAR created: ${newVar ? "✅" : "❌"}`);
    if (newVar) {
      console.log(`   Value: "${newVar.value}"`);
    }

    // Test 3: cronium.input() and cronium.output()
    console.log("\n🧪 Test 3: cronium.input() and cronium.output()");

    // First event to set output
    const outputEvent = await caller.events.create({
      name: "Test output",
      type: "BASH",
      content: `#!/bin/bash
source /usr/local/bin/cronium.sh

echo "Setting output data..."
cronium_output '{"message": "Hello from first event!", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
echo "Output set"
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    execution = await caller.events.execute({ id: outputEvent.id });
    const outputJobId = execution.jobId;
    await waitForJobCompletion(caller, outputJobId, "output");

    // Second event to read input (would normally be triggered by conditional action)
    const inputEvent = await caller.events.create({
      name: "Test input",
      type: "BASH",
      content: `#!/bin/bash
source /usr/local/bin/cronium.sh

echo "Reading input data..."
input=$(cronium_input)
echo "Input received: $input"

# Parse JSON if jq is available
if command -v jq &> /dev/null; then
  message=$(echo "$input" | jq -r '.message // "No message"')
  echo "Parsed message: $message"
fi
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    // For testing, we'll manually set the parent job ID (normally done by conditional actions)
    execution = await caller.events.execute({ id: inputEvent.id });
    await waitForJobCompletion(caller, execution.jobId, "input");

    // Test 4: cronium.event()
    console.log("\n🧪 Test 4: cronium.event()");
    const eventInfoEvent = await caller.events.create({
      name: "Test event info",
      type: "BASH",
      content: `#!/bin/bash
source /usr/local/bin/cronium.sh

echo "Testing cronium.event()..."
event_info=$(cronium_event)
echo "Event metadata: $event_info"

# Parse specific fields if jq is available
if command -v jq &> /dev/null; then
  event_id=$(echo "$event_info" | jq -r '.eventId // "Unknown"')
  job_id=$(echo "$event_info" | jq -r '.jobId // "Unknown"')
  echo "Event ID: $event_id"
  echo "Job ID: $job_id"
fi
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    execution = await caller.events.execute({ id: eventInfoEvent.id });
    await waitForJobCompletion(caller, execution.jobId, "event");

    // Test 5: cronium.setCondition()
    console.log("\n🧪 Test 5: cronium.setCondition()");
    const conditionEvent = await caller.events.create({
      name: "Test setCondition",
      type: "BASH",
      content: `#!/bin/bash
source /usr/local/bin/cronium.sh

echo "Testing cronium.setCondition()..."

# Set a success condition
cronium_set_condition "task_completed" "true"
echo "Set condition: task_completed=true"

# Set a data condition
cronium_set_condition "result_count" "42"
echo "Set condition: result_count=42"
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    execution = await caller.events.execute({ id: conditionEvent.id });
    await waitForJobCompletion(caller, execution.jobId, "setCondition");

    // Test with other script types
    console.log("\n🧪 Test 6: Python runtime helpers");
    const pythonEvent = await caller.events.create({
      name: "Test Python helpers",
      type: "PYTHON",
      content: `#!/usr/bin/env python3
import cronium

print("Testing Python runtime helpers...")

# Get variable
value = cronium.get_variable("TEST_VAR")
print(f"Retrieved value: {value}")

# Set variable
cronium.set_variable("PYTHON_VAR", "Set from Python")
print("Set PYTHON_VAR")

# Get event info
event_info = cronium.event()
print(f"Event info: {event_info}")
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    execution = await caller.events.execute({ id: pythonEvent.id });
    await waitForJobCompletion(caller, execution.jobId, "Python helpers");

    // Cleanup
    console.log("\n🧹 Cleaning up...");

    // Delete events
    await caller.events.delete({ id: getVarEvent.id });
    await caller.events.delete({ id: setVarEvent.id });
    await caller.events.delete({ id: outputEvent.id });
    await caller.events.delete({ id: inputEvent.id });
    await caller.events.delete({ id: eventInfoEvent.id });
    await caller.events.delete({ id: conditionEvent.id });
    await caller.events.delete({ id: pythonEvent.id });

    // Delete variables
    await db.delete(userVariables).where(eq(userVariables.userId, testUser.id));

    // Delete user
    await db.delete(users).where(eq(users.id, testUser.id));

    console.log("✅ Cleanup complete");
  } catch (error) {
    console.error("❌ Error:", error);
  }

  process.exit(0);
}

async function waitForJobCompletion(
  caller: ReturnType<typeof createCaller>,
  jobId: string,
  testName: string,
) {
  console.log(`   Waiting for ${testName} job to complete...`);

  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const job = await caller.jobs.get({ jobId });

    if (job.status === "completed" || job.status === "failed") {
      console.log(`   Job ${job.status}`);

      if (job.logs) {
        console.log("   Output:");
        console.log("   ---");
        const logLines = job.logs.split("\n");
        logLines.forEach((line) => {
          console.log(`   ${line}`);
        });
        console.log("   ---");
      }

      return job;
    }
  }

  console.log("   ⚠️ Job timed out");
  return null;
}

void testRuntimeHelpers();
