import React from "react";
import { describe, it, expect, beforeEach } from "@jest/globals";
import { renderHook, waitFor } from "@testing-library/react";
import {
  renderWithTrpc,
  createTrpcTestWrapper,
} from "../utils/trpc-test-utils";
import { trpc } from "@/lib/trpc";

describe("tRPC Endpoints Integration Tests", () => {
  describe("userAuth endpoints", () => {
    it("should handle deleteAccount mutation", async () => {
      const mockHandlers = {
        userAuth: {
          deleteAccount: jest.fn().mockResolvedValue({ success: true }),
        },
      };

      const wrapper = createTrpcTestWrapper(mockHandlers);

      const { result } = renderHook(
        () => trpc.userAuth.deleteAccount.useMutation(),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      // Test mutation execution
      result.current.mutate();

      await waitFor(() => {
        expect(mockHandlers.userAuth.deleteAccount).toHaveBeenCalled();
      });
    });
  });

  describe("workflows endpoints", () => {
    it("should handle getExecution query", async () => {
      const mockExecution = {
        id: 1,
        workflowId: 1,
        status: "completed",
        totalEvents: 3,
        successfulEvents: 3,
        failedEvents: 0,
        events: [],
      };

      const mockHandlers = {
        workflows: {
          getExecution: jest.fn().mockResolvedValue(mockExecution),
        },
      };

      const wrapper = createTrpcTestWrapper(mockHandlers);

      const { result } = renderHook(
        () =>
          trpc.workflows.getExecution.useQuery({
            workflowId: 1,
            executionId: 1,
          }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(mockExecution);
      });

      expect(mockHandlers.workflows.getExecution).toHaveBeenCalledWith({
        workflowId: 1,
        executionId: 1,
      });
    });

    it("should handle execution polling scenario", async () => {
      let callCount = 0;
      const mockHandlers = {
        workflows: {
          getExecution: jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return {
                id: 1,
                workflowId: 1,
                status: "running",
                totalEvents: 1,
                successfulEvents: 0,
                failedEvents: 0,
                events: [],
              };
            } else {
              return {
                id: 1,
                workflowId: 1,
                status: "completed",
                totalEvents: 1,
                successfulEvents: 1,
                failedEvents: 0,
                events: [],
              };
            }
          }),
        },
      };

      const wrapper = createTrpcTestWrapper(mockHandlers);

      const { result, rerender } = renderHook(
        () =>
          trpc.workflows.getExecution.useQuery(
            {
              workflowId: 1,
              executionId: 1,
            },
            {
              refetchInterval: 100, // Poll every 100ms for test
            },
          ),
        { wrapper },
      );

      // Initial state should be running
      await waitFor(() => {
        expect(result.current.data?.status).toBe("running");
      });

      // Wait for polling to update status
      await waitFor(
        () => {
          expect(result.current.data?.status).toBe("completed");
        },
        { timeout: 500 },
      );

      expect(mockHandlers.workflows.getExecution).toHaveBeenCalledTimes(2);
    });
  });

  describe("Error handling", () => {
    it("should handle authentication errors", async () => {
      const mockHandlers = {
        userAuth: {
          deleteAccount: jest.fn().mockRejectedValue({
            code: "UNAUTHORIZED",
            message: "User email not found in session",
          }),
        },
      };

      const wrapper = createTrpcTestWrapper(mockHandlers);

      const { result } = renderHook(
        () => trpc.userAuth.deleteAccount.useMutation(),
        { wrapper },
      );

      result.current.mutate();

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
        expect(result.current.error?.message).toContain("User email not found");
      });
    });

    it("should handle not found errors", async () => {
      const mockHandlers = {
        workflows: {
          getExecution: jest.fn().mockRejectedValue({
            code: "NOT_FOUND",
            message: "Workflow not found",
          }),
        },
      };

      const wrapper = createTrpcTestWrapper(mockHandlers);

      const { result } = renderHook(
        () =>
          trpc.workflows.getExecution.useQuery({
            workflowId: 999,
            executionId: 1,
          }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
        expect(result.current.error?.message).toContain("Workflow not found");
      });
    });
  });

  describe("Query options integration", () => {
    it("should use QUERY_OPTIONS patterns", async () => {
      const mockHandlers = {
        dashboard: {
          getStats: jest.fn().mockResolvedValue({
            totalScripts: 10,
            activeScripts: 5,
            successRate: 95,
          }),
        },
      };

      const wrapper = createTrpcTestWrapper(mockHandlers);

      const { result } = renderHook(
        () =>
          trpc.dashboard.getStats.useQuery(
            { days: 30 },
            {
              staleTime: 0, // Realtime data
              refetchInterval: 30000, // 30 seconds
            },
          ),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
        expect(result.current.data?.totalScripts).toBe(10);
      });
    });
  });
});
