import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  executeToolAction,
  type ToolActionResult,
  type ToolActionConfig,
} from "@/lib/scheduler/tool-action-executor";
import {
  type Event,
  EventType,
  EventStatus,
  RunLocation,
  EventTriggerType,
} from "@/shared/schema";
import {
  ToolPluginRegistry,
  type ToolAction,
} from "@/components/tools/types/tool-plugin";
import { z } from "zod";

// Mock feature flags
jest.mock("@/lib/featureFlags", () => ({
  isToolActionsExecutionEnabled: jest.fn(() => true),
}));

// Mock storage
jest.mock("@/server/storage", () => ({
  storage: {
    getToolById: jest.fn(),
  },
}));

// Mock the tool plugin registry import
jest.mock("@/components/tools/types/tool-plugin", () => {
  const mockAction: ToolAction = {
    id: "test-action",
    name: "Test Action",
    description: "A test action",
    category: "Test",
    actionType: "create",
    developmentMode: "visual",
    inputSchema: z.object({
      message: z.string(),
      count: z.number().optional(),
    }),
    outputSchema: z.object({
      result: z.string(),
      processedCount: z.number(),
    }),
    execute: jest.fn(),
  };

  return {
    ToolPluginRegistry: {
      getActionById: jest.fn(() => mockAction),
    },
  };
});

