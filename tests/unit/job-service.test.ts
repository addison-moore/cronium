/**
 * Unit tests for Job Service
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { JobService } from "@/lib/services/job-service";
import { db } from "@/server/db";
import { jobs, JobType, JobStatus, JobPriority } from "@/shared/schema";
import { eq, and, sql } from "drizzle-orm";

// Mock the database
jest.mock("@/server/db", () => ({
  db: {
    insert: jest.fn(),
    update: jest.fn(),
    select: jest.fn(),
    delete: jest.fn(),
    transaction: jest.fn(),
  },
}));

// Mock nanoid
jest.mock("nanoid", () => ({
  nanoid: jest.fn(() => "test_job_id_123"),
}));

describe("JobService", () => {
  let jobService: JobService;
  let mockDb: any;

  beforeEach(() => {
    jobService = new JobService(db as any);
    mockDb = db as any;
    jest.clearAllMocks();
  });

  describe("createJob", () => {
    it("should create a new job with correct data", async () => {
      const mockJob = {
        id: "job_test_job_id_123",
        eventId: 1,
        userId: "user123",
        type: JobType.SCRIPT,
        status: JobStatus.QUEUED,
        priority: JobPriority.NORMAL,
        payload: { test: "data" },
        scheduledFor: new Date(),
        metadata: {},
        attempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockJob]),
        }),
      });

      const input = {
        eventId: 1,
        userId: "user123",
        type: JobType.SCRIPT,
        payload: { test: "data" },
      };

      const result = await jobService.createJob(input);

      expect(mockDb.insert).toHaveBeenCalledWith(jobs);
      expect(result).toEqual(mockJob);
      expect(result.id).toBe("job_test_job_id_123");
    });

    it("should use provided priority and scheduledFor", async () => {
      const scheduledFor = new Date("2025-01-01T12:00:00Z");
      const mockJob = {
        id: "job_test_job_id_123",
        eventId: 1,
        userId: "user123",
        type: JobType.HTTP_REQUEST,
        status: JobStatus.QUEUED,
        priority: JobPriority.HIGH,
        payload: {},
        scheduledFor,
        metadata: { source: "test" },
        attempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockJob]),
        }),
      });

      const result = await jobService.createJob({
        eventId: 1,
        userId: "user123",
        type: JobType.HTTP_REQUEST,
        payload: {},
        priority: JobPriority.HIGH,
        scheduledFor,
        metadata: { source: "test" },
      });

      expect(result.priority).toBe(JobPriority.HIGH);
      expect(result.scheduledFor).toEqual(scheduledFor);
      expect(result.metadata).toEqual({ source: "test" });
    });
  });

  describe("getJob", () => {
    it("should retrieve a job by ID", async () => {
      const mockJob = {
        id: "job_123",
        eventId: 1,
        status: JobStatus.RUNNING,
      };

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([mockJob]),
          }),
        }),
      });

      const result = await jobService.getJob("job_123");

      expect(result).toEqual(mockJob);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it("should return null if job not found", async () => {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await jobService.getJob("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("listJobs", () => {
    it("should list jobs with filters", async () => {
      const mockJobs = [
        { id: "job_1", status: JobStatus.QUEUED },
        { id: "job_2", status: JobStatus.RUNNING },
      ];

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue(mockJobs),
              }),
            }),
          }),
        }),
      });

      const result = await jobService.listJobs({
        status: JobStatus.QUEUED,
        userId: "user123",
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual(mockJobs);
    });

    it("should apply default limit and offset", async () => {
      const mockJobs = [{ id: "job_1" }];

      let limitValue: number | undefined;
      let offsetValue: number | undefined;

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn((val: number) => {
                limitValue = val;
                return {
                  offset: jest.fn((val: number) => {
                    offsetValue = val;
                    return Promise.resolve(mockJobs);
                  }),
                };
              }),
            }),
          }),
        }),
      });

      await jobService.listJobs({});

      expect(limitValue).toBe(100);
      expect(offsetValue).toBe(0);
    });
  });

  describe("claimJobs", () => {
    it("should claim available jobs atomically", async () => {
      const mockAvailableJobs = [
        { id: "job_1", type: JobType.SCRIPT, priority: JobPriority.HIGH },
        { id: "job_2", type: JobType.SCRIPT, priority: JobPriority.NORMAL },
      ];

      const mockClaimedJobs = mockAvailableJobs.map((job) => ({
        ...job,
        status: JobStatus.CLAIMED,
        orchestratorId: "orchestrator_1",
        claimedAt: new Date(),
      }));

      // Mock transaction
      mockDb.transaction.mockImplementation(async (callback: any) => {
        const txMock = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    for: jest.fn().mockResolvedValue(mockAvailableJobs),
                  }),
                }),
              }),
            }),
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue(mockClaimedJobs),
              }),
            }),
          }),
        };
        return callback(txMock);
      });

      const result = await jobService.claimJobs("orchestrator_1", 5);

      expect(result).toEqual(mockClaimedJobs);
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it("should respect job type filters", async () => {
      const mockJobs = [{ id: "job_1", type: JobType.HTTP_REQUEST }];

      mockDb.transaction.mockImplementation(async (callback: any) => {
        const txMock = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    for: jest.fn().mockResolvedValue(mockJobs),
                  }),
                }),
              }),
            }),
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue(mockJobs),
              }),
            }),
          }),
        };
        return callback(txMock);
      });

      const result = await jobService.claimJobs("orchestrator_1", 5, [
        JobType.HTTP_REQUEST,
      ]);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe(JobType.HTTP_REQUEST);
    });
  });

  describe("updateJobStatus", () => {
    it("should update job status with result", async () => {
      const mockUpdatedJob = {
        id: "job_123",
        status: JobStatus.COMPLETED,
        result: { success: true },
        completedAt: new Date(),
      };

      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([mockUpdatedJob]),
          }),
        }),
      });

      const result = await jobService.updateJobStatus(
        "job_123",
        JobStatus.COMPLETED,
        {
          result: { success: true },
        },
      );

      expect(result).toEqual(mockUpdatedJob);
      expect(mockDb.update).toHaveBeenCalledWith(jobs);
    });

    it("should set error message for failed jobs", async () => {
      const mockFailedJob = {
        id: "job_123",
        status: JobStatus.FAILED,
        error: "Test error",
        completedAt: new Date(),
      };

      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([mockFailedJob]),
          }),
        }),
      });

      const result = await jobService.updateJobStatus(
        "job_123",
        JobStatus.FAILED,
        {
          error: "Test error",
        },
      );

      expect(result?.error).toBe("Test error");
      expect(result?.status).toBe(JobStatus.FAILED);
    });

    it("should set startedAt for running status", async () => {
      const now = new Date();
      const mockRunningJob = {
        id: "job_123",
        status: JobStatus.RUNNING,
        startedAt: now,
      };

      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([mockRunningJob]),
          }),
        }),
      });

      const result = await jobService.updateJobStatus(
        "job_123",
        JobStatus.RUNNING,
      );

      expect(result?.status).toBe(JobStatus.RUNNING);
      expect(result?.startedAt).toBeDefined();
    });
  });

  describe("completeJob", () => {
    it("should mark job as completed with result", async () => {
      const result = { output: "test" };
      const mockCompletedJob = {
        id: "job_123",
        status: JobStatus.COMPLETED,
        result,
        completedAt: new Date(),
      };

      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([mockCompletedJob]),
          }),
        }),
      });

      const job = await jobService.completeJob("job_123", result);

      expect(job?.status).toBe(JobStatus.COMPLETED);
      expect(job?.result).toEqual(result);
    });
  });

  describe("failJob", () => {
    it("should mark job as failed with error", async () => {
      const mockFailedJob = {
        id: "job_123",
        status: JobStatus.FAILED,
        error: "Test failure",
        completedAt: new Date(),
      };

      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([mockFailedJob]),
          }),
        }),
      });

      const job = await jobService.failJob("job_123", "Test failure");

      expect(job?.status).toBe(JobStatus.FAILED);
      expect(job?.error).toBe("Test failure");
    });
  });

  describe("cancelJob", () => {
    it("should cancel a queued job", async () => {
      const mockCancelledJob = {
        id: "job_123",
        status: JobStatus.CANCELLED,
        completedAt: new Date(),
      };

      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([mockCancelledJob]),
          }),
        }),
      });

      const job = await jobService.cancelJob("job_123");

      expect(job?.status).toBe(JobStatus.CANCELLED);
    });
  });

  describe("getJobStats", () => {
    it("should return job statistics", async () => {
      const mockStats = [
        { status: JobStatus.QUEUED, count: "5" },
        { status: JobStatus.RUNNING, count: "3" },
        { status: JobStatus.COMPLETED, count: "10" },
        { status: JobStatus.FAILED, count: "2" },
      ];

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            groupBy: jest.fn().mockResolvedValue(mockStats),
          }),
        }),
      });

      const stats = await jobService.getJobStats({ userId: "user123" });

      expect(stats).toEqual({
        queued: 5,
        running: 3,
        completed: 10,
        failed: 2,
        cancelled: 0,
        total: 20,
      });
    });
  });

  describe("cleanupOldJobs", () => {
    it("should delete old completed jobs", async () => {
      mockDb.delete.mockReturnValue({
        where: jest.fn().mockResolvedValue({ rowCount: 50 }),
      });

      const result = await jobService.cleanupOldJobs(30);

      expect(result).toBe(50);
      expect(mockDb.delete).toHaveBeenCalledWith(jobs);
    });
  });
});
