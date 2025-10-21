import { db } from "../server/db";
import { toolActionLogs } from "../shared/schema";
import { desc } from "drizzle-orm";

(async () => {
  const logs = await db
    .select()
    .from(toolActionLogs)
    .orderBy(desc(toolActionLogs.createdAt))
    .limit(5);

  console.log("📋 Most Recent Tool Action Logs:");
  logs.forEach((log, i) => {
    const now = new Date();
    const logDate = new Date(log.createdAt);
    const secondsAgo = Math.floor((now.getTime() - logDate.getTime()) / 1000);

    console.log(`\n  Log #${i + 1}:`);
    console.log("    Event ID:", log.eventId);
    console.log("    Action ID:", log.actionId);
    console.log("    Status:", log.status);
    console.log("    Created:", log.createdAt);
    console.log("    Seconds ago:", secondsAgo);
    if (log.errorMessage) {
      console.log("    Error:", log.errorMessage);
    }
    if (log.result) {
      console.log("    Result:", JSON.stringify(log.result).substring(0, 100));
    }
  });

  process.exit(0);
})();
