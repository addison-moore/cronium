import { db } from "@/server/db";
import { jobs, events } from "@/shared/schema";
import { desc, like, or } from "drizzle-orm";

async function checkTestJobs() {
  // Find recent test events
  const testEvents = await db.query.events.findMany({
    where: or(
      like(events.name, "%Runtime Helper%"),
      like(events.name, "%Echo Test%"),
    ),
    orderBy: desc(events.createdAt),
    limit: 10,
  });

  console.log(`Found ${testEvents.length} test events\n`);

  for (const event of testEvents) {
    console.log(`\n=== Event: ${event.name} (ID: ${event.id}) ===`);

    // Find jobs for this event
    const eventJobs = await db.query.jobs.findMany({
      where: (jobs, { eq }) => eq(jobs.eventId, event.id),
      orderBy: desc(jobs.createdAt),
    });

    for (const job of eventJobs) {
      console.log(`\nJob ${job.id} - Status: ${job.status}`);

      // Following TYPE_SAFETY.md - properly type the result
      const result = job.result as { logs?: string; output?: string } | null;
      if (result?.logs) {
        console.log("Logs:");
        const logLines = result.logs.split("\n").slice(0, 20);
        logLines.forEach((line) => console.log(`  ${line}`));
        if (result.logs.split("\n").length > 20) {
          console.log("  ... (truncated)");
        }
      } else {
        console.log("No logs captured");
      }
    }
  }

  process.exit(0);
}

void checkTestJobs();
