import { db } from "../server/db";
import { jobs, JobType, JobStatus } from "../shared/schema";
import { nanoid } from "nanoid";

console.log("🔍 Creating test job to trigger plugin debugging...");

(async () => {
  const jobId = "job_plugin_debug_" + nanoid(6);

  const newJob = {
    id: jobId,
    eventId: 575,
    userId: "IvJTPTUE4yrKs_sNVZjWl",
    status: JobStatus.QUEUED,
    type: JobType.SCRIPT,
    priority: 1,
    attempts: 0,
    scheduledFor: new Date(),
    payload: {
      script: {
        type: "BASH",
        content: 'echo "Plugin debug test"; exit 0',
        workingDirectory: "/tmp",
      },
      timeout: { value: 30 },
      environment: {},
      executionLogId: null,
    },
    metadata: {
      eventName: "Plugin Debug Test",
      triggeredBy: "manual",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(jobs).values(newJob);
  console.log("✅ Created debug job:", jobId);
  console.log("");
  console.log("📋 NOW CHECK THE NEXT.JS DEV SERVER TERMINAL FOR:");
  console.log("  1. [ToolPluginRegistry] Creating new global plugin registry");
  console.log("  2. [initializePlugins] Initializing plugins...");
  console.log("  3. [ToolAction] Available actions before lookup:");
  console.log("  4. [ServerActionExecutor] messages");
  console.log("");
  console.log('👀 The terminal running "pnpm dev" should show these logs');

  process.exit(0);
})();
