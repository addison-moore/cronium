import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { auth } from "@/lib/auth";
import { TRPCError } from "@trpc/server";
import { users } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";

const createCaller = createCallerFactory(appRouter);

async function testContainerExecution() {
  console.log("🧪 Testing basic container execution...\n");

  try {
    // First, ensure we have a test user
    const testEmail = "test-container@example.com";
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
      console.log("✅ Test user created\n");
    }

    // Create a test user session
    const session = {
      user: {
        id: testUser.id,
        email: testUser.email,
        name: testUser.firstName || "Test User",
        role: testUser.role,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    // Create caller with session
    const caller = createCaller({
      session,
      headers: new Headers(),
      db,
      auth: auth as any,
    });

    // Step 1: Create a simple test event
    console.log("📝 Creating test event...");
    const event = await caller.events.create({
      name: "Test Container Execution",
      description: "Simple test to verify container execution",
      type: "BASH",
      content: 'echo "Hello from container!"',
      status: "ACTIVE",
      runLocation: "LOCAL",
    });
    console.log(`✅ Created event: ${event.name} (ID: ${event.id})\n`);

    // Step 2: Execute the event
    console.log("🚀 Executing event...");
    const execution = await caller.events.execute({ id: event.id });
    console.log(`✅ Event execution triggered (Job ID: ${execution.jobId})\n`);

    // Step 3: Wait and check job status
    console.log("⏳ Waiting for job to be processed...");
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second

      const job = await caller.jobs.get({ jobId: execution.jobId });
      console.log(
        `   Status: ${job.status} (Attempt ${attempts + 1}/${maxAttempts})`,
      );

      if (job.status === "completed" || job.status === "failed") {
        console.log(`\n✅ Job finished with status: ${job.status}`);

        if (job.logs) {
          console.log("\n📋 Job logs:");
          console.log("---");
          console.log(job.logs);
          console.log("---");
        }

        if (job.error) {
          console.log("\n❌ Job error:", job.error);
        }

        // Step 4: Check if job appears in queue history
        console.log("\n📊 Checking job queue history...");
        const jobs = await caller.jobs.list({ limit: 5 });
        const ourJob = jobs.jobs.find((j) => j.id === execution.jobId);
        if (ourJob) {
          console.log("✅ Job found in queue history");
          console.log(`   Container: ${ourJob.container || "N/A"}`);
          console.log(`   Started: ${ourJob.startedAt || "N/A"}`);
          console.log(`   Completed: ${ourJob.completedAt || "N/A"}`);
        }

        break;
      }

      attempts++;
    }

    if (attempts >= maxAttempts) {
      console.log("\n⚠️ Timeout: Job did not complete within 30 seconds");
    }

    // Cleanup: Delete the test event and user
    console.log("\n🧹 Cleaning up...");
    await caller.events.delete({ id: event.id });
    console.log("✅ Test event deleted");

    // Delete the test user
    await db.delete(users).where(eq(users.id, testUser!.id));
    console.log("✅ Test user deleted");
  } catch (error) {
    console.error("❌ Test failed:", error);
    if (error instanceof TRPCError) {
      console.error("TRPC Error:", error.message, error.code);
    }
  }

  process.exit(0);
}

// Run the test
testContainerExecution();
