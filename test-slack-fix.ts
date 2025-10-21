import { db } from "./apps/cronium-app/src/server/db";
import { jobs } from "./apps/cronium-app/src/shared/schema";
import { nanoid } from "nanoid";

(async () => {
  const jobId = "job_slack_fix_" + nanoid(6);

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
        content: 'echo "Testing with conditional action fix!"; exit 0',
        workingDirectory: "/tmp",
      },
      timeout: { value: 30 },
      environment: {},
      executionLogId: null,
    },
    metadata: {
      eventName: "Slack Conditional Action Fixed Test",
      triggeredBy: "manual",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(jobs).values(newJob);
  console.log("🚀 Created test job with fix:", jobId);
  console.log("⏳ Waiting for execution and conditional actions...");

  // Wait and check status
  setTimeout(async () => {
    const [updatedJob] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    console.log("\n📊 Job Status after 30 seconds:", updatedJob?.status);

    // Check for tool action logs
    const { toolActionLogs } = await import(
      "./apps/cronium-app/src/shared/schema"
    );
    const { desc, eq } = await import("drizzle-orm");

    const logs = await db
      .select()
      .from(toolActionLogs)
      .where(eq(toolActionLogs.eventId, 575))
      .orderBy(desc(toolActionLogs.createdAt))
      .limit(1);

    if (logs.length > 0 && logs[0].createdAt > new Date(Date.now() - 60000)) {
      console.log("\n✅ NEW Tool Action Log Found!");
      console.log("   Status:", logs[0].status);
      console.log("   Action ID:", logs[0].actionId);
      console.log("   Error:", logs[0].errorMessage ?? "None");

      if (logs[0].status === "SUCCESS") {
        console.log("\n🎉 SUCCESS! Slack message was sent!");
      }
    } else {
      console.log("\n⚠️  No new tool action logs found");
    }

    process.exit(0);
  }, 30000);
})().catch(console.error);

// Import eq for the query
import { eq } from "drizzle-orm";
