/**
 * Performance benchmark tests for containerized execution system
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { performance } from "perf_hooks";
import { jobService } from "@/lib/services/job-service";
import { db } from "@/server/db";
import {
  events,
  jobs,
  logs,
  JobType,
  JobStatus,
  EventType,
  EventStatus,
} from "@/shared/schema";
import { eq, inArray } from "drizzle-orm";
import supertest from "supertest";

const API_BASE_URL = process.env.API_URL || "http://localhost:5001";
const TEST_USER_ID = "perf_test_user";

interface BenchmarkResult {
  operation: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  opsPerSecond: number;
}

class BenchmarkRunner {
  private results: BenchmarkResult[] = [];

  async run(
    name: string,
    iterations: number,
    fn: () => Promise<void>,
  ): Promise<BenchmarkResult> {
    const times: number[] = [];

    console.log(`Running benchmark: ${name} (${iterations} iterations)`);

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);

      // Show progress every 10%
      if ((i + 1) % Math.ceil(iterations / 10) === 0) {
        console.log(`  Progress: ${Math.round(((i + 1) / iterations) * 100)}%`);
      }
    }

    const totalTime = times.reduce((a, b) => a + b, 0);
    const avgTime = totalTime / iterations;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const opsPerSecond = 1000 / avgTime;

    const result: BenchmarkResult = {
      operation: name,
      iterations,
      totalTime,
      avgTime,
      minTime,
      maxTime,
      opsPerSecond,
    };

    this.results.push(result);
    return result;
  }

  printSummary() {
    console.log("\n=== Performance Benchmark Summary ===\n");
    console.table(
      this.results.map((r) => ({
        Operation: r.operation,
        "Avg Time (ms)": r.avgTime.toFixed(2),
        "Min Time (ms)": r.minTime.toFixed(2),
        "Max Time (ms)": r.maxTime.toFixed(2),
        "Ops/Second": r.opsPerSecond.toFixed(0),
      })),
    );
  }
}

describe("Performance Benchmarks", () => {
  const benchmark = new BenchmarkRunner();
  const testEventIds: number[] = [];
  const testJobIds: string[] = [];

  beforeAll(async () => {
    // Create test events for benchmarking
    console.log("Setting up test data...");

    for (let i = 0; i < 10; i++) {
      const [event] = await db
        .insert(events)
        .values({
          userId: TEST_USER_ID,
          name: `Perf Test Event ${i}`,
          type: EventType.NODEJS,
          content: 'console.log("test");',
          status: EventStatus.ACTIVE,
          runLocation: "LOCAL",
          scheduleNumber: 1,
          scheduleUnit: "MINUTES",
          timeoutValue: 30,
          timeoutUnit: "SECONDS",
          retries: 0,
          shared: false,
          tags: ["performance-test"],
        })
        .returning();

      testEventIds.push(event.id);
    }
  });

  afterAll(async () => {
    // Clean up test data
    console.log("Cleaning up test data...");

    if (testJobIds.length > 0) {
      await db.delete(logs).where(inArray(logs.jobId, testJobIds));
      await db.delete(jobs).where(inArray(jobs.id, testJobIds));
    }

    if (testEventIds.length > 0) {
      await db.delete(events).where(inArray(events.id, testEventIds));
    }

    // Print benchmark summary
    benchmark.printSummary();
  });

  describe("Job Creation Performance", () => {
    it("should create jobs efficiently", async () => {
      const result = await benchmark.run("Job Creation", 100, async () => {
        const job = await jobService.createJob({
          eventId:
            testEventIds[Math.floor(Math.random() * testEventIds.length)],
          userId: TEST_USER_ID,
          type: JobType.SCRIPT,
          payload: {
            input: { test: "data" },
            timestamp: Date.now(),
          },
        });
        testJobIds.push(job.id);
      });

      expect(result.avgTime).toBeLessThan(50); // Should create job in less than 50ms
      expect(result.opsPerSecond).toBeGreaterThan(20); // Should handle at least 20 jobs/second
    });

    it("should create jobs with different priorities efficiently", async () => {
      const priorities = [
        JobPriority.LOW,
        JobPriority.NORMAL,
        JobPriority.HIGH,
        JobPriority.CRITICAL,
      ];

      const result = await benchmark.run(
        "Job Creation with Priorities",
        100,
        async () => {
          const job = await jobService.createJob({
            eventId:
              testEventIds[Math.floor(Math.random() * testEventIds.length)],
            userId: TEST_USER_ID,
            type: JobType.SCRIPT,
            payload: { test: "data" },
            priority: priorities[Math.floor(Math.random() * priorities.length)],
          });
          testJobIds.push(job.id);
        },
      );

      expect(result.avgTime).toBeLessThan(50);
    });
  });

  describe("Job Queue Operations", () => {
    it("should list jobs efficiently", async () => {
      // Create some jobs first
      for (let i = 0; i < 50; i++) {
        const job = await jobService.createJob({
          eventId: testEventIds[0],
          userId: TEST_USER_ID,
          type: JobType.SCRIPT,
          payload: {},
        });
        testJobIds.push(job.id);
      }

      const result = await benchmark.run("Job Listing", 50, async () => {
        await jobService.listJobs({
          status: JobStatus.QUEUED,
          limit: 20,
        });
      });

      expect(result.avgTime).toBeLessThan(100); // Should list jobs in less than 100ms
    });

    it("should claim jobs efficiently", async () => {
      // Create jobs to claim
      const jobsToCreate = 200;
      for (let i = 0; i < jobsToCreate; i++) {
        const job = await jobService.createJob({
          eventId: testEventIds[i % testEventIds.length],
          userId: TEST_USER_ID,
          type: JobType.SCRIPT,
          payload: {},
          priority: i % 2 === 0 ? JobPriority.HIGH : JobPriority.NORMAL,
        });
        testJobIds.push(job.id);
      }

      const result = await benchmark.run(
        "Job Claiming (batch of 10)",
        20,
        async () => {
          await jobService.claimJobs(`orchestrator_${Date.now()}`, 10);
        },
      );

      expect(result.avgTime).toBeLessThan(200); // Should claim 10 jobs in less than 200ms
      expect(result.opsPerSecond).toBeGreaterThan(5); // Should handle at least 5 claim operations/second
    });
  });

  describe("Job Status Updates", () => {
    it("should update job status efficiently", async () => {
      // Create jobs to update
      const jobsForUpdate: string[] = [];
      for (let i = 0; i < 50; i++) {
        const job = await jobService.createJob({
          eventId: testEventIds[0],
          userId: TEST_USER_ID,
          type: JobType.SCRIPT,
          payload: {},
        });
        jobsForUpdate.push(job.id);
        testJobIds.push(job.id);
      }

      let index = 0;
      const result = await benchmark.run("Job Status Update", 50, async () => {
        await jobService.updateJobStatus(
          jobsForUpdate[index++ % jobsForUpdate.length],
          JobStatus.RUNNING,
        );
      });

      expect(result.avgTime).toBeLessThan(50); // Should update status in less than 50ms
    });

    it("should complete jobs with results efficiently", async () => {
      // Create and claim jobs
      const jobsToComplete: string[] = [];
      for (let i = 0; i < 30; i++) {
        const job = await jobService.createJob({
          eventId: testEventIds[0],
          userId: TEST_USER_ID,
          type: JobType.SCRIPT,
          payload: {},
        });
        await jobService.updateJobStatus(job.id, JobStatus.RUNNING);
        jobsToComplete.push(job.id);
        testJobIds.push(job.id);
      }

      let index = 0;
      const result = await benchmark.run("Job Completion", 30, async () => {
        await jobService.completeJob(
          jobsToComplete[index++ % jobsToComplete.length],
          {
            output: "Test output",
            metrics: {
              executionTime: 1234,
              memoryUsed: 56789,
            },
          },
        );
      });

      expect(result.avgTime).toBeLessThan(75); // Should complete job in less than 75ms
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle concurrent job creation", async () => {
      const concurrency = 10;

      const result = await benchmark.run(
        `Concurrent Job Creation (${concurrency} parallel)`,
        10,
        async () => {
          const promises = [];
          for (let i = 0; i < concurrency; i++) {
            promises.push(
              jobService
                .createJob({
                  eventId: testEventIds[i % testEventIds.length],
                  userId: TEST_USER_ID,
                  type: JobType.SCRIPT,
                  payload: { concurrent: true, index: i },
                })
                .then((job) => {
                  testJobIds.push(job.id);
                  return job;
                }),
            );
          }
          await Promise.all(promises);
        },
      );

      // Total time for 10 concurrent operations should be significantly less than 10x single operation
      expect(result.avgTime).toBeLessThan(200); // Should complete 10 concurrent creates in less than 200ms
    });

    it("should handle concurrent orchestrator claims", async () => {
      // Create many jobs
      for (let i = 0; i < 100; i++) {
        const job = await jobService.createJob({
          eventId: testEventIds[i % testEventIds.length],
          userId: TEST_USER_ID,
          type: JobType.SCRIPT,
          payload: {},
        });
        testJobIds.push(job.id);
      }

      const orchestrators = 5;
      const result = await benchmark.run(
        `Concurrent Claims (${orchestrators} orchestrators)`,
        10,
        async () => {
          const promises = [];
          for (let i = 0; i < orchestrators; i++) {
            promises.push(jobService.claimJobs(`orchestrator_${i}`, 5));
          }
          await Promise.all(promises);
        },
      );

      expect(result.avgTime).toBeLessThan(500); // Should handle 5 concurrent claims in less than 500ms
    });
  });

  describe("API Endpoint Performance", () => {
    it("should execute events efficiently via API", async () => {
      const result = await benchmark.run(
        "Event Execution API",
        20,
        async () => {
          const response = await supertest(API_BASE_URL)
            .post("/api/trpc/events.execute")
            .send({
              json: {
                id: testEventIds[0],
                input: { timestamp: Date.now() },
              },
            })
            .set("Authorization", `Bearer ${process.env.TEST_AUTH_TOKEN}`)
            .expect(200);

          const jobId = response.body.result.data.json.jobId;
          testJobIds.push(jobId);
        },
      );

      expect(result.avgTime).toBeLessThan(300); // API call should complete in less than 300ms
    });

    it("should retrieve job queue efficiently via internal API", async () => {
      // Create jobs for queue
      for (let i = 0; i < 50; i++) {
        const job = await jobService.createJob({
          eventId: testEventIds[0],
          userId: TEST_USER_ID,
          type: JobType.SCRIPT,
          payload: {},
        });
        testJobIds.push(job.id);
      }

      const result = await benchmark.run(
        "Internal Job Queue API",
        30,
        async () => {
          await supertest(API_BASE_URL)
            .get("/api/internal/jobs/queue")
            .set("x-orchestrator-id", "perf-test-orchestrator")
            .set("x-api-key", process.env.INTERNAL_API_KEY!)
            .query({ limit: 10 })
            .expect(200);
        },
      );

      expect(result.avgTime).toBeLessThan(150); // Internal API should respond in less than 150ms
    });
  });

  describe("Memory and Resource Usage", () => {
    it("should maintain stable memory usage during bulk operations", async () => {
      const initialMemory = process.memoryUsage();

      // Perform many operations
      for (let i = 0; i < 500; i++) {
        const job = await jobService.createJob({
          eventId: testEventIds[i % testEventIds.length],
          userId: TEST_USER_ID,
          type: JobType.SCRIPT,
          payload: {
            data: `Test data ${i}`.repeat(10), // Some payload data
          },
        });
        testJobIds.push(job.id);

        // Update status
        await jobService.updateJobStatus(job.id, JobStatus.RUNNING);

        // Complete some jobs
        if (i % 3 === 0) {
          await jobService.completeJob(job.id, { result: "done" });
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

      console.log(
        `Memory increase after 500 operations: ${memoryIncreaseMB.toFixed(2)} MB`,
      );

      // Memory increase should be reasonable (less than 100MB for 500 operations)
      expect(memoryIncreaseMB).toBeLessThan(100);
    });
  });

  describe("Database Query Performance", () => {
    it("should retrieve job statistics efficiently", async () => {
      const result = await benchmark.run(
        "Job Statistics Query",
        50,
        async () => {
          await jobService.getJobStats({ userId: TEST_USER_ID });
        },
      );

      expect(result.avgTime).toBeLessThan(50); // Stats query should complete in less than 50ms
    });

    it("should handle filtered queries efficiently", async () => {
      const result = await benchmark.run("Filtered Job Query", 30, async () => {
        await jobService.listJobs({
          status: JobStatus.QUEUED,
          type: JobType.SCRIPT,
          userId: TEST_USER_ID,
          limit: 50,
        });
      });

      expect(result.avgTime).toBeLessThan(100); // Filtered query should complete in less than 100ms
    });
  });
});
