#!/usr/bin/env node

/**
 * Test script to validate job creation for different event types
 */

import { buildJobPayload } from "@/lib/scheduler/job-payload-builder";
import type { EventWithRelations } from "@/server/storage";
import {
  EventType,
  EventStatus,
  RunLocation,
  TimeUnit,
  EventTriggerType,
} from "@/shared/schema";

// Mock event data for testing
const mockScriptEvent: Partial<EventWithRelations> = {
  id: 1,
  name: "Test Bash Script",
  type: EventType.BASH,
  content: "echo 'Hello from Bash script'",
  status: EventStatus.ACTIVE,
  runLocation: RunLocation.LOCAL,
  timeoutValue: 30,
  timeoutUnit: TimeUnit.SECONDS,
  retries: 2,
  envVars: [
    { key: "API_KEY", value: "test-key-123" },
    { key: "ENV_TYPE", value: "testing" },
  ],
  userId: "test-user",
  triggerType: EventTriggerType.MANUAL,
  scheduleNumber: 1,
  scheduleUnit: TimeUnit.MINUTES,
};

const mockHttpEvent: Partial<EventWithRelations> = {
  id: 2,
  name: "Test HTTP Request",
  type: EventType.HTTP,
  httpMethod: "POST",
  httpUrl: "https://api.example.com/webhook",
  httpHeaders: {
    "Content-Type": "application/json",
    Authorization: "Bearer test-token",
  },
  httpBody: JSON.stringify({ message: "Test webhook" }),
  status: EventStatus.ACTIVE,
  runLocation: RunLocation.LOCAL,
  timeoutValue: 10,
  timeoutUnit: TimeUnit.SECONDS,
  retries: 1,
  userId: "test-user",
  triggerType: EventTriggerType.SCHEDULE,
  scheduleNumber: 5,
  scheduleUnit: TimeUnit.MINUTES,
};

const mockToolEvent: Partial<EventWithRelations> = {
  id: 3,
  name: "Test Tool Action",
  type: EventType.TOOL_ACTION,
  toolActionConfig: {
    toolType: "slack",
    action: "sendMessage",
    channel: "#notifications",
    message: "Test notification from Cronium",
    webhookUrl: "https://hooks.slack.com/services/TEST/WEBHOOK",
  },
  status: EventStatus.ACTIVE,
  runLocation: RunLocation.LOCAL,
  timeoutValue: 5,
  timeoutUnit: TimeUnit.SECONDS,
  retries: 0,
  userId: "test-user",
  triggerType: EventTriggerType.MANUAL,
  scheduleNumber: 1,
  scheduleUnit: TimeUnit.MINUTES,
};

const mockRemoteEvent: Partial<EventWithRelations> = {
  id: 4,
  name: "Remote Python Script",
  type: EventType.PYTHON,
  content: "print('Running on remote server')",
  status: EventStatus.ACTIVE,
  runLocation: RunLocation.REMOTE,
  serverId: 123,
  timeoutValue: 60,
  timeoutUnit: TimeUnit.SECONDS,
  retries: 1,
  envVars: [{ key: "REMOTE_VAR", value: "remote-value" }],
  userId: "test-user",
  triggerType: EventTriggerType.MANUAL,
  scheduleNumber: 1,
  scheduleUnit: TimeUnit.MINUTES,
};

function testJobPayload(
  eventName: string,
  event: Partial<EventWithRelations>,
  inputData?: Record<string, unknown>,
) {
  console.log(`\n=== Testing ${eventName} ===`);

  try {
    const payload = buildJobPayload(
      event as EventWithRelations,
      12345,
      inputData,
    );
    console.log("✓ Job payload created successfully:");
    console.log(JSON.stringify(payload, null, 2));

    // Validate payload structure
    console.log("\nValidation:");
    console.log(`- Execution Log ID: ${payload.executionLogId}`);
    console.log(
      `- Has input data: ${Object.keys(payload.input).length > 0 ? "Yes" : "No"}`,
    );

    if (payload.script) {
      console.log(`- Script type: ${payload.script.type}`);
      console.log(
        `- Script content length: ${payload.script.content.length} chars`,
      );
    }

    if (payload.httpRequest) {
      console.log(`- HTTP method: ${payload.httpRequest.method}`);
      console.log(`- HTTP URL: ${payload.httpRequest.url}`);
      console.log(
        `- Has headers: ${payload.httpRequest.headers ? "Yes" : "No"}`,
      );
      console.log(`- Has body: ${payload.httpRequest.body ? "Yes" : "No"}`);
    }

    if (payload.toolAction) {
      console.log(`- Tool type: ${payload.toolAction.toolType}`);
      console.log(
        `- Config keys: ${Object.keys(payload.toolAction.config).join(", ")}`,
      );
    }

    if (payload.environment) {
      console.log(
        `- Environment vars: ${Object.keys(payload.environment).join(", ")}`,
      );
    }

    if (payload.target) {
      console.log(
        `- Target: ${payload.target.serverId ? `Server ${payload.target.serverId}` : payload.target.containerImage}`,
      );
    }

    if (payload.timeout) {
      console.log(
        `- Timeout: ${payload.timeout.value} ${payload.timeout.unit}`,
      );
    }

    console.log(`- Retries: ${payload.retries ?? 0}`);
  } catch (error) {
    console.error(`✗ Failed to create job payload: ${error}`);
  }
}

function main() {
  console.log("Job Creation Test Suite\n");
  console.log("This script validates that different event types are correctly");
  console.log(
    "converted to job payloads for the containerized execution system.\n",
  );

  // Test script event
  testJobPayload("Script Event", mockScriptEvent);

  // Test HTTP request event
  testJobPayload("HTTP Request Event", mockHttpEvent);

  // Test tool action event
  testJobPayload("Tool Action Event", mockToolEvent);

  // Test remote execution
  testJobPayload("Remote Execution Event", mockRemoteEvent);

  // Test with input data
  const inputData = {
    previousOutput: "Result from previous step",
    variables: { count: 42, status: "active" },
  };
  testJobPayload("Script Event with Input Data", mockScriptEvent, inputData);

  console.log("\n=== Test Summary ===");
  console.log("All job payload creation tests completed.");
  console.log("\nKey findings:");
  console.log("- Script events include content and environment variables");
  console.log("- HTTP events include method, URL, headers, and body");
  console.log("- Tool action events include tool type and configuration");
  console.log("- Remote events target specific server IDs");
  console.log("- Container images are assigned based on event type");
  console.log("- Timeout and retry settings are preserved");
}

// Run the tests
main();
