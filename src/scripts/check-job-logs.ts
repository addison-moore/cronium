import { db } from "@/server/db";
import { jobs } from "@/shared/schema";
import { desc } from "drizzle-orm";

async function checkJobLogs() {
  const recentJobs = await db.query.jobs.findMany({
    orderBy: desc(jobs.createdAt),
    limit: 10,
  });

  for (const job of recentJobs) {
    console.log(`\n=== Job: ${job.id} ===`);
    console.log(`Status: ${job.status}`);
    console.log(`Type: ${job.type}`);
    console.log(`Event: ${job.eventId}`);
    console.log(`Created: ${job.createdAt}`);

    // Check for logs in result field
    const logs = (job.result as any)?.logs || (job.result as any)?.output;
    console.log(`Logs:\n${logs || "No logs"}`);

    // Also show the full result for debugging
    if (job.result) {
      console.log(`Result: ${JSON.stringify(job.result, null, 2)}`);
    }
    console.log("---");
  }

  process.exit(0);
}

checkJobLogs();
