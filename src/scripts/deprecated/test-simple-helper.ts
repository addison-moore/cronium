import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { authOptions } from "@/lib/auth";
import { users, userVariables } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";

const createCaller = createCallerFactory(appRouter);

async function testSimpleHelper() {
  console.log("🧪 Starting simple runtime helper test...\n");

  try {
    // Get or create test user
    const testEmail = "simple-helper@example.com";
    console.log("📝 Looking for test user...");

    let testUser = await db.query.users.findFirst({
      where: eq(users.email, testEmail),
    });

    if (!testUser) {
      console.log("📝 Creating test user...");
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

    console.log("📝 Creating caller...");
    const caller = createCaller({
      session,
      headers: new Headers(),
      db,
      auth: authOptions,
    });

    // Create a simple bash event
    console.log("📝 Creating simple bash event...");
    const bashEvent = await caller.events.create({
      name: "Simple Bash Test",
      type: "BASH",
      content: `#!/bin/bash
echo "Hello from bash script!"
echo "Job ID: $JOB_ID"
echo "Current directory: $(pwd)"
exit 0
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });

    console.log("✅ Created event:", bashEvent.id);

    console.log("🚀 Executing event...");
    const execution = await caller.events.execute({ id: bashEvent.id });
    console.log("✅ Execution started, job ID:", execution.jobId);

    // Poll for completion
    console.log("⏳ Waiting for job to complete...");
    let attempts = 0;
    while (attempts < 30) {
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        const job = await caller.jobs.get({ jobId: execution.jobId });
        console.log(`   Attempt ${attempts}: Status = ${job.status}`);

        if (job.status === "completed" || job.status === "failed") {
          console.log(`\n✅ Job ${job.status}!`);

          if (job.logs) {
            console.log("\n📝 Logs:");
            console.log("---");
            console.log(job.logs);
            console.log("---");
          }

          if (job.result) {
            console.log("\n📊 Result:", JSON.stringify(job.result, null, 2));
          }

          break;
        }
      } catch (error) {
        console.error(`   Attempt ${attempts}: Error getting job:`, error);
      }
    }

    if (attempts >= 30) {
      console.log("\n⚠️ Job timed out after 30 attempts");
    }

    // Cleanup
    console.log("\n🧹 Cleaning up...");
    try {
      // Delete jobs first to avoid foreign key constraint
      await db
        .delete(userVariables)
        .where(eq(userVariables.userId, testUser.id));
      console.log("✅ Deleted user variables");
    } catch (error) {
      console.error("Error deleting variables:", error);
    }

    console.log("✅ Test complete!");
  } catch (error) {
    console.error("❌ Error:", error);
    if (error instanceof Error) {
      console.error("Stack:", error.stack);
    }
  }

  process.exit(0);
}

// Add error handling for unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

void testSimpleHelper();
