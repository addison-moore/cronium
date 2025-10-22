import { db } from "../server/db";
import { jobs, JobType, JobStatus } from "../shared/schema";
import { nanoid } from "nanoid";

(async () => {
  const jobId = "job_slack_final2_" + nanoid(6);

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
        content:
          'echo "Testing Slack conditional action with all fixes!"; exit 0',
        workingDirectory: "/tmp",
      },
      timeout: { value: 30 },
      environment: {},
      executionLogId: null,
    },
    metadata: {
      eventName: "Slack Conditional Action - Final Test",
      triggeredBy: "manual",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(jobs).values(newJob);
  console.log("🚀 Created test job with all fixes:", jobId);
  console.log(
    "⏳ Wait 30 seconds then run: pnpm tsx src/scripts/check-tool-logs.ts",
  );

  process.exit(0);
})().catch((error) => {
  console.error("❌ Failed to create test job:", error);
  process.exit(1);
});
