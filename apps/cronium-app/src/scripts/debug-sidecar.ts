import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function monitorSidecarContainers() {
  console.log("🔍 Monitoring for sidecar containers...\n");

  let lastContainerId: string | null = null;
  let attempts = 0;
  const maxAttempts = 60; // Monitor for 60 seconds

  const checkInterval = setInterval(() => {
    void (async () => {
      try {
        // Look for sidecar containers
        const { stdout } = await execAsync(
          'docker ps -a --filter "label=cronium.type=sidecar" --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.CreatedAt}}"',
        );

        if (stdout.trim()) {
          const lines = stdout.trim().split("\n");
          for (const line of lines) {
            const [id, name, status, created] = line.split("|") as [
              string,
              string,
              string,
              string,
            ];

            if (id !== lastContainerId) {
              console.log(`📦 New sidecar detected:`);
              console.log(`   ID: ${id}`);
              console.log(`   Name: ${name}`);
              console.log(`   Status: ${status}`);
              console.log(`   Created: ${created}`);

              // Get logs from the container
              try {
                const { stdout: logs } = await execAsync(
                  `docker logs ${id} 2>&1`,
                );
                console.log(
                  `   Logs:\n${logs
                    .split("\n")
                    .map((l) => "      " + l)
                    .join("\n")}`,
                );
              } catch {
                console.log(`   Logs: Unable to retrieve`);
              }

              // Inspect the container
              try {
                const { stdout: inspectRaw } = await execAsync(
                  `docker inspect ${id}`,
                );
                const inspectArray = JSON.parse(inspectRaw) as Array<{
                  State: { ExitCode: number };
                  Config: { Env?: string[] };
                }>;
                const inspect = inspectArray[0];
                if (!inspect) {
                  console.log("   No inspection data available");
                  continue;
                }
                console.log(`   Exit Code: ${inspect.State.ExitCode}`);
                console.log(`   Environment Variables:`);
                const envVars = inspect.Config.Env ?? [];
                for (const env of envVars) {
                  if (
                    env.includes("JWT") ||
                    env.includes("BACKEND") ||
                    env.includes("VALKEY")
                  ) {
                    const [key, ...valueParts] = env.split("=");
                    const value = valueParts.join("=");
                    console.log(
                      `      ${key ?? ""}=${key?.includes("SECRET") ? "[REDACTED]" : value}`,
                    );
                  }
                }
              } catch {
                console.log(`   Inspect: Unable to retrieve`);
              }

              console.log("");
              lastContainerId = id;
            }
          }
        }

        attempts++;
        if (attempts >= maxAttempts) {
          console.log("⏱️ Monitoring timeout reached");
          clearInterval(checkInterval);
          process.exit(0);
        }
      } catch (error) {
        console.error("Error checking containers:", error);
      }
    })();
  }, 1000);

  console.log(
    "ℹ️ Run the test-container-execution.ts script in another terminal\n",
  );
}

void monitorSidecarContainers();
