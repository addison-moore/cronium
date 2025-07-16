import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { authOptions } from "@/lib/auth";
import { users, userVariables } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";

const createCaller = createCallerFactory(appRouter);

async function testGetVariable() {
  console.log("🧪 Testing cronium.getVariable()...\n");

  try {
    // Get or create test user
    const testEmail = "getvar-test@example.com";
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

    // Create a test variable
    await db.delete(userVariables).where(eq(userVariables.userId, testUser.id));

    await db.insert(userVariables).values({
      key: "TEST_VAR",
      value: "Hello from database!",
      description: "Test variable for runtime helpers",
      userId: testUser.id,
    });
    console.log("✅ Created test variable\n");

    // Test 1: cronium.getVariable()
    console.log("🧪 Creating event to test getVariable...");
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

    const execution = await caller.events.execute({ id: getVarEvent.id });
    console.log(`📋 Job ID: ${execution.jobId}`);

    // Wait for job completion
    console.log("⏳ Waiting for job to complete...");
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const job = await caller.jobs.get({ jobId: execution.jobId });

      if (job.status === "completed" || job.status === "failed") {
        console.log(`\n✅ Job ${job.status}`);

        if (job.logs) {
          console.log("\n📝 Output:");
          console.log("---");
          console.log(job.logs);
          console.log("---");
        }

        break;
      }
    }

    // Cleanup
    console.log("\n🧹 Cleaning up...");
    await db.delete(userVariables).where(eq(userVariables.userId, testUser.id));
    await db.delete(users).where(eq(users.id, testUser.id));

    console.log("✅ Test complete!");
  } catch (error) {
    console.error("❌ Error:", error);
  }

  process.exit(0);
}

void testGetVariable();
