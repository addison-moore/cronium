import { exec } from "child_process";
import { promisify } from "util";
import { db } from "@/server/db";
import { events, jobs } from "@/shared/schema";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);

async function captureFailedSidecar() {
  console.log("🔍 Setting up to capture failed sidecar...\n");

  // Monitor for sidecar containers
  let capturedLogs = false;
  const checkInterval = setInterval(async () => {
    try {
      const { stdout } = await execAsync(
        'docker ps -a --filter "label=cronium.type=sidecar" --format "{{.ID}}|{{.Names}}|{{.Status}}"',
      );

      if (stdout.trim() && !capturedLogs) {
        const lines = stdout.trim().split("\n");
        for (const line of lines) {
          const [id, name, status] = line.split("|");

          console.log(`\n📦 Sidecar found:`);
          console.log(`   ID: ${id}`);
          console.log(`   Name: ${name}`);
          console.log(`   Status: ${status}`);

          // Get detailed inspection
          try {
            const { stdout: inspectRaw } = await execAsync(
              `docker inspect ${id}`,
            );
            const inspect = JSON.parse(inspectRaw)[0];

            console.log(`\n🔧 Container Details:`);
            console.log(`   State: ${inspect.State.Status}`);
            console.log(`   Exit Code: ${inspect.State.ExitCode}`);
            console.log(`   Started At: ${inspect.State.StartedAt}`);
            console.log(`   Finished At: ${inspect.State.FinishedAt}`);

            console.log(`\n🌐 Network Configuration:`);
            const networks = Object.keys(
              inspect.NetworkSettings.Networks || {},
            );
            console.log(`   Networks: ${networks.join(", ")}`);

            if (networks.length > 0) {
              const netName = networks[0];
              const netConfig = inspect.NetworkSettings.Networks[netName];
              console.log(`   IP Address: ${netConfig.IPAddress}`);
              console.log(`   Gateway: ${netConfig.Gateway}`);
              console.log(`   Network ID: ${netConfig.NetworkID}`);
            }

            console.log(`\n🔑 Environment Variables:`);
            const envVars = inspect.Config.Env || [];
            for (const env of envVars) {
              const [key, ...valueParts] = env.split("=");
              const value = valueParts.join("=");
              if (
                key.includes("JWT") ||
                key.includes("BACKEND") ||
                key.includes("VALKEY") ||
                key.includes("EXECUTION")
              ) {
                console.log(
                  `   ${key}=${key.includes("SECRET") ? "[REDACTED]" : value}`,
                );
              }
            }

            console.log(`\n📋 Container Logs:`);
            const { stdout: logs, stderr: logsErr } = await execAsync(
              `docker logs ${id} 2>&1`,
            );
            console.log(logs || logsErr || "   [No logs available]");

            // Try to keep the container alive for further inspection
            if (status.includes("Exited")) {
              console.log(`\n⚠️ Container has already exited`);
            }

            capturedLogs = true;
            clearInterval(checkInterval);

            // Clean up after capturing
            setTimeout(async () => {
              try {
                await execAsync(`docker rm -f ${id}`);
                console.log(`\n🧹 Cleaned up sidecar container`);
              } catch (e) {
                // Ignore cleanup errors
              }
            }, 5000);
          } catch (e) {
            console.log(`   Error inspecting container: ${e}`);
          }
        }
      }
    } catch (error) {
      // Ignore errors
    }
  }, 500); // Check every 500ms

  // Create a test event and job
  console.log("📝 Creating test event...");

  const [event] = await db
    .insert(events)
    .values({
      id: Math.floor(Math.random() * 1000000),
      userId: "123e4567-e89b-12d3-a456-426614174000",
      name: "Debug Network Test",
      type: "BASH",
      content: 'echo "Testing network"',
      status: "ACTIVE",
      runLocation: "LOCAL",
    })
    .returning();

  const jobId = `job_${randomUUID().substring(0, 12)}`;
  await db.insert(jobs).values({
    id: jobId,
    eventId: event.id,
    status: "queued",
    priority: 1,
    retryCount: 0,
    maxRetries: 0,
  });

  console.log(`✅ Created job ${jobId}\n`);
  console.log("⏳ Waiting for orchestrator to process...");

  // Wait for capture
  setTimeout(async () => {
    if (!capturedLogs) {
      console.log("\n⚠️ No sidecar detected within timeout");
    }

    clearInterval(checkInterval);

    // Cleanup
    await db.delete(jobs).where({ id: jobId });
    await db.delete(events).where({ id: event.id });

    process.exit(0);
  }, 15000);
}

captureFailedSidecar().catch(console.error);
