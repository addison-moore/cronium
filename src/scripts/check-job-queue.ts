#!/usr/bin/env tsx

import { db } from "@/server/db";
import { jobs, JobStatus } from "@/shared/schema";
import { sql, eq, inArray } from "drizzle-orm";

async function checkJobQueue() {
  console.log("🔍 Checking job queue status...\n");

  // Count jobs by status
  const counts = await db
    .select({
      status: jobs.status,
      count: sql<number>`count(*)`,
    })
    .from(jobs)
    .groupBy(jobs.status);

  console.log("📊 Job counts by status:");
  counts.forEach((c) => console.log(`  ${c.status}: ${c.count}`));

  // Check queued jobs
  const queuedJobs = await db
    .select({
      id: jobs.id,
      eventId: jobs.eventId,
      status: jobs.status,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(eq(jobs.status, JobStatus.QUEUED))
    .orderBy(jobs.createdAt)
    .limit(10);

  if (queuedJobs.length > 0) {
    console.log("\n⏳ Sample queued jobs:");
    queuedJobs.forEach((j) => {
      const age = Math.round(
        (Date.now() - new Date(j.createdAt).getTime()) / 1000 / 60,
      );
      console.log(`  ${j.id} - Event ${j.eventId} - ${age} minutes old`);
    });

    // Ask if we should clean up old queued jobs
    console.log("\n⚠️  Found old queued jobs that may be stuck.");
    console.log(
      "These are likely from test runs when the orchestrator wasn't running.",
    );

    // Clean up old queued jobs (older than 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const oldQueuedJobs = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        sql`${jobs.status} = 'queued' AND ${jobs.createdAt} < ${tenMinutesAgo}`,
      );

    if (oldQueuedJobs.length > 0) {
      console.log(
        `\n🧹 Cleaning up ${oldQueuedJobs.length} old queued jobs...`,
      );

      const jobIds = oldQueuedJobs.map((j) => j.id);
      await db
        .update(jobs)
        .set({
          status: JobStatus.FAILED,
          completedAt: new Date(),
          result: { error: "Job abandoned - orchestrator was not running" },
        })
        .where(inArray(jobs.id, jobIds));

      console.log("✅ Marked old jobs as failed");
    }
  } else {
    console.log("\n✅ No queued jobs found");
  }

  // Check running jobs
  const runningJobs = await db
    .select({
      id: jobs.id,
      eventId: jobs.eventId,
      status: jobs.status,
      startedAt: jobs.startedAt,
    })
    .from(jobs)
    .where(eq(jobs.status, JobStatus.RUNNING))
    .limit(10);

  if (runningJobs.length > 0) {
    console.log("\n🏃 Running jobs:");
    runningJobs.forEach((j) => {
      const runtime = j.startedAt
        ? Math.round((Date.now() - new Date(j.startedAt).getTime()) / 1000)
        : 0;
      console.log(`  ${j.id} - Event ${j.eventId} - ${runtime}s runtime`);
    });
  }

  process.exit(0);
}

void checkJobQueue();
