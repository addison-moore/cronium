import { db } from "../server/db";
import { jobs } from "../shared/schema";
import { nanoid } from "nanoid";

(async () => {
  const jobId = "job_slack_singleton_" + nanoid(6);

  const newJob = {
    id: jobId,
    eventId: 575,
    userId: "IvJTPTUE4yrKs_sNVZjWl",
    status: "queued" as const,
    type: "SCRIPT" as const,
    priority: 1,
    attempts: 0,
    scheduledFor: new Date(),
    payload: {
      script: {
        type: "BASH",
        content:
          'echo "🎉 Testing Slack with singleton plugin registry!"; exit 0',
        workingDirectory: "/tmp",
      },
      timeout: { value: 30 },
      environment: {},
      executionLogId: null,
    },
    metadata: {
      eventName: "Slack Conditional Action - Singleton Test",
      triggeredBy: "manual",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(jobs).values(newJob);
  console.log("🚀 Created test job with singleton fix:", jobId);
  console.log("⏳ Waiting for execution...");
  console.log("📋 Check logs with: pnpm tsx src/scripts/check-tool-logs.ts");

  process.exit(0);
})();
