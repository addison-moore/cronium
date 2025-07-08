import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { sendMessageAction } from "@/components/tools/plugins/slack/actions/send-message";
import type {
  ExecutionContext,
  VariableManager,
  Logger,
} from "@/components/tools/types/tool-plugin";

// Mock fetch globally
global.fetch = jest.fn();

describe("Slack Actions", () => {
  let mockContext: ExecutionContext;
  let mockVariables: VariableManager;
  let mockLogger: Logger;
  let mockOnProgress: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock variables
    mockVariables = {
      get: jest.fn((key: string) => {
        const vars: Record<string, unknown> = {
          userName: "John Doe",
          alertLevel: "high",
          serverName: "prod-01",
        };
        return vars[key];
      }),
      set: jest.fn(),
    };

    // Setup mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    // Setup mock progress callback
    mockOnProgress = jest.fn();

    // Setup execution context
    mockContext = {
      variables: mockVariables,
      logger: mockLogger,
      onProgress: mockOnProgress,
      isTest: false,
    };
  });

  describe("sendMessageAction", () => {
    const mockCredentials = {
      webhookUrl: "https://hooks.slack.com/services/TEST/WEBHOOK/URL",
    };

    it("should send a simple message successfully", async () => {
      // Mock successful response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => "ok",
      });

      const params = {
        channel: "#general",
        text: "Hello from Cronium!",
      };

      const result = await sendMessageAction.execute(
        mockCredentials,
        params,
        mockContext,
      );

      expect(result).toEqual({
        ok: true,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        mockCredentials.webhookUrl,
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "Hello from Cronium!",
            channel: "#general",
          }),
        }),
      );

      expect(mockOnProgress).toHaveBeenCalledWith({
        step: "Message sent successfully!",
        percentage: 100,
      });
    });

    it("should replace variables in message text", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => "ok",
      });

      const params = {
        text: "Alert: {{alertLevel}} on server {{serverName}}",
      };

      await sendMessageAction.execute(mockCredentials, params, mockContext);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            text: "Alert: high on server prod-01",
          }),
        }),
      );
    });

    it("should handle blocks with variable replacement", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => "ok",
      });

      const params = {
        text: "System Alert",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Server *{{serverName}}* is experiencing issues",
            },
            fields: [
              {
                type: "mrkdwn",
                text: "*User:* {{userName}}",
              },
            ],
          },
        ],
      };

      await sendMessageAction.execute(mockCredentials, params, mockContext);

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.blocks[0].text.text).toBe(
        "Server *prod-01* is experiencing issues",
      );
      expect(body.blocks[0].fields[0].text).toBe("*User:* John Doe");
    });

    it("should handle webhook errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "no_channel",
      });

      const params = {
        text: "Test message",
      };

      const result = await sendMessageAction.execute(
        mockCredentials,
        params,
        mockContext,
      );

      expect(result).toEqual({
        ok: false,
        error: "Slack API error: 404 no_channel",
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Slack send error"),
      );
    });

    it("should handle missing webhook URL", async () => {
      const result = await sendMessageAction.execute(
        {},
        { text: "Test" },
        mockContext,
      );

      expect(result).toEqual({
        ok: false,
        error: "Webhook URL not found in credentials",
      });
    });

    it("should validate input schema", () => {
      const validInput = {
        text: "Hello",
        channel: "#general",
        username: "Bot",
        icon_emoji: ":robot:",
      };

      const parseResult = sendMessageAction.inputSchema.safeParse(validInput);
      expect(parseResult.success).toBe(true);

      const invalidInput = {
        // Missing required 'text' field
        channel: "#general",
      };

      const invalidResult =
        sendMessageAction.inputSchema.safeParse(invalidInput);
      expect(invalidResult.success).toBe(false);
    });

    it("should track progress correctly", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => "ok",
      });

      await sendMessageAction.execute(
        mockCredentials,
        { text: "Test" },
        mockContext,
      );

      expect(mockOnProgress).toHaveBeenCalledTimes(5);
      expect(mockOnProgress).toHaveBeenNthCalledWith(1, {
        step: "Preparing Slack message...",
        percentage: 10,
      });
      expect(mockOnProgress).toHaveBeenNthCalledWith(2, {
        step: "Building message payload...",
        percentage: 30,
      });
      expect(mockOnProgress).toHaveBeenNthCalledWith(3, {
        step: "Sending message to Slack...",
        percentage: 60,
      });
      expect(mockOnProgress).toHaveBeenNthCalledWith(4, {
        step: "Processing response...",
        percentage: 90,
      });
      expect(mockOnProgress).toHaveBeenNthCalledWith(5, {
        step: "Message sent successfully!",
        percentage: 100,
      });
    });
  });

  describe("Variable Replacement", () => {
    it("should handle undefined variables gracefully", async () => {
      mockVariables.get = jest.fn().mockReturnValue(undefined);

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => "ok",
      });

      const params = {
        text: "User: {{unknownVar}} - Status: Active",
      };

      await sendMessageAction.execute(
        { webhookUrl: "https://hooks.slack.com/test" },
        params,
        mockContext,
      );

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.text).toBe("User: {{unknownVar}} - Status: Active");
    });

    it("should handle object variables by JSON stringifying", async () => {
      mockVariables.get = jest.fn().mockReturnValue({
        status: "active",
        count: 42,
      });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => "ok",
      });

      const params = {
        text: "{{objectVar}}",
      };

      await sendMessageAction.execute(
        { webhookUrl: "https://hooks.slack.com/test" },
        params,
        mockContext,
      );

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.text).toBe("[object Object]");
    });
  });
});
