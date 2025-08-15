#!/usr/bin/env tsx

import { db } from "@/server/db";
import { jobs, JobStatus, JobType } from "@/shared/schema";
import { eq } from "drizzle-orm";

async function testInterpreterFix() {
  const testJobId = `job_interpreter_${Date.now()}`;

  console.log("Testing interpreter fix...");

  const [newJob] = await db
    .insert(jobs)
    .values({
      id: testJobId,
      type: JobType.SCRIPT,
      status: JobStatus.QUEUED,
      priority: 10,
      eventId: 557,
      userId: "IvJTPTUE4yrKs_sNVZjWl",
      payload: {
        environment: { TEST: "interpreter_fix" },
        timeout: { value: 300 },
        target: { serverId: 4 },
        script: {
          type: "BASH",
          content: 'echo "Interpreter fix test: SUCCESS"',
          workingDirectory: "/tmp",
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      orchestratorId: null,
      attempts: 0,
    })
    .returning();

  console.log(`Created test job: ${newJob.id}`);

  // Wait for execution
  console.log("Waiting 10 seconds for execution...");
  await new Promise((resolve) => setTimeout(resolve, 10000));

  const [job] = await db.select().from(jobs).where(eq(jobs.id, testJobId));
  console.log(`Job status: ${String(job?.status)}`);

  if (job?.status === JobStatus.COMPLETED) {
    console.log("✅ Interpreter fix successful!");
  } else if (job?.status === JobStatus.FAILED) {
    console.log("❌ Job failed - check orchestrator logs");
  } else {
    console.log(`Job still ${String(job?.status)}`);
  }
}

testInterpreterFix()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
