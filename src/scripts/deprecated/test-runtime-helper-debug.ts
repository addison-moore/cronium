import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { authOptions } from "@/lib/auth";
import { users, userVariables } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";

const createCaller = createCallerFactory(appRouter);

async function testRuntimeHelperDebug() {
  console.log("🧪 Testing runtime helper with debug output...\n");

  try {
    // Get or create test user
    const testEmail = "runtime-debug@example.com";
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

    console.log("✅ Got test user:", testUser.id);

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

    // Create a test variable
    await db.delete(userVariables).where(eq(userVariables.userId, testUser.id));

    await db.insert(userVariables).values({
      key: "DEBUG_TEST_VAR",
      value: "Test Value 123",
      description: "Debug test variable",
      userId: testUser.id,
    });
    console.log("✅ Created test variable\n");

    // Test with debugging output
    console.log("📝 Creating event with runtime helper debugging...");
    const debugEvent = await caller.events.create({
      name: "Debug Runtime Helper",
      type: "BASH",
      content: `#!/bin/bash
echo "=== Runtime Helper Debug Test ==="
echo "Starting at: $(date)"
echo ""

# Check if cronium.sh exists
echo "Checking for cronium.sh..."
if [ -f /usr/local/bin/cronium.sh ]; then
  echo "✓ Found /usr/local/bin/cronium.sh"
else
  echo "✗ /usr/local/bin/cronium.sh not found"
  ls -la /usr/local/bin/ 2>&1 || echo "Cannot list /usr/local/bin"
fi

# Try to source it
echo ""
echo "Attempting to source cronium.sh..."
if source /usr/local/bin/cronium.sh 2>&1; then
  echo "✓ Successfully sourced cronium.sh"
else
  echo "✗ Failed to source cronium.sh"
fi

# Check if functions are available
echo ""
echo "Checking for cronium functions..."
type cronium_get_variable 2>&1 || echo "✗ cronium_get_variable not found"
type cronium_set_variable 2>&1 || echo "✗ cronium_set_variable not found"

# Check environment
echo ""
echo "Environment check:"
echo "CRONIUM_EXECUTION_TOKEN: \${CRONIUM_EXECUTION_TOKEN:0:20}..."
echo "PATH: $PATH"
echo "PWD: $PWD"

# Try to get variable
echo ""
echo "Attempting to get variable DEBUG_TEST_VAR..."
if command -v cronium_get_variable &> /dev/null; then
  value=$(cronium_get_variable "DEBUG_TEST_VAR" 2>&1)
  echo "Result: '$value'"
else
  echo "✗ cronium_get_variable command not available"
fi

echo ""
echo "=== Test Complete ==="
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    console.log("✅ Created event:", debugEvent.id);

    console.log("🚀 Executing event...");
    const execution = await caller.events.execute({ id: debugEvent.id });
    console.log("✅ Execution started, job ID:", execution.jobId);

    // Poll for completion
    console.log("⏳ Waiting for job to complete...\n");
    let attempts = 0;
    let lastStatus = "";
    while (attempts < 60) {
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        const job = await caller.jobs.get({ jobId: execution.jobId });

        if (job.status !== lastStatus) {
          console.log(`Status changed: ${lastStatus} → ${job.status}`);
          lastStatus = job.status;
        }

        if (job.status === "completed" || job.status === "failed") {
          console.log(`\n✅ Job ${job.status}!`);

          if (job.logs) {
            console.log("\n📝 Full output:");
            console.log("=".repeat(60));
            console.log(job.logs);
            console.log("=".repeat(60));
          }

          if (job.result) {
            console.log("\n📊 Result:", JSON.stringify(job.result, null, 2));
          }

          break;
        }
      } catch (error) {
        console.error(`Error getting job:`, error);
      }
    }

    if (attempts >= 60) {
      console.log("\n⚠️ Job timed out after 60 attempts");
    }

    // Cleanup
    console.log("\n🧹 Cleaning up...");
    await db.delete(userVariables).where(eq(userVariables.userId, testUser.id));

    console.log("✅ Test complete!");
  } catch (error) {
    console.error("❌ Error:", error);
    if (error instanceof Error) {
      console.error("Stack:", error.stack);
    }
  }

  process.exit(0);
}

void testRuntimeHelperDebug();
