import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { TRPCError } from "@trpc/server";
import {
  users,
  UserRole,
  UserStatus,
  EventType,
  EventStatus,
  RunLocation,
  JobStatus,
} from "@/shared/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";
import type { Session } from "next-auth";

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
          role: UserRole.ADMIN,
        })
        .returning();
      testUser = newUser;
      console.log("✅ Test user created\n");
    }

    if (!testUser) {
      throw new Error("Failed to create or find test user");
    }

    // Create a test user session
    const session: Session = {
      user: {
        id: testUser.id,
        email: testUser.email,
        name: testUser.firstName ?? "Test User",
        role: testUser.role,
        status: testUser.status || UserStatus.ACTIVE,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    // Create caller with session
    const caller = createCaller({
      session,
      headers: new Headers(),
      db,
    });

    // Step 1: Create a simple test event
    console.log("📝 Creating test event...");
    const event = await caller.events.create({
      name: "Test Container Execution",
      description: "Simple test to verify container execution",
      type: EventType.BASH,
      content: 'echo "Hello from container!"',
      status: EventStatus.ACTIVE,
      runLocation: RunLocation.LOCAL,
    });

    if (!event) {
      throw new Error("Failed to create test event");
    }

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

      const jobResponse = await caller.jobs.get({ jobId: execution.jobId });
      const job = jobResponse.data;
      console.log(
        `   Status: ${job.status} (Attempt ${attempts + 1}/${maxAttempts})`,
      );

      if (
        job.status === JobStatus.COMPLETED ||
        job.status === JobStatus.FAILED
      ) {
        console.log(`\n✅ Job finished with status: ${job.status}`);

        if (
          job.result &&
          typeof job.result === "object" &&
          "output" in job.result
        ) {
          console.log("\n📋 Job output:");
          console.log("---");
          console.log((job.result as { output: string }).output);
          console.log("---");
        }

        if (job.lastError) {
          console.log("\n❌ Job error:", job.lastError);
        }

        // Step 4: Check if job appears in queue history
        console.log("\n📊 Checking job queue history...");
        const jobsResponse = await caller.jobs.list({ limit: 5 });
        const ourJob = jobsResponse.items.find((j) => j.id === execution.jobId);
        if (ourJob) {
          console.log("✅ Job found in queue history");
          console.log(`   Orchestrator: ${ourJob.orchestratorId ?? "N/A"}`);
          console.log(
            `   Started: ${ourJob.startedAt?.toISOString() ?? "N/A"}`,
          );
          console.log(
            `   Completed: ${ourJob.completedAt?.toISOString() ?? "N/A"}`,
          );
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
    await db.delete(users).where(eq(users.id, testUser.id));
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
void testContainerExecution();
