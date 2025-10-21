import { exec } from "child_process";
import { promisify } from "util";
import { appRouter } from "@/server/api/root";
import { createCallerFactory } from "@/server/api/trpc";
import { db } from "@/server/db";
import { auth } from "@/lib/auth";
import { users } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);
const createCaller = createCallerFactory(appRouter);

async function verifySidecarLifecycle() {
  console.log("🔍 Verifying Runtime API Sidecar Lifecycle...\n");

  try {
    // Ensure test user exists
    const testEmail = "sidecar-lifecycle@example.com";
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

    // Create test event
    console.log("📝 Creating test event...");
    const event = await caller.events.create({
      name: "Sidecar Lifecycle Test",
      description: "Test to verify sidecar container lifecycle",
      type: "BASH",
      content: 'echo "Testing sidecar lifecycle" && sleep 5',
      status: "ACTIVE",
      runLocation: "LOCAL",
    });
    console.log(`✅ Created event: ${event.name} (ID: ${event.id})\n`);

    // Execute the event
    console.log("🚀 Executing event...");
    const execution = await caller.events.execute({ id: event.id });
    console.log(`✅ Event execution triggered (Job ID: ${execution.jobId})\n`);

    // Monitor containers
    console.log("📊 Monitoring containers...\n");
    let sidecarId: string | null = null;
    let mainContainerId: string | null = null;
    let networkId: string | null = null;

    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check for containers with this job ID
      const { stdout } = await execAsync(
        `docker ps -a --filter "label=cronium.job.id=${execution.jobId}" --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Labels}}"`,
      );

      if (stdout.trim()) {
        const containers = stdout.trim().split("\n");
        console.log(`⏱️ Time: ${i}s`);

        for (const container of containers) {
          const [id, name, status, labels] = container.split("|");
          const isSidecar = labels.includes("cronium.type=sidecar");

          if (isSidecar && !sidecarId) {
            sidecarId = id;
            console.log(`   🔵 Sidecar: ${name} (${status})`);

            // Get sidecar details
            const { stdout: inspectRaw } = await execAsync(
              `docker inspect ${id}`,
            );
            const inspect = JSON.parse(inspectRaw)[0];

            // Check network
            const networks = Object.keys(
              inspect.NetworkSettings.Networks || {},
            );
            networkId =
              networks.find((n) => n.includes("cronium-job-")) || null;
            console.log(`      Networks: ${networks.join(", ")}`);

            // Check if sidecar is accessible
            if (inspect.State.Running) {
              console.log(`      Running: ✅`);
              console.log(
                `      IP in job network: ${inspect.NetworkSettings.Networks[networkId!]?.IPAddress || "N/A"}`,
              );
            }
          } else if (!isSidecar && !mainContainerId) {
            mainContainerId = id;
            console.log(`   🟢 Main: ${name} (${status})`);
          }
        }
        console.log("");
      }

      // Check job status
      const job = await caller.jobs.get({ jobId: execution.jobId });
      if (job.status === "completed" || job.status === "failed") {
        console.log(`\n✅ Job finished with status: ${job.status}`);
        break;
      }
    }

    // Verify sidecar was created and accessible
    console.log("\n📋 Sidecar Verification Results:");
    console.log(`   Sidecar created: ${sidecarId ? "✅ Yes" : "❌ No"}`);
    console.log(
      `   Main container created: ${mainContainerId ? "✅ Yes" : "❌ No"}`,
    );
    console.log(`   Job network created: ${networkId ? "✅ Yes" : "❌ No"}`);

    if (sidecarId) {
      // Test sidecar API endpoints
      console.log("\n🧪 Testing sidecar API accessibility...");

      // Try to access health endpoint from orchestrator container
      try {
        const { stdout: healthCheck } = await execAsync(
          `docker exec cronium-orchestrator-dev wget -q -O- http://runtime-api:8081/health 2>&1 || echo "Failed"`,
        );
        console.log(
          `   Health check from orchestrator: ${healthCheck.includes("healthy") ? "✅ Accessible" : "❌ Not accessible"}`,
        );
      } catch (e) {
        console.log(`   Health check from orchestrator: ❌ Error`);
      }
    }

    // Check JWT token generation and injection
    console.log("\n🔐 Checking JWT token generation...");
    const { stdout: agentLogs } = await execAsync(
      `docker logs cronium-orchestrator-dev 2>&1 | grep "${execution.jobId}" | grep -E "(token|JWT)" | head -5`,
    );
    console.log(
      `   Token generation logs: ${agentLogs ? "✅ Found" : "❌ Not found"}`,
    );

    // Cleanup
    console.log("\n🧹 Cleaning up...");
    await caller.events.delete({ id: event.id });
    await db.delete(users).where(eq(users.id, testUser!.id));
    console.log("✅ Cleanup complete");
  } catch (error) {
    console.error("❌ Test failed:", error);
  }

  process.exit(0);
}

verifySidecarLifecycle();
