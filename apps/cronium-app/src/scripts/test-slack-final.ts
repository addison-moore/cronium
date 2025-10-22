import { db } from "../server/db";
import { jobs, toolActionLogs, JobType, JobStatus } from "../shared/schema";
import { nanoid } from "nanoid";
import { eq, desc } from "drizzle-orm";

console.log("🚀 Creating FINAL test job with all fixes...");
console.log("✅ Plugin initialization added to API route");
console.log("✅ Instrumentation.ts created for server-wide init");
console.log("✅ Global singleton pattern implemented");
console.log("");

(async () => {
  const jobId = "job_slack_FINAL_" + nanoid(6);

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
        content: 'echo "🎉 FINAL TEST - All fixes applied!"; exit 0',
        workingDirectory: "/tmp",
      },
      timeout: { value: 30 },
      environment: {},
      executionLogId: null,
    },
    metadata: {
      eventName: "FINAL Slack Test - All Fixes",
      triggeredBy: "manual",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(jobs).values(newJob);
  console.log("✅ Created FINAL test job:", jobId);
  console.log("⏳ Waiting 30 seconds for execution...");

  // Wait and check
  setTimeout(async () => {
    // Check job status
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    console.log("\n📊 Job Status:", job?.status);

    // Check for new tool action logs
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const logs = await db
      .select()
      .from(toolActionLogs)
      .where(eq(toolActionLogs.eventId, 575))
      .orderBy(desc(toolActionLogs.createdAt))
      .limit(5);

    const newLogs = logs.filter(
      (log) => new Date(log.createdAt) > oneMinuteAgo,
    );

    if (newLogs.length > 0) {
      console.log("\n✅ NEW Tool Action Logs Found:");
      newLogs.forEach((log, i) => {
        console.log(`  Log #${i + 1}:`);
        console.log("    Status:", log.status);
        console.log("    Action ID:", log.actionId);
        console.log("    Created:", new Date(log.createdAt).toISOString());

        if (log.status === "SUCCESS") {
          console.log("\n🎉🎉🎉 SUCCESS! SLACK MESSAGE SENT! 🎉🎉🎉");
          console.log("✅ All fixes working correctly!");
        } else if (log.errorMessage) {
          console.log("    Error:", log.errorMessage);
        }
      });
    } else {
      console.log("\n⚠️ No new tool action logs found");
      console.log("📋 Most recent log was:", logs[0]?.createdAt);
    }

    process.exit(0);
  }, 30000);
})().catch(console.error);
