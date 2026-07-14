/**
 * @jest-environment node
 */
jest.mock("@/lib/services/job-service", () => ({
  jobService: { updateJobStatus: jest.fn() },
}));
jest.mock("@/lib/scheduler/tool-action-executor", () => ({
  executeToolAction: jest.fn(),
}));
jest.mock("@/lib/scheduler/http-event-executor", () => ({
  executeHttpEvent: jest.fn(),
}));

import { runInProcessJob, isInProcessJobType } from "../in-process-executor";
import { jobService } from "@/lib/services/job-service";
import { executeToolAction } from "@/lib/scheduler/tool-action-executor";
import { executeHttpEvent } from "@/lib/scheduler/http-event-executor";
import { JobStatus, JobType } from "@/shared/schema";
import type { Event, Job } from "@/shared/schema";

const mockUpdate = jobService.updateJobStatus as jest.Mock;
const mockExec = executeToolAction as jest.Mock;
const mockHttp = executeHttpEvent as jest.Mock;

const job = { id: "job_1", type: JobType.TOOL_ACTION } as Job;
const httpJob = { id: "job_2", type: JobType.HTTP_REQUEST } as Job;
const event = {
  id: 1,
  userId: "u1",
  toolActionConfig: "{}",
} as unknown as Event;

// updateJobStatus(jobId, status, data): collect the status arg of each call.
const statuses = () => mockUpdate.mock.calls.map((c) => c[1] as JobStatus);
// The data arg of the last updateJobStatus call.
const lastData = () =>
  mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1]?.[2] as Record<
    string,
    unknown
  >;

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue(null);
  mockExec.mockReset();
  mockHttp.mockReset();
});

describe("isInProcessJobType", () => {
  it("is true for the scriptless in-process types, false for scripts", () => {
    expect(isInProcessJobType(JobType.TOOL_ACTION)).toBe(true);
    expect(isInProcessJobType(JobType.HTTP_REQUEST)).toBe(true);
    expect(isInProcessJobType(JobType.SCRIPT)).toBe(false);
  });
});

describe("runInProcessJob — dispatch by job type", () => {
  it("routes HTTP_REQUEST jobs to executeHttpEvent, not executeToolAction", async () => {
    mockHttp.mockResolvedValue({ stdout: "{}", stderr: "", exitCode: 0 });

    await runInProcessJob(httpJob, event, { a: 1 });

    expect(mockHttp).toHaveBeenCalledWith(event, { a: 1 });
    expect(mockExec).not.toHaveBeenCalled();
    expect(statuses()).toEqual([JobStatus.RUNNING, JobStatus.COMPLETED]);
  });
});

describe("runInProcessJob", () => {
  it("drives the job RUNNING then COMPLETED when the action succeeds", async () => {
    mockExec.mockResolvedValue({ stdout: "sent", stderr: "", exitCode: 0 });

    await runInProcessJob(job, event, { a: 1 });

    expect(mockExec).toHaveBeenCalledWith(event, { a: 1 });
    expect(statuses()).toEqual([JobStatus.RUNNING, JobStatus.COMPLETED]);
    expect(lastData().exitCode).toBe(0);
    expect(lastData().output).toBe("sent");
  });

  it("marks the job FAILED with the stderr when the action reports failure", async () => {
    mockExec.mockResolvedValue({
      stdout: "",
      stderr: "invalid_token",
      exitCode: 1,
    });

    await runInProcessJob(job, event);

    expect(statuses()).toEqual([JobStatus.RUNNING, JobStatus.FAILED]);
    expect(lastData().exitCode).toBe(1);
    expect(lastData().error).toBe("invalid_token");
  });

  it("emits result.data as scriptOutput when the action produces output (Unified I/O)", async () => {
    mockExec.mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      data: { rows: [{ id: 1 }] },
      producesOutput: true,
    });

    await runInProcessJob(job, event);

    const result = lastData().result as Record<string, unknown>;
    expect(result.scriptOutput).toEqual({ rows: [{ id: 1 }] });
  });

  it("does not emit scriptOutput for a send/write action (producesOutput false)", async () => {
    mockExec.mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      data: { ok: true },
      producesOutput: false,
    });

    await runInProcessJob(job, event);

    const result = lastData().result as Record<string, unknown>;
    expect(result.scriptOutput).toBeUndefined();
  });

  it("does not emit scriptOutput when the action fails, even if producesOutput", async () => {
    mockExec.mockResolvedValue({
      stdout: "",
      stderr: "boom",
      exitCode: 1,
      data: { partial: true },
      producesOutput: true,
    });

    await runInProcessJob(job, event);

    const result = lastData().result as Record<string, unknown>;
    expect(result.scriptOutput).toBeUndefined();
  });

  it("finalizes the job FAILED (never throws) if the engine itself throws", async () => {
    mockExec.mockRejectedValue(new Error("kaboom"));

    await expect(runInProcessJob(job, event)).resolves.toBeUndefined();

    expect(statuses()).toContain(JobStatus.FAILED);
    expect(String(lastData().error)).toContain("kaboom");
  });
});
