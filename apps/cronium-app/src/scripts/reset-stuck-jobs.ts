#!/usr/bin/env tsx

import { db } from "../server/db";
import { jobs, JobStatus } from "../shared/schema";
import { eq } from "drizzle-orm";

async function resetStuckJobs() {
  console.log("\n=== Resetting Stuck Jobs ===\n");

  // Reset stuck running jobs to failed
  const result = await db
    .update(jobs)
    .set({
      status: JobStatus.FAILED,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(jobs.status, JobStatus.RUNNING))
    .returning();

  console.log(`Reset ${result.length} stuck running jobs to failed`);
  result.forEach((j) => console.log(`  - ${j.id}`));

  // Check for any queued jobs
  const queuedJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, JobStatus.QUEUED));

  console.log(`\nFound ${queuedJobs.length} queued jobs`);
  queuedJobs.forEach((j) => console.log(`  - ${j.id}: type=${j.type}`));

  process.exit(0);
}

resetStuckJobs().catch(console.error);
