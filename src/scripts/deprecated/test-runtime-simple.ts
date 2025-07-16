import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { auth } from "@/lib/auth";
import { users, userVariables, jobs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";

const createCaller = createCallerFactory(appRouter);

async function testRuntimeSimple() {
  console.log("🧪 Testing Simple Runtime Helper Execution...\n");

  try {
    // Get or create test user
    const testEmail = "runtime-simple@example.com";
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

    // Create simple test
    console.log("📝 Creating simple test event...");
    const testEvent = await caller.events.create({
      name: "Simple Echo Test",
      type: "BASH",
      content: `#!/bin/bash
echo "Starting test..."
echo "Current directory: $(pwd)"
echo "User: $(whoami)"
echo "Environment vars:"
env | grep CRONIUM || echo "No CRONIUM vars found"

# Test if runtime helper exists
if [ -f /usr/local/bin/cronium.sh ]; then
  echo ""
  echo "✅ Runtime helper found at /usr/local/bin/cronium.sh"
  echo "Contents:"
  head -20 /usr/local/bin/cronium.sh
else
  echo "❌ Runtime helper NOT found"
  ls -la /usr/local/bin/
fi

echo ""
echo "Test complete!"
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    console.log("🚀 Executing event...");
    const execution = await caller.events.execute({ id: testEvent.id });
    console.log(`   Job ID: ${execution.jobId}`);

    // Poll for completion
    console.log("⏳ Waiting for job completion...");
    let attempts = 0;
    let jobData = null;

    while (attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      jobData = await db.query.jobs.findFirst({
        where: eq(jobs.id, execution.jobId),
      });

      if (
        jobData &&
        (jobData.status === "completed" || jobData.status === "failed")
      ) {
        console.log(`   Job ${jobData.status}!`);
        break;
      }

      // Try to get logs even while running
      if (jobData && jobData.logs) {
        console.log("   Partial logs captured");
      }

      attempts++;
    }

    if (jobData) {
      console.log("\n📋 Job Details:");
      console.log(`   Status: ${jobData.status}`);
      console.log(`   Exit Code: ${jobData.exitCode}`);
      console.log(`   Error: ${jobData.error || "None"}`);
      console.log("\n📜 Full Logs:");
      console.log("---");
      if (jobData.logs) {
        console.log(jobData.logs);
      } else {
        console.log("No logs captured");
      }
      console.log("---");
    }

    // Cleanup
    console.log("\n🧹 Cleaning up...");
    await caller.events.delete({ id: testEvent.id });
    await db.delete(userVariables).where(eq(userVariables.userId, testUser.id));
    await db.delete(users).where(eq(users.id, testUser.id));

    console.log("✅ Test complete");
  } catch (error) {
    console.error("❌ Error:", error);
  }

  process.exit(0);
}

testRuntimeSimple();
