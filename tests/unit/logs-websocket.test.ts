/**
 * Unit tests for Logs WebSocket Handler
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { LogsWebSocketHandler } from "@/server/logs-websocket";
import { Server, Socket } from "socket.io";
import { storage } from "@/server/storage";
import { jobService } from "@/lib/services/job-service";

// Mock dependencies
jest.mock("@/server/storage");
jest.mock("@/lib/services/job-service");

// Mock Socket.IO
const mockIo = {
  of: jest.fn(),
};

const mockNamespace = {
  use: jest.fn(),
  on: jest.fn(),
  to: jest.fn(),
  emit: jest.fn(),
};

const mockSocket = {
  id: "test-socket-id",
  handshake: {
    auth: {
      userId: "user123",
      jobId: "job_123",
      logId: 1,
    },
  },
  data: {},
  join: jest.fn(),
  leave: jest.fn(),
  emit: jest.fn(),
  on: jest.fn(),
};

describe("LogsWebSocketHandler", () => {
  let handler: LogsWebSocketHandler;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock chain
    mockIo.of.mockReturnValue(mockNamespace);
    mockNamespace.to.mockReturnValue(mockNamespace);

    handler = new LogsWebSocketHandler(mockIo as any);
  });

  describe("constructor", () => {
    it("should set up the /logs namespace", () => {
      expect(mockIo.of).toHaveBeenCalledWith("/logs");
      expect(mockNamespace.use).toHaveBeenCalled();
      expect(mockNamespace.on).toHaveBeenCalledWith(
        "connection",
        expect.any(Function),
      );
    });
  });

  describe("authentication middleware", () => {
    let authMiddleware: any;

    beforeEach(() => {
      authMiddleware = mockNamespace.use.mock.calls[0][0];
    });

    it("should reject connection without userId", async () => {
      const next = jest.fn();
      const socketWithoutAuth = { ...mockSocket, handshake: { auth: {} } };

      await authMiddleware(socketWithoutAuth, next);

      expect(next).toHaveBeenCalledWith(new Error("Authentication required"));
    });

    it("should validate job access", async () => {
      const next = jest.fn();
      const mockJob = { id: "job_123", userId: "user123" };

      (jobService.getJob as jest.Mock).mockResolvedValue(mockJob);

      await authMiddleware(mockSocket, next);

      expect(jobService.getJob).toHaveBeenCalledWith("job_123");
      expect(mockSocket.data.job).toEqual(mockJob);
      expect(next).toHaveBeenCalled();
    });

    it("should reject if job belongs to different user", async () => {
      const next = jest.fn();
      const mockJob = { id: "job_123", userId: "other_user" };

      (jobService.getJob as jest.Mock).mockResolvedValue(mockJob);

      await authMiddleware(mockSocket, next);

      expect(next).toHaveBeenCalledWith(new Error("Access denied"));
    });

    it("should validate log access", async () => {
      const next = jest.fn();
      const mockLog = { id: 1, userId: "user123" };
      const socketWithLog = {
        ...mockSocket,
        handshake: { auth: { userId: "user123", logId: 1 } },
      };

      (storage.getLog as jest.Mock).mockResolvedValue(mockLog);

      await authMiddleware(socketWithLog, next);

      expect(storage.getLog).toHaveBeenCalledWith(1);
      expect(socketWithLog.data.log).toEqual(mockLog);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("connection handling", () => {
    let connectionHandler: any;

    beforeEach(() => {
      connectionHandler = mockNamespace.on.mock.calls[0][1];
    });

    it("should handle client connection", () => {
      console.log = jest.fn();

      connectionHandler(mockSocket);

      expect(console.log).toHaveBeenCalledWith(
        `Client connected to logs namespace: ${mockSocket.id}`,
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        "subscribe",
        expect.any(Function),
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        "unsubscribe",
        expect.any(Function),
      );
      expect(mockSocket.on).toHaveBeenCalledWith(
        "disconnect",
        expect.any(Function),
      );
    });
  });

  describe("subscribe event", () => {
    let subscribeHandler: any;

    beforeEach(() => {
      connectionHandler = mockNamespace.on.mock.calls[0][1];
      connectionHandler(mockSocket);
      subscribeHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "subscribe",
      )[1];
    });

    it("should subscribe to log updates by job ID", async () => {
      const mockLog = {
        id: 1,
        userId: "user123",
        status: "RUNNING",
        output: "test output",
      };

      (jobService.getJob as jest.Mock).mockResolvedValue({
        id: "job_123",
        userId: "user123",
        eventId: 1,
      });

      (storage.getLogsByEventId as jest.Mock).mockResolvedValue([mockLog]);
      (storage.getLog as jest.Mock).mockResolvedValue(mockLog);

      await subscribeHandler({ jobId: "job_123" });

      expect(mockSocket.join).toHaveBeenCalledWith("log:1");
      expect(mockSocket.emit).toHaveBeenCalledWith("log:initial", {
        logId: 1,
        status: "RUNNING",
        output: "test output",
        error: undefined,
        startTime: undefined,
        endTime: undefined,
      });
    });

    it("should subscribe to log updates by log ID", async () => {
      const mockLog = {
        id: 2,
        userId: "user123",
        status: "SUCCESS",
        output: "completed",
        error: null,
        startTime: new Date(),
        endTime: new Date(),
      };

      (storage.getLog as jest.Mock).mockResolvedValue(mockLog);

      await subscribeHandler({ logId: 2 });

      expect(mockSocket.join).toHaveBeenCalledWith("log:2");
      expect(mockSocket.emit).toHaveBeenCalledWith("log:initial", {
        logId: 2,
        status: "SUCCESS",
        output: "completed",
        error: null,
        startTime: mockLog.startTime,
        endTime: mockLog.endTime,
      });
    });

    it("should handle invalid log ID", async () => {
      await subscribeHandler({ logId: null, jobId: null });

      expect(mockSocket.emit).toHaveBeenCalledWith("error", {
        message: "Invalid log or job ID",
      });
    });

    it("should handle access denied", async () => {
      const mockLog = { id: 1, userId: "other_user" };

      (storage.getLog as jest.Mock).mockResolvedValue(mockLog);

      await subscribeHandler({ logId: 1 });

      expect(mockSocket.emit).toHaveBeenCalledWith("error", {
        message: "Access denied",
      });
    });
  });

  describe("unsubscribe event", () => {
    let unsubscribeHandler: any;

    beforeEach(() => {
      connectionHandler = mockNamespace.on.mock.calls[0][1];
      connectionHandler(mockSocket);
      unsubscribeHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "unsubscribe",
      )[1];
    });

    it("should unsubscribe from log updates", () => {
      console.log = jest.fn();

      unsubscribeHandler({ logId: 1 });

      expect(mockSocket.leave).toHaveBeenCalledWith("log:1");
      expect(console.log).toHaveBeenCalledWith(
        `Socket ${mockSocket.id} unsubscribed from log 1`,
      );
    });
  });

  describe("disconnect event", () => {
    let disconnectHandler: any;

    beforeEach(() => {
      connectionHandler = mockNamespace.on.mock.calls[0][1];
      connectionHandler(mockSocket);
      disconnectHandler = mockSocket.on.mock.calls.find(
        (call: any[]) => call[0] === "disconnect",
      )[1];
    });

    it("should clean up on disconnect", () => {
      console.log = jest.fn();

      // Add socket to active streams
      handler["activeStreams"].set("log:1", new Set([mockSocket.id]));
      handler["activeStreams"].set(
        "log:2",
        new Set([mockSocket.id, "other-socket"]),
      );

      disconnectHandler();

      expect(console.log).toHaveBeenCalledWith(
        `Client disconnected from logs namespace: ${mockSocket.id}`,
      );
      expect(handler["activeStreams"].has("log:1")).toBe(false);
      expect(handler["activeStreams"].get("log:2")?.has(mockSocket.id)).toBe(
        false,
      );
    });
  });

  describe("broadcast methods", () => {
    it("should broadcast log update", () => {
      const update = {
        status: "COMPLETED",
        output: "Final output",
      };

      handler.broadcastLogUpdate(1, update);

      expect(mockNamespace.to).toHaveBeenCalledWith("log:1");
      expect(mockNamespace.emit).toHaveBeenCalledWith("log:update", {
        logId: 1,
        ...update,
        timestamp: expect.any(String),
      });
    });

    it("should broadcast log line", () => {
      handler.broadcastLogLine(1, "Test log line", "stdout");

      expect(mockNamespace.to).toHaveBeenCalledWith("log:1");
      expect(mockNamespace.emit).toHaveBeenCalledWith("log:line", {
        logId: 1,
        line: "Test log line",
        stream: "stdout",
        timestamp: expect.any(String),
      });
    });

    it("should broadcast stderr line", () => {
      handler.broadcastLogLine(1, "Error message", "stderr");

      expect(mockNamespace.to).toHaveBeenCalledWith("log:1");
      expect(mockNamespace.emit).toHaveBeenCalledWith("log:line", {
        logId: 1,
        line: "Error message",
        stream: "stderr",
        timestamp: expect.any(String),
      });
    });
  });

  describe("job update broadcasting", () => {
    it("should broadcast job status update to associated logs", async () => {
      const mockJob = {
        id: "job_123",
        status: JobStatus.COMPLETED,
      };

      const mockLogs = [
        { id: 1, jobId: "job_123" },
        { id: 2, jobId: "job_123" },
      ];

      (storage.getLogsByJobId as jest.Mock).mockResolvedValue(mockLogs);

      await handler.broadcastJobUpdate(mockJob as any);

      // Wait for async operation
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(storage.getLogsByJobId).toHaveBeenCalledWith("job_123");
      expect(mockNamespace.to).toHaveBeenCalledWith("log:1");
      expect(mockNamespace.to).toHaveBeenCalledWith("log:2");
    });

    it("should map job status to log status correctly", () => {
      const mappings = [
        { job: "queued", log: "PENDING" },
        { job: "claimed", log: "PENDING" },
        { job: "running", log: "RUNNING" },
        { job: "completed", log: "SUCCESS" },
        { job: "failed", log: "FAILURE" },
        { job: "cancelled", log: "FAILURE" },
      ];

      mappings.forEach(({ job, log }) => {
        expect(handler["mapJobStatusToLogStatus"](job)).toBe(log);
      });
    });

    it("should handle unknown job status", () => {
      expect(handler["mapJobStatusToLogStatus"]("unknown")).toBe("RUNNING");
    });
  });
});
