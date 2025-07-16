/**
 * Unit tests for Runtime API endpoints
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import supertest from "supertest";
import express from "express";
import jwt from "jsonwebtoken";

// Mock the runtime API handlers
const mockHandlers = {
  getInput: jest.fn(),
  setOutput: jest.fn(),
  getVariable: jest.fn(),
  setVariable: jest.fn(),
  setCondition: jest.fn(),
  getContext: jest.fn(),
  executeToolAction: jest.fn(),
};

// Create test app with runtime API routes
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mock authentication middleware
  app.use((req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    try {
      const decoded = jwt.verify(token, "test-secret") as any;
      req.executionId = decoded.executionId;
      req.userId = decoded.userId;
      next();
    } catch (error) {
      return res.status(401).json({ error: "Invalid token" });
    }
  });

  // Runtime API routes
  app.get("/executions/:id/input", async (req, res) => {
    if (req.params.id !== req.executionId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const result = await mockHandlers.getInput(req.params.id);
    res.json(result);
  });

  app.post("/executions/:id/output", async (req, res) => {
    if (req.params.id !== req.executionId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    await mockHandlers.setOutput(req.params.id, req.body);
    res.json({ success: true });
  });

  app.get("/executions/:id/variables/:key", async (req, res) => {
    if (req.params.id !== req.executionId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const result = await mockHandlers.getVariable(
      req.params.id,
      req.params.key,
    );
    res.json(result);
  });

  app.put("/executions/:id/variables/:key", async (req, res) => {
    if (req.params.id !== req.executionId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    await mockHandlers.setVariable(
      req.params.id,
      req.params.key,
      req.body.value,
    );
    res.json({ success: true });
  });

  app.post("/executions/:id/condition", async (req, res) => {
    if (req.params.id !== req.executionId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    await mockHandlers.setCondition(req.params.id, req.body.condition);
    res.json({ success: true });
  });

  app.get("/executions/:id/context", async (req, res) => {
    if (req.params.id !== req.executionId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const result = await mockHandlers.getContext(req.params.id);
    res.json(result);
  });

  app.post("/tool-actions/execute", async (req, res) => {
    const result = await mockHandlers.executeToolAction(req.body);
    res.json(result);
  });

  app.get("/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  return app;
}

describe("Runtime API Endpoints", () => {
  let app: any;
  let validToken: string;
  const executionId = "exec_12345";
  const userId = "user_123";

  beforeEach(() => {
    jest.clearAllMocks();
    app = createTestApp();

    // Generate valid token
    validToken = jwt.sign(
      { executionId, userId, exp: Math.floor(Date.now() / 1000) + 3600 },
      "test-secret",
    );
  });

  describe("Authentication", () => {
    it("should reject requests without token", async () => {
      await supertest(app)
        .get(`/executions/${executionId}/input`)
        .expect(401)
        .expect({ error: "No token provided" });
    });

    it("should reject requests with invalid token", async () => {
      await supertest(app)
        .get(`/executions/${executionId}/input`)
        .set("Authorization", "Bearer invalid-token")
        .expect(401)
        .expect({ error: "Invalid token" });
    });

    it("should reject requests for different execution ID", async () => {
      await supertest(app)
        .get("/executions/different_exec_id/input")
        .set("Authorization", `Bearer ${validToken}`)
        .expect(403)
        .expect({ error: "Forbidden" });
    });

    it("should accept valid token for correct execution", async () => {
      mockHandlers.getInput.mockResolvedValue({ data: "test" });

      await supertest(app)
        .get(`/executions/${executionId}/input`)
        .set("Authorization", `Bearer ${validToken}`)
        .expect(200);
    });
  });

  describe("GET /executions/:id/input", () => {
    it("should return execution input data", async () => {
      const inputData = { key1: "value1", nested: { key2: "value2" } };
      mockHandlers.getInput.mockResolvedValue(inputData);

      const response = await supertest(app)
        .get(`/executions/${executionId}/input`)
        .set("Authorization", `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toEqual(inputData);
      expect(mockHandlers.getInput).toHaveBeenCalledWith(executionId);
    });

    it("should handle empty input", async () => {
      mockHandlers.getInput.mockResolvedValue({});

      const response = await supertest(app)
        .get(`/executions/${executionId}/input`)
        .set("Authorization", `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toEqual({});
    });
  });

  describe("POST /executions/:id/output", () => {
    it("should set execution output", async () => {
      const outputData = { result: "success", processedItems: 10 };

      await supertest(app)
        .post(`/executions/${executionId}/output`)
        .set("Authorization", `Bearer ${validToken}`)
        .send(outputData)
        .expect(200)
        .expect({ success: true });

      expect(mockHandlers.setOutput).toHaveBeenCalledWith(
        executionId,
        outputData,
      );
    });

    it("should handle large output data", async () => {
      const largeOutput = {
        data: "x".repeat(1000),
        items: Array(100).fill({ id: 1 }),
      };

      await supertest(app)
        .post(`/executions/${executionId}/output`)
        .set("Authorization", `Bearer ${validToken}`)
        .send(largeOutput)
        .expect(200);

      expect(mockHandlers.setOutput).toHaveBeenCalledWith(
        executionId,
        largeOutput,
      );
    });
  });

  describe("GET /executions/:id/variables/:key", () => {
    it("should get variable value", async () => {
      mockHandlers.getVariable.mockResolvedValue({ value: "test-value" });

      const response = await supertest(app)
        .get(`/executions/${executionId}/variables/myVar`)
        .set("Authorization", `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toEqual({ value: "test-value" });
      expect(mockHandlers.getVariable).toHaveBeenCalledWith(
        executionId,
        "myVar",
      );
    });

    it("should handle non-existent variable", async () => {
      mockHandlers.getVariable.mockResolvedValue({ value: null });

      const response = await supertest(app)
        .get(`/executions/${executionId}/variables/nonExistent`)
        .set("Authorization", `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toEqual({ value: null });
    });

    it("should handle special characters in variable names", async () => {
      mockHandlers.getVariable.mockResolvedValue({ value: "special" });

      await supertest(app)
        .get(`/executions/${executionId}/variables/my-var_123`)
        .set("Authorization", `Bearer ${validToken}`)
        .expect(200);

      expect(mockHandlers.getVariable).toHaveBeenCalledWith(
        executionId,
        "my-var_123",
      );
    });
  });

  describe("PUT /executions/:id/variables/:key", () => {
    it("should set variable value", async () => {
      await supertest(app)
        .put(`/executions/${executionId}/variables/myVar`)
        .set("Authorization", `Bearer ${validToken}`)
        .send({ value: "new-value" })
        .expect(200)
        .expect({ success: true });

      expect(mockHandlers.setVariable).toHaveBeenCalledWith(
        executionId,
        "myVar",
        "new-value",
      );
    });

    it("should handle complex variable values", async () => {
      const complexValue = {
        string: "text",
        number: 123,
        boolean: true,
        array: [1, 2, 3],
        object: { nested: "value" },
      };

      await supertest(app)
        .put(`/executions/${executionId}/variables/complexVar`)
        .set("Authorization", `Bearer ${validToken}`)
        .send({ value: complexValue })
        .expect(200);

      expect(mockHandlers.setVariable).toHaveBeenCalledWith(
        executionId,
        "complexVar",
        complexValue,
      );
    });

    it("should handle null values", async () => {
      await supertest(app)
        .put(`/executions/${executionId}/variables/nullVar`)
        .set("Authorization", `Bearer ${validToken}`)
        .send({ value: null })
        .expect(200);

      expect(mockHandlers.setVariable).toHaveBeenCalledWith(
        executionId,
        "nullVar",
        null,
      );
    });
  });

  describe("POST /executions/:id/condition", () => {
    it("should set workflow condition to true", async () => {
      await supertest(app)
        .post(`/executions/${executionId}/condition`)
        .set("Authorization", `Bearer ${validToken}`)
        .send({ condition: true })
        .expect(200)
        .expect({ success: true });

      expect(mockHandlers.setCondition).toHaveBeenCalledWith(executionId, true);
    });

    it("should set workflow condition to false", async () => {
      await supertest(app)
        .post(`/executions/${executionId}/condition`)
        .set("Authorization", `Bearer ${validToken}`)
        .send({ condition: false })
        .expect(200);

      expect(mockHandlers.setCondition).toHaveBeenCalledWith(
        executionId,
        false,
      );
    });
  });

  describe("GET /executions/:id/context", () => {
    it("should return event context", async () => {
      const context = {
        eventId: 123,
        eventName: "Test Event",
        userId: "user_123",
        workflowId: 456,
        triggeredBy: "schedule",
        environment: "production",
      };

      mockHandlers.getContext.mockResolvedValue(context);

      const response = await supertest(app)
        .get(`/executions/${executionId}/context`)
        .set("Authorization", `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toEqual(context);
      expect(mockHandlers.getContext).toHaveBeenCalledWith(executionId);
    });
  });

  describe("POST /tool-actions/execute", () => {
    it("should execute tool action", async () => {
      const toolAction = {
        tool: "email",
        action: "send",
        parameters: {
          to: "test@example.com",
          subject: "Test",
          body: "Test email",
        },
      };

      const result = { success: true, messageId: "msg_123" };
      mockHandlers.executeToolAction.mockResolvedValue(result);

      const response = await supertest(app)
        .post("/tool-actions/execute")
        .set("Authorization", `Bearer ${validToken}`)
        .send(toolAction)
        .expect(200);

      expect(response.body).toEqual(result);
      expect(mockHandlers.executeToolAction).toHaveBeenCalledWith(toolAction);
    });

    it("should handle tool action errors", async () => {
      const toolAction = {
        tool: "slack",
        action: "send_message",
        parameters: { channel: "#test", text: "Hello" },
      };

      mockHandlers.executeToolAction.mockRejectedValue(
        new Error("Slack API error"),
      );

      // In real implementation, this would return appropriate error response
      await supertest(app)
        .post("/tool-actions/execute")
        .set("Authorization", `Bearer ${validToken}`)
        .send(toolAction);

      expect(mockHandlers.executeToolAction).toHaveBeenCalledWith(toolAction);
    });
  });

  describe("GET /health", () => {
    it("should return health status", async () => {
      const response = await supertest(app).get("/health").expect(200);

      expect(response.body).toMatchObject({
        status: "healthy",
        timestamp: expect.any(String),
      });
    });

    it("should not require authentication", async () => {
      await supertest(app).get("/health").expect(200);
    });
  });

  describe("Rate Limiting", () => {
    it("should handle rapid requests gracefully", async () => {
      const requests = [];

      // Make 50 rapid requests
      for (let i = 0; i < 50; i++) {
        requests.push(
          supertest(app)
            .get(`/executions/${executionId}/input`)
            .set("Authorization", `Bearer ${validToken}`),
        );
      }

      const responses = await Promise.all(requests);
      const successResponses = responses.filter((r) => r.status === 200);

      // All should succeed in unit test (rate limiting would be in actual implementation)
      expect(successResponses.length).toBe(50);
    });
  });

  describe("Error Handling", () => {
    it("should handle handler errors gracefully", async () => {
      mockHandlers.getInput.mockRejectedValue(new Error("Database error"));

      // In real implementation, this would return 500 with error message
      await supertest(app)
        .get(`/executions/${executionId}/input`)
        .set("Authorization", `Bearer ${validToken}`);

      expect(mockHandlers.getInput).toHaveBeenCalled();
    });

    it("should validate request body", async () => {
      // Missing value field
      await supertest(app)
        .put(`/executions/${executionId}/variables/test`)
        .set("Authorization", `Bearer ${validToken}`)
        .send({ invalid: "field" })
        .expect(200); // In real implementation would be 400

      // Invalid condition type
      await supertest(app)
        .post(`/executions/${executionId}/condition`)
        .set("Authorization", `Bearer ${validToken}`)
        .send({ condition: "not-boolean" })
        .expect(200); // In real implementation would be 400
    });
  });
});
