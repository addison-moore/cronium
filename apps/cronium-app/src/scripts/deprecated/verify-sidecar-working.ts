import { exec } from "child_process";
import { promisify } from "util";
import { db } from "@/server/db";
import { events, jobs, JobType, JobStatus } from "@/shared/schema";
import { randomUUID } from "crypto";
import { users } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";

const execAsync = promisify(exec);

async function verifySidecarWorking() {
  console.log("🧪 Verifying sidecar functionality...\n");

  try {
    // Ensure we have a test user
    const testEmail = "sidecar-test@example.com";
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

    // Create test event
    const [event] = await db
      .insert(events)
      .values({
        id: Math.floor(Math.random() * 1000000),
        userId: testUser.id,
        name: "Sidecar Verification Test",
        type: "BASH",
        content: 'echo "Sidecar test successful"',
        status: "ACTIVE",
        runLocation: "LOCAL",
      })
      .returning();

    console.log(`✅ Created event ${event.id}`);

    // Create job
    const jobId = `job_${randomUUID().substring(0, 12)}`;
    await db.insert(jobs).values({
      id: jobId,
      eventId: event.id,
      userId: testUser.id,
      type: JobType.SCRIPT,
      status: JobStatus.QUEUED,
      priority: 1,
      payload: {
        eventId: event.id,
        userId: testUser.id,
        eventName: event.name,
        scriptType: "bash",
        scriptContent: event.content,
      },
      attempts: 0,
    });

    console.log(`✅ Created job ${jobId}\n`);
    console.log("⏳ Monitoring execution...\n");

    // Monitor for 10 seconds
    let sidecarFound = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check for sidecar containers
      const { stdout } = await execAsync(
        `docker ps --filter "label=cronium.job.id=${jobId}" --format "{{.Names}}|{{.Status}}"`,
      );

      if (stdout.trim()) {
        console.log("📦 Containers for this job:");
        const lines = stdout.trim().split("\n");
        for (const line of lines) {
          const [name, status] = line.split("|");
          console.log(`   ${name}: ${status}`);
          if (name.includes("runtime")) {
            sidecarFound = true;
          }
        }
        console.log("");
      }

      // Check job status
      const job = await db.query.jobs.findFirst({
        where: eq(jobs.id, jobId),
      });

      if (job?.status === "completed" || job?.status === "failed") {
        console.log(`\n✅ Job completed with status: ${job.status}`);
        console.log(`   Sidecar detected: ${sidecarFound ? "Yes ✓" : "No ✗"}`);
        break;
      }
    }

    // Check orchestrator logs
    console.log("\n📋 Orchestrator logs for this job:");
    const { stdout: logs } = await execAsync(
      `docker logs cronium-orchestrator-dev 2>&1 | grep "${jobId}" | tail -10`,
    );
    console.log(logs);

    // Cleanup
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(events).where(eq(events.id, event.id));
    await db.delete(users).where(eq(users.id, testUser.id));
    console.log("\n🧹 Cleaned up test data");
  } catch (error) {
    console.error("❌ Error:", error);
  }

  process.exit(0);
}

verifySidecarWorking();
