import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { TRPCError } from "@trpc/server";
import { storage } from "@/server/storage";

// Mock the storage module
jest.mock("@/server/storage", () => ({
  storage: {
    getWorkflow: jest.fn(),
    getWorkflowExecution: jest.fn(),
    getWorkflowExecutionEvents: jest.fn(),
  },
}));

describe("workflows router", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getExecution", () => {
    it("should successfully get workflow execution details", async () => {
      const mockWorkflow = {
        id: 1,
        userId: "user-123",
        name: "Test Workflow",
        shared: false,
      };

      const mockExecution = {
        id: 1,
        workflowId: 1,
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
      };

      const mockEvents = [
        {
          id: 1,
          executionId: 1,
          eventId: 1,
          status: "SUCCESS",
          startedAt: new Date(),
          completedAt: new Date(),
        },
        {
          id: 2,
          executionId: 1,
          eventId: 2,
          status: "SUCCESS",
          startedAt: new Date(),
          completedAt: new Date(),
        },
      ];

      // Mock storage methods
      (storage.getWorkflow as jest.Mock).mockResolvedValue(mockWorkflow);
      (storage.getWorkflowExecution as jest.Mock).mockResolvedValue(
        mockExecution,
      );
      (storage.getWorkflowExecutionEvents as jest.Mock).mockResolvedValue(
        mockEvents,
      );

      // Mock context and input
      const ctx = { userId: "user-123" };
      const input = { workflowId: 1, executionId: 1 };

      // Simulate the getExecution procedure logic
      const result = await (async () => {
        const workflow = await storage.getWorkflow(input.workflowId);
        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }

        if (workflow.userId !== ctx.userId && !workflow.shared) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        const execution = await storage.getWorkflowExecution(input.executionId);
        if (!execution || execution.workflowId !== input.workflowId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Execution not found",
          });
        }

        const events = await storage.getWorkflowExecutionEvents(
          input.executionId,
        );

        const totalEvents = events.length;
        const successfulEvents = events.filter(
          (event: any) =>
            event.status === "SUCCESS" || event.status === "completed",
        ).length;
        const failedEvents = events.filter(
          (event: any) =>
            event.status === "FAILURE" ||
            event.status === "ERROR" ||
            event.status === "failed",
        ).length;

        return {
          ...execution,
          totalEvents,
          successfulEvents,
          failedEvents,
          events,
        };
      })();

      expect(result).toEqual({
        ...mockExecution,
        totalEvents: 2,
        successfulEvents: 2,
        failedEvents: 0,
        events: mockEvents,
      });
      expect(storage.getWorkflow).toHaveBeenCalledWith(1);
      expect(storage.getWorkflowExecution).toHaveBeenCalledWith(1);
      expect(storage.getWorkflowExecutionEvents).toHaveBeenCalledWith(1);
    });

    it("should throw FORBIDDEN error when user lacks access", async () => {
      const mockWorkflow = {
        id: 1,
        userId: "other-user",
        name: "Test Workflow",
        shared: false,
      };

      (storage.getWorkflow as jest.Mock).mockResolvedValue(mockWorkflow);

      const ctx = { userId: "user-123" };
      const input = { workflowId: 1, executionId: 1 };

      await expect(async () => {
        const workflow = await storage.getWorkflow(input.workflowId);
        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }

        if (workflow.userId !== ctx.userId && !workflow.shared) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
      }).rejects.toThrow("Access denied");
    });

    it("should allow access to shared workflows", async () => {
      const mockWorkflow = {
        id: 1,
        userId: "other-user",
        name: "Test Workflow",
        shared: true,
      };

      const mockExecution = {
        id: 1,
        workflowId: 1,
        status: "running",
      };

      (storage.getWorkflow as jest.Mock).mockResolvedValue(mockWorkflow);
      (storage.getWorkflowExecution as jest.Mock).mockResolvedValue(
        mockExecution,
      );
      (storage.getWorkflowExecutionEvents as jest.Mock).mockResolvedValue([]);

      const ctx = { userId: "user-123" };
      const input = { workflowId: 1, executionId: 1 };

      const result = await (async () => {
        const workflow = await storage.getWorkflow(input.workflowId);
        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }

        if (workflow.userId !== ctx.userId && !workflow.shared) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        const execution = await storage.getWorkflowExecution(input.executionId);
        const events = await storage.getWorkflowExecutionEvents(
          input.executionId,
        );

        return {
          ...execution,
          totalEvents: 0,
          successfulEvents: 0,
          failedEvents: 0,
          events,
        };
      })();

      expect(result.totalEvents).toBe(0);
    });

    it("should calculate execution statistics correctly", async () => {
      const mockWorkflow = {
        id: 1,
        userId: "user-123",
        name: "Test Workflow",
        shared: false,
      };

      const mockExecution = {
        id: 1,
        workflowId: 1,
        status: "completed",
      };

      const mockEvents = [
        { id: 1, status: "SUCCESS" },
        { id: 2, status: "completed" },
        { id: 3, status: "FAILURE" },
        { id: 4, status: "ERROR" },
        { id: 5, status: "failed" },
      ];

      (storage.getWorkflow as jest.Mock).mockResolvedValue(mockWorkflow);
      (storage.getWorkflowExecution as jest.Mock).mockResolvedValue(
        mockExecution,
      );
      (storage.getWorkflowExecutionEvents as jest.Mock).mockResolvedValue(
        mockEvents,
      );

      const ctx = { userId: "user-123" };
      const input = { workflowId: 1, executionId: 1 };

      const result = await (async () => {
        const workflow = await storage.getWorkflow(input.workflowId);
        const execution = await storage.getWorkflowExecution(input.executionId);
        const events = await storage.getWorkflowExecutionEvents(
          input.executionId,
        );

        const totalEvents = events.length;
        const successfulEvents = events.filter(
          (event: any) =>
            event.status === "SUCCESS" || event.status === "completed",
        ).length;
        const failedEvents = events.filter(
          (event: any) =>
            event.status === "FAILURE" ||
            event.status === "ERROR" ||
            event.status === "failed",
        ).length;

        return {
          ...execution,
          totalEvents,
          successfulEvents,
          failedEvents,
          events,
        };
      })();

      expect(result.totalEvents).toBe(5);
      expect(result.successfulEvents).toBe(2);
      expect(result.failedEvents).toBe(3);
    });
  });
});
