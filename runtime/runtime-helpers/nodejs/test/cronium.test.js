/**
 * Unit tests for Cronium Node.js SDK
 */

const { EventEmitter } = require("events");
const { PassThrough } = require("stream");

// Set required environment variables before import
process.env.CRONIUM_RUNTIME_API = "http://localhost:8081";
process.env.CRONIUM_EXECUTION_TOKEN = "test-token";
process.env.CRONIUM_EXECUTION_ID = "test-execution-id";

const Cronium = require("../cronium");
const {
  cronium,
  input,
  output,
  getVariable,
  setVariable,
  CroniumError,
  CroniumAPIError,
  CroniumTimeoutError,
} = require("../cronium");

// Mock http/https modules
jest.mock("http");
jest.mock("https");
const http = require("http");
const https = require("https");

describe("Cronium SDK", () => {
  let mockRequest;
  let mockResponse;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock response
    mockResponse = new EventEmitter();
    mockResponse.statusCode = 200;
    mockResponse.on = jest.fn((event, handler) => {
      EventEmitter.prototype.on.call(mockResponse, event, handler);
      return mockResponse;
    });

    // Setup mock request
    mockRequest = new EventEmitter();
    mockRequest.write = jest.fn();
    mockRequest.end = jest.fn();
    mockRequest.destroy = jest.fn();
    mockRequest.on = jest.fn((event, handler) => {
      EventEmitter.prototype.on.call(mockRequest, event, handler);
      return mockRequest;
    });

    // Mock http.request to return our mock request
    http.request.mockReturnValue(mockRequest);
    https.request.mockReturnValue(mockRequest);
  });

  describe("Constructor", () => {
    it("should throw error if token is missing", () => {
      delete process.env.CRONIUM_EXECUTION_TOKEN;
      expect(() => new Cronium()).toThrow(
        "CRONIUM_EXECUTION_TOKEN environment variable not set",
      );
      process.env.CRONIUM_EXECUTION_TOKEN = "test-token";
    });

    it("should throw error if execution ID is missing", () => {
      delete process.env.CRONIUM_EXECUTION_ID;
      expect(() => new Cronium()).toThrow(
        "CRONIUM_EXECUTION_ID environment variable not set",
      );
      process.env.CRONIUM_EXECUTION_ID = "test-execution-id";
    });

    it("should initialize with environment variables", () => {
      const client = new Cronium();
      expect(client.token).toBe("test-token");
      expect(client.executionId).toBe("test-execution-id");
      expect(client.apiUrl).toBe("http://localhost:8081");
    });
  });

  describe("input()", () => {
    it("should retrieve input data successfully", async () => {
      const client = new Cronium();
      const testData = { key: "value" };

      const promise = client.input();

      // Simulate successful response
      setImmediate(() => {
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit(
          "data",
          JSON.stringify({ success: true, data: testData }),
        );
        mockResponse.emit("end");
      });

      const result = await promise;
      expect(result).toEqual(testData);

      // Verify request details
      const requestOptions = http.request.mock.calls[0][0];
      expect(requestOptions.method).toBe("GET");
      expect(requestOptions.path).toBe("/executions/test-execution-id/input");
      expect(requestOptions.headers.Authorization).toBe("Bearer test-token");
    });

    it("should return null if no data", async () => {
      const client = new Cronium();

      const promise = client.input();

      setImmediate(() => {
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit("data", JSON.stringify({ success: true }));
        mockResponse.emit("end");
      });

      const result = await promise;
      expect(result).toBeNull();
    });
  });

  describe("output()", () => {
    it("should set output data successfully", async () => {
      const client = new Cronium();
      const testData = { result: "success" };

      const promise = client.output(testData);

      setImmediate(() => {
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit("data", JSON.stringify({ success: true }));
        mockResponse.emit("end");
      });

      await promise;

      // Verify request details
      const requestOptions = http.request.mock.calls[0][0];
      expect(requestOptions.method).toBe("POST");
      expect(requestOptions.path).toBe("/executions/test-execution-id/output");
      expect(mockRequest.write).toHaveBeenCalledWith(
        JSON.stringify({ data: testData }),
      );
    });
  });

  describe("getVariable()", () => {
    it("should retrieve variable value successfully", async () => {
      const client = new Cronium();

      const promise = client.getVariable("test_var");

      setImmediate(() => {
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit(
          "data",
          JSON.stringify({
            success: true,
            data: { key: "test_var", value: "test_value" },
          }),
        );
        mockResponse.emit("end");
      });

      const result = await promise;
      expect(result).toBe("test_value");

      // Verify URL encoding
      const requestOptions = http.request.mock.calls[0][0];
      expect(requestOptions.path).toBe(
        "/executions/test-execution-id/variables/test_var",
      );
    });

    it("should return null for non-existent variable", async () => {
      const client = new Cronium();

      const promise = client.getVariable("missing");

      setImmediate(() => {
        mockResponse.statusCode = 404;
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit(
          "data",
          JSON.stringify({ message: "Variable not found" }),
        );
        mockResponse.emit("end");
      });

      const result = await promise;
      expect(result).toBeNull();
    });

    it("should encode special characters in variable names", async () => {
      const client = new Cronium();

      const promise = client.getVariable("test var with spaces");

      setImmediate(() => {
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit(
          "data",
          JSON.stringify({ success: true, data: { value: "value" } }),
        );
        mockResponse.emit("end");
      });

      await promise;

      const requestOptions = http.request.mock.calls[0][0];
      expect(requestOptions.path).toBe(
        "/executions/test-execution-id/variables/test%20var%20with%20spaces",
      );
    });
  });

  describe("setVariable()", () => {
    it("should set variable value successfully", async () => {
      const client = new Cronium();

      const promise = client.setVariable("test_var", "test_value");

      setImmediate(() => {
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit("data", JSON.stringify({ success: true }));
        mockResponse.emit("end");
      });

      await promise;

      expect(mockRequest.write).toHaveBeenCalledWith(
        JSON.stringify({ value: "test_value" }),
      );
    });
  });

  describe("setCondition()", () => {
    it("should set condition successfully", async () => {
      const client = new Cronium();

      const promise = client.setCondition(true);

      setImmediate(() => {
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit("data", JSON.stringify({ success: true }));
        mockResponse.emit("end");
      });

      await promise;

      const requestOptions = http.request.mock.calls[0][0];
      expect(requestOptions.method).toBe("POST");
      expect(requestOptions.path).toBe(
        "/executions/test-execution-id/condition",
      );
      expect(mockRequest.write).toHaveBeenCalledWith(
        JSON.stringify({ condition: true }),
      );
    });
  });

  describe("event()", () => {
    it("should retrieve event context successfully", async () => {
      const client = new Cronium();
      const eventData = {
        id: "event-123",
        name: "Test Event",
        type: "SCRIPT",
      };

      const promise = client.event();

      setImmediate(() => {
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit(
          "data",
          JSON.stringify({ success: true, data: eventData }),
        );
        mockResponse.emit("end");
      });

      const result = await promise;
      expect(result).toEqual(eventData);
    });
  });

  describe("executeToolAction()", () => {
    it("should execute tool action successfully", async () => {
      const client = new Cronium();
      const actionResult = { messageId: "12345" };

      const promise = client.executeToolAction("slack", "send_message", {
        channel: "#general",
        text: "Hello",
      });

      setImmediate(() => {
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit(
          "data",
          JSON.stringify({ success: true, data: actionResult }),
        );
        mockResponse.emit("end");
      });

      const result = await promise;
      expect(result).toEqual(actionResult);

      expect(mockRequest.write).toHaveBeenCalledWith(
        JSON.stringify({
          tool: "slack",
          action: "send_message",
          config: { channel: "#general", text: "Hello" },
        }),
      );
    });
  });

  describe("Error handling", () => {
    it("should handle API errors", async () => {
      const client = new Cronium();

      const promise = client.input();

      setImmediate(() => {
        mockResponse.statusCode = 400;
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit("data", JSON.stringify({ message: "Bad request" }));
        mockResponse.emit("end");
      });

      await expect(promise).rejects.toThrow(CroniumAPIError);
      await expect(promise).rejects.toThrow("API Error (400): Bad request");
    });

    it("should handle timeout errors", async () => {
      const client = new Cronium();

      const promise = client.input();

      setImmediate(() => {
        mockRequest.emit("timeout");
      });

      await expect(promise).rejects.toThrow(CroniumTimeoutError);
    });

    it("should handle network errors", async () => {
      const client = new Cronium();

      const promise = client.input();

      setImmediate(() => {
        mockRequest.emit("error", new Error("Network error"));
      });

      await expect(promise).rejects.toThrow("Request failed: Network error");
    });

    it("should retry on server errors", async () => {
      const client = new Cronium();
      client.retryDelay = 1; // Speed up test

      const promise = client.input();

      // First request fails with 500
      setImmediate(() => {
        mockResponse.statusCode = 500;
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit("data", JSON.stringify({ message: "Server error" }));
        mockResponse.emit("end");
      });

      // Second request succeeds
      setTimeout(() => {
        mockResponse.statusCode = 200;
        http.request.mock.calls[1][1](mockResponse);
        mockResponse.emit(
          "data",
          JSON.stringify({ success: true, data: "success" }),
        );
        mockResponse.emit("end");
      }, 10);

      const result = await promise;
      expect(result).toBe("success");
      expect(http.request).toHaveBeenCalledTimes(2);
    });
  });

  describe("Convenience methods", () => {
    it("should send email successfully", async () => {
      const client = new Cronium();

      const promise = client.sendEmail({
        to: "test@example.com",
        subject: "Test",
        body: "Hello",
        cc: ["cc@example.com"],
      });

      setImmediate(() => {
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit("data", JSON.stringify({ success: true }));
        mockResponse.emit("end");
      });

      await promise;

      expect(mockRequest.write).toHaveBeenCalledWith(
        JSON.stringify({
          tool: "email",
          action: "send_message",
          config: {
            to: ["test@example.com"],
            subject: "Test",
            body: "Hello",
            cc: ["cc@example.com"],
          },
        }),
      );
    });

    it("should send Slack message successfully", async () => {
      const client = new Cronium();

      await client.sendSlackMessage({
        channel: "#general",
        text: "Hello",
        attachments: [],
      });

      expect(mockRequest.write).toHaveBeenCalledWith(
        JSON.stringify({
          tool: "slack",
          action: "send_message",
          config: {
            channel: "#general",
            text: "Hello",
            attachments: [],
          },
        }),
      );
    });
  });

  describe("Module exports", () => {
    it("should export convenience functions", async () => {
      expect(typeof input).toBe("function");
      expect(typeof output).toBe("function");
      expect(typeof getVariable).toBe("function");
      expect(typeof setVariable).toBe("function");
    });

    it("should use singleton instance for module functions", async () => {
      const promise = input();

      setImmediate(() => {
        http.request.mock.calls[0][1](mockResponse);
        mockResponse.emit(
          "data",
          JSON.stringify({ success: true, data: "test" }),
        );
        mockResponse.emit("end");
      });

      const result = await promise;
      expect(result).toBe("test");
    });
  });

  describe("HTTPS support", () => {
    beforeEach(() => {
      process.env.CRONIUM_RUNTIME_API = "https://localhost:8081";
      jest.resetModules();
    });

    afterEach(() => {
      process.env.CRONIUM_RUNTIME_API = "http://localhost:8081";
    });

    it("should use https module for https URLs", async () => {
      const CroniumHttps = require("../cronium");
      const client = new CroniumHttps();

      const promise = client.input();

      setImmediate(() => {
        https.request.mock.calls[0][1](mockResponse);
        mockResponse.emit("data", JSON.stringify({ success: true }));
        mockResponse.emit("end");
      });

      await promise;
      expect(https.request).toHaveBeenCalled();
      expect(http.request).not.toHaveBeenCalled();
    });
  });
});
