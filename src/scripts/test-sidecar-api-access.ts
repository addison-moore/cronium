import { exec } from "child_process";
import { promisify } from "util";
import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { auth } from "@/lib/auth";
import { users, jobs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);
const createCaller = createCallerFactory(appRouter);

async function testSidecarAPIAccess() {
  console.log("🧪 Testing Sidecar API Accessibility...\n");

  try {
    // Ensure test user exists
    const testEmail = "sidecar-api-test@example.com";
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

    // Create session and caller
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

    // Create test event that will test the sidecar
    console.log("📝 Creating test event...");
    const event = await caller.events.create({
      name: "Sidecar API Access Test",
      description: "Test accessing the runtime API from within container",
      type: "BASH",
      content: `#!/bin/bash
echo "=== Testing Runtime API Access ==="
echo ""

# Test 1: Check if runtime-api hostname resolves
echo "1. Testing DNS resolution..."
nslookup runtime-api 2>&1 || echo "DNS lookup failed"
echo ""

# Test 2: Try to access health endpoint
echo "2. Testing health endpoint..."
wget -q -O- http://runtime-api:8081/health 2>&1 || echo "Health check failed"
echo ""

# Test 3: Check environment variables
echo "3. Checking environment variables..."
echo "RUNTIME_API_URL: \${RUNTIME_API_URL:-not set}"
echo "RUNTIME_API_TOKEN: \${RUNTIME_API_TOKEN:-not set}"
echo ""

# Test 4: Try authenticated endpoint
echo "4. Testing authenticated endpoint..."
if [ -n "\${RUNTIME_API_TOKEN}" ]; then
  wget -q -O- --header="Authorization: Bearer \${RUNTIME_API_TOKEN}" http://runtime-api:8081/api/v1/event 2>&1 || echo "Auth endpoint failed"
else
  echo "No token available"
fi
echo ""

echo "=== Tests Complete ==="
`,
      status: "ACTIVE",
      runLocation: "LOCAL",
    });
    console.log(`✅ Created event: ${event.name} (ID: ${event.id})\n`);

    // Execute the event
    console.log("🚀 Executing event...");
    const execution = await caller.events.execute({ id: event.id });
    console.log(`✅ Event execution triggered (Job ID: ${execution.jobId})\n`);

    // Monitor execution and capture logs
    console.log("📊 Monitoring execution...\n");
    let jobLogs = "";
    let sidecarFound = false;

    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check job status
      const job = await caller.jobs.get({ jobId: execution.jobId });

      // Check for sidecar
      if (!sidecarFound) {
        const { stdout } = await execAsync(
          `docker ps --filter "label=cronium.job.id=${execution.jobId}" --filter "label=cronium.type=sidecar" --format "{{.Names}}" | head -1`,
        );
        if (stdout.trim()) {
          sidecarFound = true;
          console.log(`✅ Sidecar detected: ${stdout.trim()}`);
        }
      }

      if (job.logs) {
        jobLogs = job.logs;
      }

      if (job.status === "completed" || job.status === "failed") {
        console.log(`\n✅ Job ${job.status} after ${i} seconds\n`);
        break;
      }
    }

    // Display job logs
    console.log("📋 Job Output:");
    console.log("---");
    console.log(jobLogs || "No logs captured");
    console.log("---\n");

    // Check sidecar logs
    console.log("🔍 Checking sidecar status...");
    const { stdout: sidecarInfo } = await execAsync(
      `docker ps -a --filter "label=cronium.job.id=${execution.jobId}" --filter "label=cronium.type=sidecar" --format "{{.Names}}|{{.Status}}" | head -1`,
    );

    if (sidecarInfo.trim()) {
      const [name, status] = sidecarInfo.trim().split("|");
      console.log(`   Sidecar: ${name}`);
      console.log(`   Status: ${status}`);

      // Get sidecar logs
      const { stdout: sidecarLogs } = await execAsync(
        `docker logs ${name} 2>&1 | tail -20`,
      );
      console.log("\n📋 Sidecar Logs:");
      console.log("---");
      console.log(sidecarLogs);
      console.log("---");
    }

    // Check JWT token in environment
    console.log("\n🔐 Checking JWT token configuration...");
    const { stdout: tokenInfo } = await execAsync(
      `docker logs cronium-agent-dev 2>&1 | grep "${execution.jobId}" | grep -i "token" | tail -5`,
    );
    if (tokenInfo) {
      console.log("Token-related logs found:");
      console.log(tokenInfo);
    } else {
      console.log("No token-related logs found");
    }

    // Cleanup
    console.log("\n🧹 Cleaning up...");
    try {
      // Clean up job first
      await db.delete(jobs).where(eq(jobs.id, execution.jobId));
      // Then event
      await caller.events.delete({ id: event.id });
    } catch (e) {
      // Ignore cleanup errors
    }
    await db.delete(users).where(eq(users.id, testUser!.id));
    console.log("✅ Cleanup complete");
  } catch (error) {
    console.error("❌ Test failed:", error);
  }

  process.exit(0);
}

testSidecarAPIAccess();
