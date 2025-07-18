import { exec } from "child_process";
import { promisify } from "util";
import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
// import { authOptions } from "@/lib/auth";
import {
  users,
  jobs,
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

const execAsync = promisify(exec);
const createCaller = createCallerFactory(appRouter);

async function testSidecarSimple() {
  console.log("🧪 Simple Sidecar Test...\n");

  try {
    // Use existing test user or create one
    const testEmail = "sidecar-simple@example.com";
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
        })
        .returning();
      testUser = newUser;
    }

    const session = {
      user: {
        id: testUser!.id,
        email: testUser!.email,
        name: testUser!.firstName ?? "Test User",
        role: testUser!.role,
        status: UserStatus.ACTIVE,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    const caller = createCaller({
      session,
      headers: new Headers(),
      db,
    });

    // Create a simple test event
    console.log("📝 Creating test event...");
    const event = await caller.events.create({
      name: "Simple Sidecar Test",
      type: EventType.BASH,
      content: `#!/bin/bash
echo "Testing runtime API..."
# Check if runtime-api is reachable
if wget -q -O- http://runtime-api:8081/health 2>/dev/null; then
  echo "✅ Runtime API is accessible!"
else
  echo "❌ Runtime API is NOT accessible"
fi
echo "Test complete."`,
      status: EventStatus.ACTIVE,
      runLocation: RunLocation.LOCAL,
    });
    console.log(`✅ Created event ${event!.id}\n`);

    // Execute
    console.log("🚀 Executing...");
    const execution = await caller.events.execute({ id: event!.id });
    const jobId = execution.jobId;
    console.log(`✅ Job ID: ${jobId}\n`);

    // Monitor
    console.log("⏳ Monitoring...\n");
    let sidecarId = "";

    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check for sidecar
      if (!sidecarId) {
        const { stdout } = await execAsync(
          `docker ps --filter "label=cronium.job.id=${jobId}" --filter "label=cronium.type=sidecar" --format "{{.ID}}" | head -1`,
        );
        if (stdout.trim()) {
          sidecarId = stdout.trim();
          console.log(`✅ Sidecar created: ${sidecarId.substring(0, 12)}`);
        }
      }

      // Check job
      const jobResponse = await caller.jobs.get({ jobId });
      const job = jobResponse.data;
      console.log(`   Status: ${job.status}`);

      if (
        job.status === JobStatus.COMPLETED ||
        job.status === JobStatus.FAILED
      ) {
        // Job completed
        const output = (job.result as { output?: string })?.output ?? "No logs";
        console.log(`\n📋 Job Logs:\n${String(output)}\n`);
        break;
      }
    }

    // Check sidecar details
    if (sidecarId) {
      console.log("🔍 Sidecar Details:");

      // Get sidecar info
      const { stdout: inspect } = await execAsync(
        `docker inspect ${sidecarId} 2>/dev/null || echo '{}'`,
      );
      if (inspect && inspect !== "{}") {
        const inspectArray = JSON.parse(inspect) as Array<{
          State: { Status: string; Health?: { Status: string } };
          Config: { Env?: string[] };
        }>;
        const details = inspectArray[0];
        if (!details) {
          console.log("   No container details available");
          return;
        }
        console.log(`   State: ${String(details.State.Status)}`);
        console.log(
          `   Health: ${details.State.Health?.Status ?? "No health check"}`,
        );

        // Check if token was injected
        const envVars = details.Config.Env ?? [];
        const hasToken = envVars.some((e: string) =>
          e.startsWith("RUNTIME_API_TOKEN="),
        );
        console.log(`   Token injected: ${hasToken ? "✅ Yes" : "❌ No"}`);
      }

      // Get sidecar logs
      const { stdout: logs } = await execAsync(
        `docker logs ${sidecarId} 2>&1 | tail -10`,
      );
      console.log(`\n📋 Sidecar Logs:\n${logs}`);
    }

    // Check orchestrator logs for token generation
    console.log("\n🔐 Token Generation:");
    const { stdout: tokenLogs } = await execAsync(
      `docker logs cronium-agent-dev 2>&1 | grep "${jobId}" | grep -E "(token|Token|JWT)" | tail -5`,
    );
    console.log(tokenLogs || "No token-related logs found");

    // Cleanup
    console.log("\n🧹 Cleaning up...");
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await caller.events.delete({ id: event!.id });
    await db.delete(users).where(eq(users.id, testUser!.id));
  } catch (error) {
    console.error("❌ Error:", error);
  }

  process.exit(0);
}

void testSidecarSimple();
