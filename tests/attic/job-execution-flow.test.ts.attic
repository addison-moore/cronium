/**
 * Integration tests for end-to-end job execution flow
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import { db } from "@/server/db";
import {
  events,
  jobs,
  logs,
  EventType,
  EventStatus,
  JobStatus,
  LogStatus,
} from "@/shared/schema";
import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { eq } from "drizzle-orm";
import supertest from "supertest";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { io as ioClient, Socket as ClientSocket } from "socket.io-client";

// Test configuration
const TEST_USER_ID = "test_user_123";
const TEST_EVENT_NAME = "Test Integration Event";
const API_BASE_URL = process.env.API_URL || "http://localhost:5001";

describe("Job Execution Flow Integration", () => {
  let testEventId: number;
  let httpServer: any;
  let io: SocketIOServer;
  let clientSocket: ClientSocket;

  beforeAll(async () => {
    // Set up WebSocket server for testing
    httpServer = createServer();
    io = new SocketIOServer(httpServer, {
      cors: { origin: "*" },
    });

    // Initialize WebSocket handlers
    const { initializeLogsWebSocket } = await import("@/server/logs-websocket");
    initializeLogsWebSocket(io);

    await new Promise<void>((resolve) => {
      httpServer.listen(5002, resolve);
    });
  });

  afterAll(async () => {
    // Clean up
    if (clientSocket) clientSocket.disconnect();
    io.close();
    httpServer.close();

    // Clean up test data
    await db.delete(logs).where(eq(logs.eventId, testEventId));
    await db.delete(jobs).where(eq(jobs.eventId, testEventId));
    await db.delete(events).where(eq(events.id, testEventId));
  });

  beforeEach(async () => {
    // Create test event
    const [testEvent] = await db
      .insert(events)
      .values({
        userId: TEST_USER_ID,
        name: TEST_EVENT_NAME,
        type: EventType.NODEJS,
        content: `
        // Test script that uses runtime API
        const input = await cronium.getInput();
        console.log('Processing input:', input);
        
        const result = {
          processed: true,
          timestamp: Date.now(),
          input: input
        };
        
        await cronium.setOutput(result);
        await cronium.setVariable('lastRun', new Date().toISOString());
      `,
        status: EventStatus.ACTIVE,
        runLocation: "LOCAL",
        scheduleNumber: 1,
        scheduleUnit: "MINUTES",
        timeoutValue: 30,
        timeoutUnit: "SECONDS",
        retries: 0,
        shared: false,
        tags: ["test", "integration", "runtime:api"],
      })
      .returning();

    testEventId = testEvent.id;
  });

  describe("Manual Event Execution", () => {
    it("should create job when event is executed", async () => {
      // Execute event via API
      const response = await supertest(API_BASE_URL)
        .post(`/api/trpc/events.execute`)
        .send({
          json: {
            id: testEventId,
            input: { test: "data" },
          },
        })
        .set("Authorization", `Bearer ${process.env.TEST_AUTH_TOKEN}`)
        .expect(200);

      const result = response.body.result.data.json;

      expect(result.jobId).toBeDefined();
      expect(result.status).toBe("queued");
      expect(result.logId).toBeDefined();

      // Verify job was created
      const job = await jobService.getJob(result.jobId);
      expect(job).toBeDefined();
      expect(job?.eventId).toBe(testEventId);
      expect(job?.status).toBe(JobStatus.QUEUED);
      expect(job?.payload.input).toEqual({ test: "data" });
    });

    it("should create execution log entry", async () => {
      const response = await supertest(API_BASE_URL)
        .post(`/api/trpc/events.execute`)
        .send({
          json: {
            id: testEventId,
            input: {},
          },
        })
        .set("Authorization", `Bearer ${process.env.TEST_AUTH_TOKEN}`)
        .expect(200);

      const { logId } = response.body.result.data.json;

      // Verify log was created
      const log = await storage.getLog(logId);
      expect(log).toBeDefined();
      expect(log?.eventId).toBe(testEventId);
      expect(log?.status).toBe(LogStatus.PENDING);
      expect(log?.userId).toBe(TEST_USER_ID);
    });
  });

  describe("Job Queue Processing", () => {
    it("should allow orchestrator to claim jobs", async () => {
      // Create multiple jobs
      const job1 = await jobService.createJob({
        eventId: testEventId,
        userId: TEST_USER_ID,
        type: JobType.SCRIPT,
        payload: { input: { job: 1 } },
      });

      const job2 = await jobService.createJob({
        eventId: testEventId,
        userId: TEST_USER_ID,
        type: JobType.SCRIPT,
        payload: { input: { job: 2 } },
        priority: JobPriority.HIGH,
      });

      // Orchestrator claims jobs
      const response = await supertest(API_BASE_URL)
        .get("/api/internal/jobs/queue")
        .set("x-orchestrator-id", "test-orchestrator")
        .set("x-api-key", process.env.INTERNAL_API_KEY!)
        .query({
          limit: 5,
          types: "SCRIPT",
        })
        .expect(200);

      const claimedJobs = response.body.jobs;

      expect(claimedJobs.length).toBe(2);
      // High priority job should be first
      expect(claimedJobs[0].id).toBe(job2.id);
      expect(claimedJobs[0].status).toBe(JobStatus.CLAIMED);
      expect(claimedJobs[0].orchestratorId).toBe("test-orchestrator");

      // Verify jobs were updated in database
      const updatedJob1 = await jobService.getJob(job1.id);
      expect(updatedJob1?.status).toBe(JobStatus.CLAIMED);
      expect(updatedJob1?.claimedAt).toBeDefined();
    });

    it("should not return already claimed jobs", async () => {
      // Create and claim a job
      const job = await jobService.createJob({
        eventId: testEventId,
        userId: TEST_USER_ID,
        type: JobType.SCRIPT,
        payload: {},
      });

      await jobService.claimJobs("orchestrator-1", 10);

      // Another orchestrator tries to claim
      const response = await supertest(API_BASE_URL)
        .get("/api/internal/jobs/queue")
        .set("x-orchestrator-id", "orchestrator-2")
        .set("x-api-key", process.env.INTERNAL_API_KEY!)
        .expect(200);

      expect(response.body.jobs).toHaveLength(0);
    });
  });

  describe("Real-time Log Streaming", () => {
    it("should stream logs via WebSocket", async () => {
      // Create job and log
      const job = await jobService.createJob({
        eventId: testEventId,
        userId: TEST_USER_ID,
        type: JobType.SCRIPT,
        payload: {},
      });

      const [log] = await db
        .insert(logs)
        .values({
          eventId: testEventId,
          jobId: job.id,
          userId: TEST_USER_ID,
          status: LogStatus.RUNNING,
          startTime: new Date(),
        })
        .returning();

      // Connect WebSocket client
      clientSocket = ioClient("http://localhost:5002/logs", {
        auth: {
          userId: TEST_USER_ID,
          jobId: job.id,
        },
      });

      await new Promise<void>((resolve) => {
        clientSocket.on("connect", resolve);
      });

      // Subscribe to log updates
      const logUpdates: any[] = [];
      clientSocket.on("log:line", (data) => {
        logUpdates.push(data);
      });

      await new Promise<void>((resolve) => {
        clientSocket.emit("subscribe", { jobId: job.id }, resolve);
      });

      // Simulate log streaming
      const { getLogsWebSocketHandler } = await import(
        "@/server/logs-websocket"
      );
      const logsHandler = getLogsWebSocketHandler();

      logsHandler?.broadcastLogLine(
        log.id,
        "Starting script execution...",
        "stdout",
      );
      logsHandler?.broadcastLogLine(log.id, "Processing input data", "stdout");
      logsHandler?.broadcastLogLine(log.id, "Warning: Large dataset", "stderr");

      // Wait for messages
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(logUpdates).toHaveLength(3);
      expect(logUpdates[0]).toMatchObject({
        logId: log.id,
        line: "Starting script execution...",
        stream: "stdout",
      });
      expect(logUpdates[2].stream).toBe("stderr");
    });

    it("should broadcast job status updates", async () => {
      const job = await jobService.createJob({
        eventId: testEventId,
        userId: TEST_USER_ID,
        type: JobType.SCRIPT,
        payload: {},
      });

      const [log] = await db
        .insert(logs)
        .values({
          eventId: testEventId,
          jobId: job.id,
          userId: TEST_USER_ID,
          status: LogStatus.PENDING,
          startTime: new Date(),
        })
        .returning();

      // Connect and subscribe
      clientSocket = ioClient("http://localhost:5002/logs", {
        auth: {
          userId: TEST_USER_ID,
          logId: log.id,
        },
      });

      await new Promise<void>((resolve) => {
        clientSocket.on("connect", resolve);
      });

      const statusUpdates: any[] = [];
      clientSocket.on("log:update", (data) => {
        statusUpdates.push(data);
      });

      await new Promise<void>((resolve) => {
        clientSocket.emit("subscribe", { logId: log.id }, resolve);
      });

      // Update job status
      await jobService.updateJobStatus(job.id, JobStatus.RUNNING);

      const { getLogsWebSocketHandler } = await import(
        "@/server/logs-websocket"
      );
      const logsHandler = getLogsWebSocketHandler();
      await logsHandler?.broadcastJobUpdate({
        ...job,
        status: JobStatus.RUNNING,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(statusUpdates.length).toBeGreaterThan(0);
      expect(statusUpdates[0]).toMatchObject({
        logId: log.id,
        status: "RUNNING",
      });
    });
  });

  describe("Job Completion Flow", () => {
    it("should update log when job completes successfully", async () => {
      const job = await jobService.createJob({
        eventId: testEventId,
        userId: TEST_USER_ID,
        type: JobType.SCRIPT,
        payload: {},
      });

      const [log] = await db
        .insert(logs)
        .values({
          eventId: testEventId,
          jobId: job.id,
          userId: TEST_USER_ID,
          status: LogStatus.RUNNING,
          startTime: new Date(),
        })
        .returning();

      // Complete job
      const result = { output: "Success", data: { processed: true } };
      await jobService.completeJob(job.id, result);

      // Update log
      await storage.updateLog(log.id, {
        status: LogStatus.SUCCESS,
        output: JSON.stringify(result),
        endTime: new Date(),
        successful: true,
      });

      // Verify updates
      const updatedLog = await storage.getLog(log.id);
      expect(updatedLog?.status).toBe(LogStatus.SUCCESS);
      expect(updatedLog?.successful).toBe(true);
      expect(updatedLog?.output).toContain("Success");
    });

    it("should handle job failure correctly", async () => {
      const job = await jobService.createJob({
        eventId: testEventId,
        userId: TEST_USER_ID,
        type: JobType.SCRIPT,
        payload: {},
      });

      const [log] = await db
        .insert(logs)
        .values({
          eventId: testEventId,
          jobId: job.id,
          userId: TEST_USER_ID,
          status: LogStatus.RUNNING,
          startTime: new Date(),
        })
        .returning();

      // Fail job
      const error = "Script execution failed: Syntax error";
      await jobService.failJob(job.id, error);

      // Update log
      await storage.updateLog(log.id, {
        status: LogStatus.FAILURE,
        error: error,
        endTime: new Date(),
        successful: false,
      });

      // Verify updates
      const updatedLog = await storage.getLog(log.id);
      expect(updatedLog?.status).toBe(LogStatus.FAILURE);
      expect(updatedLog?.successful).toBe(false);
      expect(updatedLog?.error).toBe(error);
    });
  });

  describe("Workflow Execution", () => {
    it("should create jobs for workflow events in sequence", async () => {
      // Create second event for workflow
      const [secondEvent] = await db
        .insert(events)
        .values({
          userId: TEST_USER_ID,
          name: "Second Workflow Event",
          type: EventType.PYTHON,
          content: 'print("Second event")',
          status: EventStatus.ACTIVE,
          runLocation: "LOCAL",
          scheduleNumber: 1,
          scheduleUnit: "MINUTES",
          timeoutValue: 30,
          timeoutUnit: "SECONDS",
          retries: 0,
          shared: false,
          tags: ["runtime:api"],
        })
        .returning();

      // Execute workflow with multiple events
      const workflowExecutionId = 12345;

      // Execute first event
      const job1 = await jobService.createJob({
        eventId: testEventId,
        userId: TEST_USER_ID,
        type: JobType.SCRIPT,
        payload: {
          workflowExecutionId,
          input: { step: 1 },
        },
        metadata: {
          workflowExecutionId,
          sequenceOrder: 1,
        },
      });

      // Simulate completion of first job
      await jobService.completeJob(job1.id, {
        output: { step1Result: "completed" },
      });

      // Execute second event with output from first
      const job2 = await jobService.createJob({
        eventId: secondEvent.id,
        userId: TEST_USER_ID,
        type: JobType.SCRIPT,
        payload: {
          workflowExecutionId,
          input: { step1Result: "completed" },
        },
        metadata: {
          workflowExecutionId,
          sequenceOrder: 2,
        },
      });

      // Verify workflow metadata
      expect(job2.metadata.workflowExecutionId).toBe(workflowExecutionId);
      expect(job2.payload.input.step1Result).toBe("completed");

      // Clean up
      await db.delete(events).where(eq(events.id, secondEvent.id));
    });
  });
});
