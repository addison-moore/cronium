import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { authOptions } from "@/lib/auth";
import { users, userVariables } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";

const createCaller = createCallerFactory(appRouter);

async function testSingleHelper() {
  console.log("🧪 Testing Single Runtime Helper...\n");

  try {
    // Get or create test user
    const testEmail = "single-test@example.com";
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

    // Clean up any existing test variables
    await db
      .delete(userVariables)
      .where(
        and(
          eq(userVariables.userId, testUser.id),
          eq(userVariables.key, "SIMPLE_TEST"),
        ),
      );

    // Create a test variable
    await db.insert(userVariables).values({
      key: "SIMPLE_TEST",
      value: "Test Value 123",
      description: "Simple test variable",
      userId: testUser.id,
    });
    console.log("✅ Created test variable\n");

    // Create a simple event that just echoes
    console.log("🧪 Creating simple echo event...");
    const echoEvent = await caller.events.create({
      name: "Simple Echo Test",
      type: "BASH",
      content: `#!/bin/bash
echo "Starting simple test..."
echo "Current directory: $(pwd)"
echo "Environment check:"
echo "CRONIUM_EXECUTION_TOKEN: \${CRONIUM_EXECUTION_TOKEN:0:10}..."
echo "Test complete!"
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    console.log("🚀 Executing event...");
    const execution = await caller.events.execute({ id: echoEvent.id });
    console.log(`📋 Job ID: ${execution.jobId}`);

    // Wait for job completion
    console.log("⏳ Waiting for job to complete...");
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const job = await caller.jobs.get({ jobId: execution.jobId });
      console.log(`   Status: ${job.status}`);

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
    await caller.events.delete({ id: echoEvent.id });
    await db.delete(userVariables).where(eq(userVariables.userId, testUser.id));
    await db.delete(users).where(eq(users.id, testUser.id));

    console.log("✅ Test complete!");
  } catch (error) {
    console.error("❌ Error:", error);
  }

  process.exit(0);
}

void testSingleHelper();
