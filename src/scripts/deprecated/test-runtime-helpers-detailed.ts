import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { auth } from "@/lib/auth";
import { users, userVariables, jobs } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";

const createCaller = createCallerFactory(appRouter);

async function testRuntimeHelpersDetailed() {
  console.log("🧪 Testing Runtime Helper Functions in Detail...\n");

  try {
    // Get or create test user
    const testEmail = "runtime-helpers-detailed@example.com";
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
        name: testUser.firstName || "Test User",
        role: testUser.role,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    const caller = createCaller({
      session,
      headers: new Headers(),
      db,
      auth: auth as any,
    });

    // Create test variable
    console.log("📝 Setting up test data...");
    await db.delete(userVariables).where(eq(userVariables.userId, testUser.id));
    await db.insert(userVariables).values({
      key: "TEST_VAR",
      value: "Hello from database!",
      description: "Test variable",
      userId: testUser.id,
    });
    console.log("✅ Created test variable\n");

    // Test 1: Basic runtime helper test
    console.log("🧪 Test 1: Basic Runtime Helper Test");
    const basicTest = await caller.events.create({
      name: "Basic Runtime Helper Test",
      type: "BASH",
      content: `#!/bin/bash
# First, check if runtime helpers are available
if [ -f /usr/local/bin/cronium.sh ]; then
  echo "✅ Runtime helper script found"
  source /usr/local/bin/cronium.sh
else
  echo "❌ Runtime helper script NOT found at /usr/local/bin/cronium.sh"
  exit 1
fi

# Check environment variables
echo ""
echo "Environment check:"
echo "CRONIUM_RUNTIME_API: \${CRONIUM_RUNTIME_API:-not set}"
echo "CRONIUM_EXECUTION_TOKEN: \${CRONIUM_EXECUTION_TOKEN:+set (hidden)}"
echo "CRONIUM_EXECUTION_ID: \${CRONIUM_EXECUTION_ID:-not set}"

# Test runtime API connectivity
echo ""
echo "Testing Runtime API connectivity:"
if curl -s http://runtime-api:8081/health > /dev/null; then
  echo "✅ Runtime API is accessible"
else
  echo "❌ Runtime API is NOT accessible"
fi

# Test getVariable
echo ""
echo "Testing cronium_get_variable:"
result=$(cronium_get_variable "TEST_VAR")
if [ $? -eq 0 ]; then
  echo "✅ Function executed successfully"
  echo "   Value: '$result'"
else
  echo "❌ Function failed with exit code: $?"
fi
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    let execution = await caller.events.execute({ id: basicTest.id });
    const basicJob = await waitForJobCompletion(caller, execution.jobId);

    // Get full job details from database
    if (basicJob) {
      const fullJob = await db.query.jobs.findFirst({
        where: eq(jobs.id, execution.jobId),
      });
      if (fullJob?.logs) {
        console.log("   Full logs from database:");
        console.log("   ---");
        fullJob.logs.split("\n").forEach((line) => {
          console.log(`   ${line}`);
        });
        console.log("   ---");
      }
    }

    // Test 2: Test all bash functions
    console.log("\n🧪 Test 2: All Bash Runtime Helper Functions");
    const bashTest = await caller.events.create({
      name: "All Bash Functions Test",
      type: "BASH",
      content: `#!/bin/bash
source /usr/local/bin/cronium.sh

echo "=== Testing All Bash Runtime Helpers ==="
echo ""

# 1. getVariable
echo "1. Testing cronium_get_variable:"
value=$(cronium_get_variable "TEST_VAR")
echo "   Result: '$value'"

# 2. setVariable
echo ""
echo "2. Testing cronium_set_variable:"
cronium_set_variable "BASH_TEST" "Value from bash test"
echo "   Set BASH_TEST variable"

# 3. output
echo ""
echo "3. Testing cronium_output:"
cronium_output '{"test": "bash output data", "number": 123}'
echo "   Output data set"

# 4. event info
echo ""
echo "4. Testing cronium_event:"
event_data=$(cronium_event)
echo "   Event data: $event_data"

# 5. setCondition
echo ""
echo "5. Testing cronium_set_condition:"
cronium_set_condition "bash_test" "passed"
echo "   Condition set"

echo ""
echo "=== All tests complete ==="
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    execution = await caller.events.execute({ id: bashTest.id });
    await waitForJobCompletion(caller, execution.jobId);

    // Verify the variable was set
    const bashVar = await db.query.userVariables.findFirst({
      where: and(
        eq(userVariables.userId, testUser.id),
        eq(userVariables.key, "BASH_TEST"),
      ),
    });
    console.log(`   BASH_TEST variable created: ${bashVar ? "✅" : "❌"}`);
    if (bashVar) {
      console.log(`   Value: "${bashVar.value}"`);
    }

    // Test 3: Check HTTP endpoints directly
    console.log("\n🧪 Test 3: Direct HTTP Endpoint Test");
    const httpTest = await caller.events.create({
      name: "HTTP Endpoint Test",
      type: "BASH",
      content: `#!/bin/bash
echo "=== Testing HTTP Endpoints Directly ==="
echo ""

# Get token
TOKEN="\${CRONIUM_EXECUTION_TOKEN}"
if [ -z "$TOKEN" ]; then
  echo "❌ No execution token available"
  exit 1
fi

echo "✅ Token is available"
echo ""

# Test GET /api/v1/variables
echo "Testing GET /api/v1/variables/TEST_VAR:"
response=$(curl -s -w "\\nHTTP_CODE:%{http_code}" -H "Authorization: Bearer $TOKEN" http://runtime-api:8081/api/v1/variables/TEST_VAR)
http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)
body=$(echo "$response" | grep -v HTTP_CODE)
echo "   HTTP Status: $http_code"
echo "   Response: $body"

echo ""
echo "Testing POST /api/v1/variables:"
response=$(curl -s -w "\\nHTTP_CODE:%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"key":"HTTP_TEST","value":"Set via HTTP"}' http://runtime-api:8081/api/v1/variables)
http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)
body=$(echo "$response" | grep -v HTTP_CODE)
echo "   HTTP Status: $http_code"
echo "   Response: $body"
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    execution = await caller.events.execute({ id: httpTest.id });
    await waitForJobCompletion(caller, execution.jobId);

    // Cleanup
    console.log("\n🧹 Cleaning up...");

    // Clean up jobs first
    const jobsToDelete = await db.query.jobs.findMany({
      where: eq(jobs.userId, testUser.id),
    });
    for (const job of jobsToDelete) {
      await db.delete(jobs).where(eq(jobs.id, job.id));
    }

    // Then events
    await caller.events.delete({ id: basicTest.id });
    await caller.events.delete({ id: bashTest.id });
    await caller.events.delete({ id: httpTest.id });

    // Variables and user
    await db.delete(userVariables).where(eq(userVariables.userId, testUser.id));
    await db.delete(users).where(eq(users.id, testUser.id));

    console.log("✅ Cleanup complete");
  } catch (error) {
    console.error("❌ Error:", error);
  }

  process.exit(0);
}

async function waitForJobCompletion(caller: any, jobId: string) {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const job = await caller.jobs.get({ jobId });

    if (job.status === "completed" || job.status === "failed") {
      console.log(`   Job ${job.status}`);
      return job;
    }
  }

  console.log("   ⚠️ Job timed out");
  return null;
}

testRuntimeHelpersDetailed();
