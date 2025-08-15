#!/usr/bin/env tsx

import { db } from "@/server/db";
import { jobs } from "@/shared/schema";
import { eq } from "drizzle-orm";

async function checkJobStatus() {
  const jobId = process.argv[2] ?? "job_test_1755113330323";
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));

  if (job) {
    console.log(`Job ID: ${job.id}`);
    console.log(`Status: ${job.status}`);
    console.log(`Attempts: ${job.attempts}`);
    console.log(`Created: ${job.createdAt.toISOString()}`);
    console.log(`Updated: ${job.updatedAt.toISOString()}`);
    if (job.orchestratorId) {
      console.log(`Orchestrator: ${job.orchestratorId}`);
    }
  } else {
    console.log(`Job ${jobId} not found`);
  }
}

checkJobStatus()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
