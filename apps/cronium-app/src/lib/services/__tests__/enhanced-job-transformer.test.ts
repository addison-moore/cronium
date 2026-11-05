/**
 * @jest-environment node
 */
process.env.ENCRYPTION_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

jest.mock("@/server/db", () => ({ db: {} }));
jest.mock("@/server/storage", () => ({ storage: {} }));

import { prepareJobsForOrchestrator } from "../enhanced-job-transformer";
import { encryptEnvVarValue } from "@/lib/security/field-secret";
import { JobStatus, JobType, type Job } from "@/shared/schema";

function job(id: string, environment: Record<string, string>): Job {
  return {
    id,
    eventId: 42,
    userId: "user-1",
    type: JobType.SCRIPT,
    status: JobStatus.CLAIMED,
    priority: 1,
    attempts: 0,
    createdAt: new Date(),
    scheduledFor: new Date(),
    metadata: {},
    payload: {
      script: { type: "BASH", content: "echo hi" },
      environment,
    },
  } as unknown as Job;
}

describe("prepareJobsForOrchestrator", () => {
  it("delivers plaintext env for good jobs and sets aside the one that cannot decrypt", async () => {
    const good = job("job-good", {
      API_KEY: encryptEnvVarValue("s3cret", 42, "API_KEY"),
    });
    // Bound to another event, so it fails authenticated decryption here: stands
    // in for a row whose key was rotated away.
    const bad = job("job-bad", {
      API_KEY: encryptEnvVarValue("s3cret", 99, "API_KEY"),
    });

    const { ready, failed } = await prepareJobsForOrchestrator([good, bad]);

    expect(ready.map((r) => r.job.id)).toEqual(["job-good"]);
    expect(ready[0]!.transformed.execution.environment.API_KEY).toBe("s3cret");
    expect(failed.map((f) => f.job.id)).toEqual(["job-bad"]);
  });

  it("keeps each job paired with its own transform", async () => {
    const { ready } = await prepareJobsForOrchestrator([
      job("job-a", {}),
      job("job-b", {}),
    ]);
    expect(ready.map((r) => [r.job.id, r.transformed.id])).toEqual([
      ["job-a", "job-a"],
      ["job-b", "job-b"],
    ]);
  });
});
