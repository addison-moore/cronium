import { transformJobForOrchestrator } from "@/lib/services/job-transformer";
import type { Job } from "@/shared/schema";

// Test job transformation
const testJob: Job = {
  id: "job_test123",
  eventId: 45,
  userId: 1,
  type: "SCRIPT",
  status: "queued",
  priority: "normal",
  payload: {
    executionLogId: 123,
    input: {},
    script: {
      type: "BASH",
      content: "echo 'Hello World'",
    },
    environment: {
      TEST_VAR: "test_value",
    },
    target: {
      containerImage: "cronium/bash:latest",
    },
    timeout: {
      value: 300,
      unit: "seconds",
    },
  },
  scheduledFor: new Date(),
  orchestratorId: null,
  startedAt: null,
  completedAt: null,
  result: null,
  attempts: 0,
  lastError: null,
  metadata: {
    eventName: "Test Event",
    triggeredBy: "manual",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

console.log("Original job:", JSON.stringify(testJob, null, 2));
console.log(
  "\n\nTransformed job:",
  JSON.stringify(transformJobForOrchestrator(testJob), null, 2),
);

// Test with SSH target
const sshJob = {
  ...testJob,
  payload: {
    ...testJob.payload,
    target: {
      serverId: 1,
    },
  },
} as Job;

console.log(
  "\n\nSSH job transformation:",
  JSON.stringify(transformJobForOrchestrator(sshJob), null, 2),
);
