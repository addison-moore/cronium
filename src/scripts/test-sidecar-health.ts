import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { authOptions } from "@/lib/auth";
import {
  users,
  UserRole,
  EventType,
  EventStatus,
  RunLocation,
  UserStatus,
  JobStatus,
} from "@/shared/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";
import type { Session } from "next-auth";

const createCaller = createCallerFactory(appRouter);

async function testSidecarHealth() {
  console.log("🏥 Testing Sidecar Health Check...\n");

  try {
    // Get or create test user
    const testEmail = "sidecar-health@example.com";
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
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        })
        .returning();
      testUser = newUser;
    }

    if (!testUser) {
      throw new Error("Failed to create or find test user");
    }

    const session: Session = {
      user: {
        id: testUser.id,
        email: testUser.email,
        name: testUser.firstName || "Test User",
        role: testUser.role,
        status: testUser.status,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    const caller = createCaller({
      session,
      headers: new Headers(),
      db,
    });

    // Create test event
    console.log("📝 Creating test event...");
    const event = await caller.events.create({
      name: "Sidecar Health Check",
      type: EventType.BASH,
      content: `#!/bin/bash
echo "=== Testing Sidecar Health ==="
echo ""

# Check environment
echo "Environment Variables:"
echo "CRONIUM_RUNTIME_API: \${CRONIUM_RUNTIME_API}"
echo "CRONIUM_EXECUTION_TOKEN: \${CRONIUM_EXECUTION_TOKEN:0:10}..." # Show first 10 chars
echo "CRONIUM_EXECUTION_ID: \${CRONIUM_EXECUTION_ID}"
echo ""

# Test health endpoint (no auth required)
echo "Testing health endpoint:"
curl -s http://runtime-api:8081/health || echo "Health check failed"
echo ""

# Test with token
echo "Testing authenticated endpoint:"
if [ -n "\${CRONIUM_EXECUTION_TOKEN}" ]; then
  curl -s -H "Authorization: Bearer \${CRONIUM_EXECUTION_TOKEN}" http://runtime-api:8081/api/v1/event || echo "Auth failed"
else
  echo "No token available"
fi
echo ""

echo "=== Test Complete ==="
`,
      status: EventStatus.ACTIVE,
      runLocation: RunLocation.LOCAL,
    });

    if (!event) {
      throw new Error("Failed to create event");
    }

    console.log(`✅ Created event ${event.id}\n`);

    // Execute
    console.log("🚀 Executing...");
    const execution = await caller.events.execute({ id: event.id });
    console.log(`✅ Job ID: ${execution.jobId}\n`);

    // Wait for completion
    console.log("⏳ Waiting for completion...\n");
    let jobResult = null;

    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const jobResponse = await caller.jobs.get({ jobId: execution.jobId });
      const job = jobResponse.data;

      if (
        job.status === JobStatus.COMPLETED ||
        job.status === JobStatus.FAILED
      ) {
        jobResult = job;
        console.log(`✅ Job ${job.status}\n`);
        break;
      }
    }

    if (
      jobResult?.result &&
      typeof jobResult.result === "object" &&
      "output" in jobResult.result
    ) {
      const output = (jobResult.result as { output?: string }).output;
      if (output) {
        console.log("📋 Output:");
        console.log("---");
        console.log(output);
        console.log("---\n");
      }
    }

    // Cleanup
    console.log("🧹 Cleaning up...");
    await db.delete(users).where(eq(users.id, testUser.id));
    console.log("✅ Done");
  } catch (error) {
    console.error("❌ Error:", error);
  }

  process.exit(0);
}

testSidecarHealth();
