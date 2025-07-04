import axios from "axios";
import { config } from "dotenv";
config({ path: `.env.local` });

const API_BASE_URL = "http://localhost:5000/api";
const API_TOKEN = "test_workflow_api_token_12345";

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

describe("Cronium API Complete Test Suite", () => {
  let bashEventId: number;
  let pythonEventId: number;
  let nodejsEventId: number;
  let httpEventId: number;
  let workflowId: number;

  beforeAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    // Clean up any remaining resources that weren't deleted in the deletion tests
    // Only attempt deletion if the ID is still set (not reset to 0 by deletion tests)
    const cleanup = [
      workflowId &&
        apiClient.delete(`/workflows/${workflowId}`).catch(() => {}),
      httpEventId && apiClient.delete(`/events/${httpEventId}`).catch(() => {}),
      nodejsEventId &&
        apiClient.delete(`/events/${nodejsEventId}`).catch(() => {}),
      pythonEventId &&
        apiClient.delete(`/events/${pythonEventId}`).catch(() => {}),
      bashEventId && apiClient.delete(`/events/${bashEventId}`).catch(() => {}),
    ].filter(Boolean);

    if (cleanup.length > 0) {
      console.log(`Cleaning up ${cleanup.length} remaining test resources...`);
      await Promise.allSettled(cleanup);
    }
  });

  describe("Authentication Tests", () => {
    test("should reject unauthorized requests", async () => {
      const unauthorizedClient = axios.create({
        baseURL: API_BASE_URL,
        headers: { "Content-Type": "application/json" },
      });

      await expect(unauthorizedClient.get("/events")).rejects.toMatchObject({
        response: { status: 401 },
      });
    });

    test("should reject invalid tokens", async () => {
      const invalidClient = axios.create({
        baseURL: API_BASE_URL,
        headers: {
          Authorization: "Bearer invalid_token",
          "Content-Type": "application/json",
        },
      });

      await expect(invalidClient.get("/events")).rejects.toMatchObject({
        response: { status: 401 },
      });
    });

    test("should accept valid API token", async () => {
      const response = await apiClient.get("/events");
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
    });
  });

  describe("Event CRUD Operations", () => {
    test("should create a Bash event with input/output support", async () => {
      const bashEvent = {
        name: "Final Test Bash Event",
        description: "Bash event for final API testing",
        type: "BASH",
        content: `#!/bin/bash
source ./cronium.sh

echo "Bash event starting..."
input_data=$(cronium_input)
echo "Received input: $input_data"

user_id=$(echo "$input_data" | jq -r '.user_id // "unknown"')
echo "Processing for user: $user_id"

output_data='{
  "success": true,
  "stage": "bash_processed",
  "user_id": "'$user_id'",
  "count": 10,
  "message": "Processed by Bash"
}'

cronium_output "$output_data"
echo "Bash event completed"`,
        status: "ACTIVE",
        scheduleUnit: "DAYS",
        runLocation: "LOCAL",
        timeoutValue: 30,
        timeoutUnit: "SECONDS",
        retries: 3,
      };

      const response = await apiClient.post("/events", bashEvent);
      expect(response.status).toBe(201);
      expect(response.data.name).toBe(bashEvent.name);
      expect(response.data.type).toBe("BASH");

      bashEventId = response.data.id;
    });

    test("should create a Python event with input/output support", async () => {
      const pythonEvent = {
        name: "Final Test Python Event",
        description: "Python event for final API testing",
        type: "PYTHON",
        content: `import cronium
import json

print("Python event starting...")
input_data = cronium.input()
print(f"Received input: {input_data}")

input_data = input_data or {}
user_id = input_data.get('user_id', 'unknown')
previous_count = input_data.get('count', 0)

new_count = previous_count + 25
output_data = {
    "success": True,
    "stage": "python_processed",
    "user_id": user_id,
    "count": new_count,
    "message": "Enhanced by Python"
}

cronium.output(output_data)
print("Python event completed")`,
        status: "ACTIVE",
        scheduleUnit: "DAYS",
        runLocation: "LOCAL",
        timeoutValue: 30,
        timeoutUnit: "SECONDS",
        retries: 3,
      };

      const response = await apiClient.post("/events", pythonEvent);
      expect(response.status).toBe(201);
      expect(response.data.name).toBe(pythonEvent.name);
      expect(response.data.type).toBe("PYTHON");

      pythonEventId = response.data.id;
    });

    test("should create a Node.js event with input/output support", async () => {
      const nodejsEvent = {
        name: "Final Test Node.js Event",
        description: "Node.js event for final API testing",
        type: "NODEJS",
        content: `const cronium = require('./cronium.js');

console.log('Node.js event starting...');
const inputData = cronium.input();
console.log('Received input:', JSON.stringify(inputData, null, 2));

const userId = inputData.user_id || 'unknown';
const previousCount = inputData.count || 0;

const finalCount = previousCount + 15;
const outputData = {
  success: true,
  stage: 'nodejs_finalized',
  user_id: userId,
  count: finalCount,
  message: 'Finalized by Node.js'
};

cronium.output(outputData);
console.log('Node.js event completed');`,
        status: "ACTIVE",
        scheduleUnit: "DAYS",
        runLocation: "LOCAL",
        timeoutValue: 30,
        timeoutUnit: "SECONDS",
        retries: 3,
      };

      const response = await apiClient.post("/events", nodejsEvent);
      expect(response.status).toBe(201);
      expect(response.data.name).toBe(nodejsEvent.name);
      expect(response.data.type).toBe("NODEJS");

      nodejsEventId = response.data.id;
    });

    test("should create an HTTP request event", async () => {
      const httpEvent = {
        name: "Final Test HTTP Event",
        description: "HTTP event for final API testing",
        type: "HTTP_REQUEST",
        httpMethod: "POST",
        httpUrl: "https://jsonplaceholder.typicode.com/posts",
        httpHeaders: [{ key: "Content-Type", value: "application/json" }],
        httpBody: JSON.stringify({
          title: "Final API Test",
          body: "Testing HTTP event creation",
          userId: 1,
        }),
        status: "ACTIVE",
        scheduleUnit: "DAYS",
        runLocation: "LOCAL",
        timeoutValue: 30,
        timeoutUnit: "SECONDS",
        retries: 3,
      };

      const response = await apiClient.post("/events", httpEvent);
      expect(response.status).toBe(201);
      expect(response.data.name).toBe(httpEvent.name);
      expect(response.data.type).toBe("HTTP_REQUEST");

      httpEventId = response.data.id;
    });

    test("should update an event", async () => {
      const updateData = {
        name: "Updated Final Test Bash Event",
        description: "Updated description for comprehensive testing",
        timeoutValue: 45,
      };

      const response = await apiClient.patch(
        `/events/${bashEventId}`,
        updateData,
      );
      expect(response.status).toBe(200);
      expect(response.data.name).toBe(updateData.name);
      expect(response.data.timeoutValue).toBe(updateData.timeoutValue);
    });

    test("should read an event", async () => {
      const response = await apiClient.get(`/events/${bashEventId}`);
      expect(response.status).toBe(200);
      expect(response.data.id).toBe(bashEventId);
      expect(response.data.name).toBe("Updated Final Test Bash Event");
    });

    test("should execute an event with input", async () => {
      // Ensure we have a valid event ID
      expect(bashEventId).toBeDefined();
      expect(bashEventId).toBeGreaterThan(0);

      const inputData = {
        input: {
          user_id: "final_test_user",
          data: "comprehensive_test_data",
          timestamp: new Date().toISOString(),
        },
      };

      const response = await apiClient.post(
        `/events/${bashEventId}/execute`,
        inputData,
      );
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.eventId).toBe(bashEventId);
      expect(response.data.executionId).toBeDefined();
    });
  });

  describe("Workflow CRUD Operations", () => {
    test("should create a workflow with chained events", async () => {
      const workflow = {
        name: "Final API Test Workflow",
        description: "Complete workflow for final API testing",
        triggerType: "MANUAL",
        runLocation: "LOCAL",
        nodes: [
          {
            id: "bash_node",
            eventId: bashEventId,
            position: { x: 100, y: 100 },
          },
          {
            id: "python_node",
            eventId: pythonEventId,
            position: { x: 300, y: 100 },
          },
          {
            id: "nodejs_node",
            eventId: nodejsEventId,
            position: { x: 500, y: 100 },
          },
        ],
        edges: [
          {
            id: "bash_to_python",
            source: "bash_node",
            target: "python_node",
          },
          {
            id: "python_to_nodejs",
            source: "python_node",
            target: "nodejs_node",
          },
        ],
      };

      const response = await apiClient.post("/workflows", workflow);
      expect(response.status).toBe(200);
      expect(response.data.name).toBe(workflow.name);

      workflowId = response.data.id;
    });

    test("should execute a workflow with input", async () => {
      const workflowInput = {
        input: {
          user_id: "final_workflow_test_user",
          data: "workflow_test_data",
          timestamp: new Date().toISOString(),
        },
      };

      const response = await apiClient.post(
        `/workflows/${workflowId}/execute`,
        workflowInput,
      );
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.workflowId).toBe(workflowId);
    });

    test("should update a workflow", async () => {
      const updateData = {
        name: "Updated Final API Test Workflow",
        description: "Updated workflow description",
        status: "ACTIVE",
      };

      const response = await apiClient.patch(
        `/workflows/${workflowId}`,
        updateData,
      );
      expect(response.status).toBe(200);
      expect(response.data.name).toBe(updateData.name);
    });

    test("should read a workflow", async () => {
      const response = await apiClient.get(`/workflows/${workflowId}`);
      expect(response.status).toBe(200);
      expect(response.data.workflow.id).toBe(workflowId);
      expect(response.data.nodes).toHaveLength(3);
      expect(response.data.edges).toHaveLength(2);
    });
  });

  describe("List Operations", () => {
    test("should list all events", async () => {
      const response = await apiClient.get("/events");
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBeGreaterThan(0);
    });

    test("should list all workflows", async () => {
      const response = await apiClient.get("/workflows");
      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBeGreaterThan(0);
    });
  });

  describe("Data Integrity", () => {
    test("should maintain data consistency across operations", async () => {
      // Verify created events still exist
      const eventResponse = await apiClient.get(`/events/${bashEventId}`);
      expect(eventResponse.status).toBe(200);
      expect(eventResponse.data.name).toBe("Updated Final Test Bash Event");

      // Verify created workflow still exists
      const workflowResponse = await apiClient.get(`/workflows/${workflowId}`);
      expect(workflowResponse.status).toBe(200);
      expect(workflowResponse.data.workflow.name).toBe(
        "Updated Final API Test Workflow",
      );
    });
  });

  describe("Deletion Tests", () => {
    test("should delete events successfully", async () => {
      // Skip if no httpEventId is available (test run order dependency)
      if (!httpEventId) {
        console.log("Skipping event deletion test - no event ID available");
        return;
      }

      // Test individual event deletion
      const response = await apiClient.delete(`/events/${httpEventId}`);
      expect(response.status).toBe(204);

      // Verify event was deleted by trying to fetch it
      await expect(
        apiClient.get(`/events/${httpEventId}`),
      ).rejects.toMatchObject({ response: { status: 404 } });

      // Reset the ID to prevent afterAll cleanup from failing
      httpEventId = 0;
    });

    test("should delete workflow successfully", async () => {
      // Skip if no workflowId is available (test run order dependency)
      if (!workflowId) {
        console.log(
          "Skipping workflow deletion test - no workflow ID available",
        );
        return;
      }

      // Test workflow deletion
      const response = await apiClient.delete(`/workflows/${workflowId}`);
      expect(response.status).toBe(200);

      // Verify workflow was deleted by trying to fetch it
      await expect(
        apiClient.get(`/workflows/${workflowId}`),
      ).rejects.toMatchObject({ response: { status: 404 } });

      // Reset the ID to prevent afterAll cleanup from failing
      workflowId = 0;
    });

    test("should handle deletion of non-existent resources gracefully", async () => {
      // Test deleting non-existent event
      await expect(apiClient.delete("/events/99999")).rejects.toMatchObject({
        response: { status: 404 },
      });

      // Test deleting non-existent workflow
      await expect(apiClient.delete("/workflows/99999")).rejects.toMatchObject({
        response: { status: 404 },
      });
    });

    test("should delete remaining test events in cleanup", async () => {
      // Delete remaining events one by one to test individual deletion
      const eventsToDelete = [
        { id: bashEventId, name: "Bash Event" },
        { id: pythonEventId, name: "Python Event" },
        { id: nodejsEventId, name: "Node.js Event" },
      ].filter((event) => event.id > 0);

      for (const event of eventsToDelete) {
        const response = await apiClient.delete(`/events/${event.id}`);
        expect(response.status).toBe(204);

        // Verify deletion
        await expect(
          apiClient.get(`/events/${event.id}`),
        ).rejects.toMatchObject({ response: { status: 404 } });
      }

      // Reset IDs to prevent afterAll cleanup from failing
      bashEventId = 0;
      pythonEventId = 0;
      nodejsEventId = 0;
    });
  });
});