describe("toolActionExecutor", () => {
  const mockEvent: Event = {
    id: 1,
    userId: "user-123",
    name: "Test Event",
    type: EventType.TOOL_ACTION,
    status: EventStatus.ACTIVE,
    triggerType: EventTriggerType.MANUAL,
    runLocation: RunLocation.LOCAL,
    toolActionConfig: JSON.stringify({
      toolType: "SLACK",
      actionId: "test-action",
      toolId: 1,
      parameters: { message: "Hello", count: 5 },
    }),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAction = ToolPluginRegistry.getActionById(
    "test-action",
  ) as ToolAction;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset execute mock
    (mockAction.execute as jest.Mock).mockReset();
  });

  describe("Feature Flag Check", () => {
    it("should throw error when tool actions are disabled", async () => {
      const { isToolActionsExecutionEnabled } =
        jest.requireMock("@/lib/featureFlags");
      isToolActionsExecutionEnabled.mockReturnValueOnce(false);

      await expect(executeToolAction(mockEvent)).rejects.toThrow(
        "Tool action execution is disabled via feature flags",
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should handle invalid JSON configuration", async () => {
      const eventWithBadConfig = {
        ...mockEvent,
        toolActionConfig: "{ invalid json",
      };

      const result = await executeToolAction(eventWithBadConfig);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid tool action configuration");
      expect(result.stdout).toBe("");
    });

    it("should handle missing configuration", async () => {
      const eventWithNoConfig = {
        ...mockEvent,
        toolActionConfig: undefined,
      };

      const result = await executeToolAction(eventWithNoConfig);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Incomplete tool action configuration");
    });

    it("should handle incomplete configuration", async () => {
      const eventWithIncompleteConfig = {
        ...mockEvent,
        toolActionConfig: JSON.stringify({
          toolType: "SLACK",
          // Missing actionId and toolId
        }),
      };

      const result = await executeToolAction(eventWithIncompleteConfig);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Incomplete tool action configuration");
    });
  });

  describe("Action Execution", () => {
    it("should execute action successfully", async () => {
      const mockResult = {
        result: "Success",
        processedCount: 5,
      };

      (mockAction.execute as jest.Mock).mockResolvedValue(mockResult);

      const result = await executeToolAction(mockEvent);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");

      const output = JSON.parse(result.stdout);
      expect(output).toMatchObject({
        actionId: "test-action",
        actionName: "Test Action",
        result: mockResult,
        parameters: { message: "Hello", count: 5 },
      });
      expect(output.executionTime).toBeGreaterThan(0);
      expect(output.timestamp).toBeDefined();
    });

    it("should merge input parameters with configured parameters", async () => {
      (mockAction.execute as jest.Mock).mockResolvedValue({ result: "ok" });

      const inputData = {
        message: "Overridden message",
        extraParam: "extra",
      };

      await executeToolAction(mockEvent, inputData);

      expect(mockAction.execute).toHaveBeenCalledWith(
        expect.any(Object), // credentials
        {
          message: "Overridden message", // Input overrides configured
          count: 5, // From configured parameters
          extraParam: "extra", // Additional from input
        },
        expect.any(Object), // context
      );
    });

    it("should handle action not found", async () => {
      (ToolPluginRegistry.getActionById as jest.Mock).mockReturnValueOnce(
        undefined,
      );

      const result = await executeToolAction(mockEvent);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Action not found: test-action");
    });
  });

  describe("Parameter Validation", () => {
    it("should validate parameters against action schema", async () => {
      const eventWithInvalidParams = {
        ...mockEvent,
        toolActionConfig: JSON.stringify({
          toolType: "SLACK",
          actionId: "test-action",
          toolId: 1,
          parameters: {
            // Missing required 'message' field
            count: "not a number", // Wrong type
          },
        }),
      };

      const result = await executeToolAction(eventWithInvalidParams);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Parameter validation failed");
    });

    it("should pass validation with correct parameters", async () => {
      (mockAction.execute as jest.Mock).mockResolvedValue({ result: "ok" });

      const result = await executeToolAction(mockEvent);

      expect(result.exitCode).toBe(0);
      expect(mockAction.execute).toHaveBeenCalled();
    });
  });

  describe("Execution Context", () => {
    it("should provide proper execution context to action", async () => {
      (mockAction.execute as jest.Mock).mockImplementation(
        async (credentials, params, context) => {
          // Test context methods
          context.logger.info("Test info");
          context.logger.warn("Test warning");
          context.logger.error("Test error");
          context.logger.debug("Test debug");

          context.variables.set("testKey", "testValue");
          context.variables.get("testKey");

          context.onProgress?.({ step: "Testing", percentage: 50 });
          context.onPartialResult?.({ partial: "result" });

          return { result: "context tested" };
        },
      );

      const consoleSpy = {
        log: jest.spyOn(console, "log").mockImplementation(),
        warn: jest.spyOn(console, "warn").mockImplementation(),
        error: jest.spyOn(console, "error").mockImplementation(),
        debug: jest.spyOn(console, "debug").mockImplementation(),
      };

      const result = await executeToolAction(mockEvent);

      expect(result.exitCode).toBe(0);

      // Verify logger calls
      expect(consoleSpy.log).toHaveBeenCalledWith("[INFO] Test info");
      expect(consoleSpy.warn).toHaveBeenCalledWith("[WARN] Test warning");
      expect(consoleSpy.error).toHaveBeenCalledWith("[ERROR] Test error");
      expect(consoleSpy.debug).toHaveBeenCalledWith("[DEBUG] Test debug");

      // Verify progress and partial result calls
      expect(consoleSpy.log).toHaveBeenCalledWith("[PROGRESS] Testing: 50%");
      expect(consoleSpy.log).toHaveBeenCalledWith(
        '[PARTIAL] {"partial":"result"}',
      );

      // Restore console
      Object.values(consoleSpy).forEach((spy) => spy.mockRestore());
    });

    it("should mark context as not test mode", async () => {
      let capturedContext: any;
      (mockAction.execute as jest.Mock).mockImplementation(
        async (credentials, params, context) => {
          capturedContext = context;
          return { result: "ok" };
        },
      );

      await executeToolAction(mockEvent);

      expect(capturedContext.isTest).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should handle action execution errors", async () => {
      const errorMessage = "Action execution failed";
      (mockAction.execute as jest.Mock).mockRejectedValue(
        new Error(errorMessage),
      );

      const result = await executeToolAction(mockEvent);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(errorMessage);
      expect(result.stdout).toBe("");
      expect(result.data).toBeNull();
    });

    it("should handle non-Error thrown values", async () => {
      (mockAction.execute as jest.Mock).mockRejectedValue("String error");

      const result = await executeToolAction(mockEvent);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("Unknown error");
    });

    it("should continue execution even if logging fails", async () => {
      const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
      const consoleLogSpy = jest
        .spyOn(console, "log")
        .mockImplementation(() => {
          throw new Error("Logging failed");
        });

      (mockAction.execute as jest.Mock).mockResolvedValue({ result: "ok" });

      const result = await executeToolAction(mockEvent);

      // Should still return success despite logging failure
      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to log tool action execution"),
      );

      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });
  });

  describe("Output Formatting", () => {
    it("should format output correctly", async () => {
      const actionResult = {
        result: "Test successful",
        processedCount: 10,
        metadata: { key: "value" },
      };

      (mockAction.execute as jest.Mock).mockResolvedValue(actionResult);

      const result = await executeToolAction(mockEvent);

      const output = JSON.parse(result.stdout);
      expect(output).toEqual({
        actionId: "test-action",
        actionName: "Test Action",
        executionTime: expect.any(Number),
        result: actionResult,
        parameters: { message: "Hello", count: 5 },
        timestamp: expect.any(String),
      });

      // Verify timestamp is valid ISO string
      expect(new Date(output.timestamp).toISOString()).toBe(output.timestamp);
    });

    it("should include data property in result", async () => {
      const actionResult = { result: "success", data: [1, 2, 3] };
      (mockAction.execute as jest.Mock).mockResolvedValue(actionResult);

      const result = await executeToolAction(mockEvent);

      expect(result.data).toEqual(actionResult);
    });
  });

  describe("Progress Tracking", () => {
    it("should track execution progress", async () => {
      const progressUpdates: any[] = [];
      const consoleSpy = jest
        .spyOn(console, "log")
        .mockImplementation((msg) => {
          if (msg.includes("[PROGRESS]")) {
            progressUpdates.push(msg);
          }
        });

      (mockAction.execute as jest.Mock).mockResolvedValue({ result: "ok" });

      await executeToolAction(mockEvent);

      expect(progressUpdates).toContain("[PROGRESS] Initializing action: 10%");
      expect(progressUpdates).toContain("[PROGRESS] Action completed: 100%");

      consoleSpy.mockRestore();
    });
  });

  describe("Execution Time", () => {
    it("should measure execution time accurately", async () => {
      const delay = 100;
      (mockAction.execute as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ result: "ok" }), delay),
          ),
      );

      const result = await executeToolAction(mockEvent);
      const output = JSON.parse(result.stdout);

      expect(output.executionTime).toBeGreaterThanOrEqual(delay);
      expect(output.executionTime).toBeLessThan(delay + 50); // Allow some margin
    });
  });

  describe("Tool Action Logging", () => {
    it("should log successful executions", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      (mockAction.execute as jest.Mock).mockResolvedValue({ result: "ok" });

      await executeToolAction(mockEvent);

      const logCalls = consoleSpy.mock.calls.map((call) => call[0]);
      const successLog = logCalls.find((log) =>
        log.includes("Tool Action Log:"),
      );

      expect(successLog).toBeDefined();
      expect(successLog).toContain('"status":"SUCCESS"');
      expect(successLog).toContain('"eventId":1');
      expect(successLog).toContain('"toolType":"SLACK"');
      expect(successLog).toContain('"actionType":"create"');

      consoleSpy.mockRestore();
    });

    it("should log failed executions", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      (mockAction.execute as jest.Mock).mockRejectedValue(
        new Error("Test error"),
      );

      await executeToolAction(mockEvent);

      const logCalls = consoleSpy.mock.calls.map((call) => call[0]);
      const errorLog = logCalls.find((log) =>
        log.includes("Tool Action Error Log:"),
      );

      expect(errorLog).toBeDefined();
      expect(errorLog).toContain('"status":"FAILURE"');
      expect(errorLog).toContain('"errorMessage":"Test error"');

      consoleSpy.mockRestore();
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle nested parameter structures", async () => {
      const complexParams = {
        message: "Hello",
        nested: {
          level1: {
            level2: "deep value",
          },
        },
        array: [1, 2, 3],
      };

      const eventWithComplexParams = {
        ...mockEvent,
        toolActionConfig: JSON.stringify({
          toolType: "SLACK",
          actionId: "test-action",
          toolId: 1,
          parameters: complexParams,
        }),
      };

      (mockAction.execute as jest.Mock).mockResolvedValue({ result: "ok" });

      const result = await executeToolAction(eventWithComplexParams);

      expect(result.exitCode).toBe(0);
      expect(mockAction.execute).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining(complexParams),
        expect.any(Object),
      );
    });

    it("should handle concurrent variable access", async () => {
      const variableOps: string[] = [];

      (mockAction.execute as jest.Mock).mockImplementation(
        async (credentials, params, context) => {
          // Simulate concurrent variable operations
          await Promise.all([
            Promise.resolve().then(() => {
              context.variables.set("var1", "value1");
              variableOps.push("set-var1");
            }),
            Promise.resolve().then(() => {
              context.variables.set("var2", "value2");
              variableOps.push("set-var2");
            }),
            Promise.resolve().then(() => {
              context.variables.get("var1");
              variableOps.push("get-var1");
            }),
          ]);

          return { result: "concurrent test" };
        },
      );

      const result = await executeToolAction(mockEvent);

      expect(result.exitCode).toBe(0);
      expect(variableOps).toHaveLength(3);
      expect(variableOps).toContain("set-var1");
      expect(variableOps).toContain("set-var2");
      expect(variableOps).toContain("get-var1");
    });
  });
});
