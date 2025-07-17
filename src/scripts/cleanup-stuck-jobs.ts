#!/usr/bin/env tsx

import { db } from "@/server/db";
import { jobs, JobStatus } from "@/shared/schema";
import { sql, or, eq, and, lt } from "drizzle-orm";

async function cleanupStuckJobs() {
  console.log("🧹 Cleaning up stuck jobs...\n");

  // Mark old queued jobs as failed
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const queuedResult = await db
    .update(jobs)
    .set({
      status: JobStatus.FAILED,
      completedAt: new Date(),
      result: { error: "Job abandoned - orchestrator was not running" },
    })
    .where(
      and(eq(jobs.status, JobStatus.QUEUED), lt(jobs.createdAt, tenMinutesAgo)),
    );

  console.log(`✅ Marked old queued jobs as failed`);

  // Mark old "running" jobs as failed (anything running for more than 1 hour is definitely stuck)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const runningResult = await db
    .update(jobs)
    .set({
      status: JobStatus.FAILED,
      completedAt: new Date(),
      result: { error: "Job timeout - stuck in running state" },
    })
    .where(
      and(
        eq(jobs.status, JobStatus.RUNNING),
        sql`${jobs.startedAt} < ${oneHourAgo}`,
      ),
    );

  console.log(`✅ Marked stuck running jobs as failed`);

  // Mark claimed jobs older than 10 minutes as failed
  const claimedResult = await db
    .update(jobs)
    .set({
      status: JobStatus.FAILED,
      completedAt: new Date(),
      result: { error: "Job abandoned - never started after claim" },
    })
    .where(
      and(
        eq(jobs.status, JobStatus.CLAIMED),
        lt(jobs.createdAt, tenMinutesAgo),
      ),
    );

  console.log(`✅ Marked old claimed jobs as failed`);

  // Show final counts
  const counts = await db
    .select({
      status: jobs.status,
      count: sql<number>`count(*)`,
    })
    .from(jobs)
    .groupBy(jobs.status);

  console.log("\n📊 Final job counts:");
  counts.forEach((c) => console.log(`  ${c.status}: ${c.count}`));

  process.exit(0);
}

void cleanupStuckJobs();
