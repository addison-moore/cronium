#!/usr/bin/env tsx

import { db } from "@/server/db";
import { jobs, JobStatus, JobType } from "@/shared/schema";

async function testJobWithoutPayload() {
  // Create a test job without payloadPath
  const testJobId = `job_test_${Date.now()}`;
  const jobPayload = {
    environment: { TEST_VAR: "no_payload_path" },
    timeout: { value: 300 },
    target: { serverId: 4 },
    script: {
      type: "BASH",
      content: 'echo "Test without payload path: SUCCESS"',
      workingDirectory: "/tmp",
    },
  };

  const [newJob] = await db
    .insert(jobs)
    .values({
      id: testJobId,
      type: JobType.SCRIPT,
      status: JobStatus.QUEUED,
      priority: 10,
      eventId: 557,
      userId: "IvJTPTUE4yrKs_sNVZjWl",
      payload: jobPayload,
      createdAt: new Date(),
      updatedAt: new Date(),
      orchestratorId: null,
      attempts: 0,
    })
    .returning();

  console.log(`Created job: ${newJob.id}`);
  console.log(`Status: ${newJob.status}`);
  console.log(`No payloadPath in metadata - orchestrator will create payload`);
}

testJobWithoutPayload()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
