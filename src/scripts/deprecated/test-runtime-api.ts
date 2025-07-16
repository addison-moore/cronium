#!/usr/bin/env tsx

/**
 * Test script to verify Runtime API functionality
 * Tests API endpoints, runtime helpers, and sidecar integration
 */

import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { EventType, LogStatus, JobType, EventStatus } from "@/shared/schema";
import { buildJobPayload } from "@/lib/scheduler/job-payload-builder";

interface RuntimeTest {
  name: string;
  type: EventType;
  content: string;
  description: string;
  expectedBehavior: string;
}

const runtimeTests: RuntimeTest[] = [
  // Basic Input/Output Tests
  {
    name: "Bash - Input/Output Test",
    type: EventType.BASH,
    content: `#!/bin/bash
source /usr/local/bin/cronium.sh

# Test input
echo "Getting input..."
input=$(cronium_input)
echo "Input received: $input"

# Process data
if [ -n "$input" ]; then
  count=$(echo "$input" | jq 'length // 0' 2>/dev/null || echo "0")
else
  count=0
fi

# Test output
result='{"processed": true, "item_count": '$count', "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
echo "Setting output: $result"
cronium_output "$result"
echo "Output set successfully"`,
    description: "Test input retrieval and output storage",
    expectedBehavior: "Should get input data and store processed output",
  },
  {
    name: "Python - Input/Output Test",
    type: EventType.PYTHON,
    content: `import cronium
from datetime import datetime

# Test input
print("Getting input...")
data = cronium.input()
print(f"Input received: {data}")

# Process data
item_count = len(data) if data and isinstance(data, list) else 0

# Test output
result = {
    "processed": True,
    "item_count": item_count,
    "timestamp": datetime.utcnow().isoformat()
}
print(f"Setting output: {result}")
cronium.output(result)
print("Output set successfully")`,
    description: "Test Python input/output functions",
    expectedBehavior: "Should handle input/output with proper serialization",
  },
  {
    name: "Node.js - Input/Output Test",
    type: EventType.NODEJS,
    content: `const cronium = require('cronium');

async function test() {
  // Test input
  console.log("Getting input...");
  const data = await cronium.input();
  console.log("Input received:", data);
  
  // Process data
  const itemCount = Array.isArray(data) ? data.length : 0;
  
  // Test output
  const result = {
    processed: true,
    itemCount,
    timestamp: new Date().toISOString()
  };
  console.log("Setting output:", result);
  await cronium.output(result);
  console.log("Output set successfully");
}

test().catch(console.error);`,
    description: "Test Node.js async input/output",
    expectedBehavior: "Should use promises for input/output operations",
  },

  // Variable Management Tests
  {
    name: "Bash - Variable Management",
    type: EventType.BASH,
    content: `#!/bin/bash
source /usr/local/bin/cronium.sh

# Test setting variables
echo "Setting variables..."
cronium_set_variable "test_counter" "1"
cronium_set_variable "test_config" '{"mode": "test", "enabled": true}'
cronium_set_variable "test_timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Test getting variables
echo "Getting variables..."
counter=$(cronium_get_variable "test_counter")
config=$(cronium_get_variable "test_config")
timestamp=$(cronium_get_variable "test_timestamp")

echo "Counter: $counter"
echo "Config: $config"
echo "Timestamp: $timestamp"

# Test variable exists
if cronium_variable_exists "test_counter"; then
  echo "Variable test_counter exists"
fi

# Test incrementing
cronium_increment_variable "test_counter"
new_counter=$(cronium_get_variable "test_counter")
echo "Counter after increment: $new_counter"`,
    description: "Test variable get/set operations",
    expectedBehavior: "Should store and retrieve variables correctly",
  },
  {
    name: "Python - Variable Management",
    type: EventType.PYTHON,
    content: `import cronium
from datetime import datetime

# Test setting variables
print("Setting variables...")
cronium.set_variable("test_counter", 1)
cronium.set_variable("test_config", {"mode": "test", "enabled": True})
cronium.set_variable("test_timestamp", datetime.utcnow().isoformat())

# Test getting variables
print("Getting variables...")
counter = cronium.get_variable("test_counter")
config = cronium.get_variable("test_config")
timestamp = cronium.get_variable("test_timestamp")

print(f"Counter: {counter}")
print(f"Config: {config}")
print(f"Timestamp: {timestamp}")

# Test non-existent variable
missing = cronium.get_variable("non_existent_var")
print(f"Missing variable: {missing}")

# Update counter
cronium.set_variable("test_counter", counter + 1)
new_counter = cronium.get_variable("test_counter")
print(f"Counter after update: {new_counter}")`,
    description: "Test Python variable management",
    expectedBehavior: "Should handle different data types in variables",
  },

  // Event Context Test
  {
    name: "All Runtimes - Event Context",
    type: EventType.BASH,
    content: `#!/bin/bash
source /usr/local/bin/cronium.sh

# Get event context
echo "Getting event context..."
event=$(cronium_event)
echo "Full event: $event"

# Get specific fields
event_id=$(cronium_event_field "id")
event_name=$(cronium_event_field "name")
event_type=$(cronium_event_field "type")
user_id=$(cronium_event_field "userId")

echo "Event ID: $event_id"
echo "Event Name: $event_name"
echo "Event Type: $event_type"
echo "User ID: $user_id"

# Store event info in output
cronium_output "{
  \"event_id\": \"$event_id\",
  \"event_name\": \"$event_name\",
  \"event_type\": \"$event_type\",
  \"user_id\": \"$user_id\"
}"`,
    description: "Test event context retrieval",
    expectedBehavior: "Should access event metadata",
  },

  // Workflow Condition Test
  {
    name: "Python - Workflow Condition",
    type: EventType.PYTHON,
    content: `import cronium

# Get input data
data = cronium.input()
print(f"Processing data: {data}")

# Process and determine condition
items_processed = 0
if data and isinstance(data, list):
    items_processed = len(data)
    print(f"Processing {items_processed} items")

# Set condition based on processing
success = items_processed > 0
cronium.set_condition(success)
print(f"Condition set to: {success}")

# Output results
cronium.output({
    "items_processed": items_processed,
    "condition_set": success
})`,
    description: "Test workflow condition setting",
    expectedBehavior: "Should set workflow condition for branching",
  },

  // Error Handling Test
  {
    name: "Node.js - Error Handling",
    type: EventType.NODEJS,
    content: `const cronium = require('cronium');

async function test() {
  try {
    // Test valid operations
    console.log("Testing valid operations...");
    await cronium.output({ step: "initial" });
    
    // Test getting non-existent variable
    console.log("Testing non-existent variable...");
    const missing = await cronium.getVariable("does_not_exist");
    console.log("Missing variable:", missing);
    
    // Test setting and getting variable
    console.log("Testing variable operations...");
    await cronium.setVariable("error_test", { tested: true });
    const value = await cronium.getVariable("error_test");
    console.log("Retrieved value:", value);
    
    // Final output
    await cronium.output({
      completed: true,
      tests_passed: true
    });
    
  } catch (error) {
    console.error("Test failed:", error.message);
    if (error.statusCode) {
      console.error("Status code:", error.statusCode);
    }
    process.exit(1);
  }
}

test();`,
    description: "Test error handling and recovery",
    expectedBehavior: "Should handle API errors gracefully",
  },

  // Complex Integration Test
  {
    name: "Python - Full Integration",
    type: EventType.PYTHON,
    content: `import cronium
import json
from datetime import datetime

print("=== Cronium Runtime API Integration Test ===\\n")

# 1. Get event context
print("1. Getting event context...")
event = cronium.event()
print(f"   Event: {event.get('name')} (ID: {event.get('id')})")
print(f"   Type: {event.get('type')}")

# 2. Get input data
print("\\n2. Getting input data...")
input_data = cronium.input()
print(f"   Input: {input_data}")

# 3. Variable operations
print("\\n3. Testing variables...")
test_key = f"integration_test_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
cronium.set_variable(test_key, {"test": True, "timestamp": datetime.utcnow().isoformat()})
stored_value = cronium.get_variable(test_key)
print(f"   Stored and retrieved: {stored_value}")

# 4. Process data
print("\\n4. Processing...")
result = {
    "test_completed": True,
    "event_id": event.get("id"),
    "input_received": input_data is not None,
    "variable_test_passed": stored_value is not None,
    "timestamp": datetime.utcnow().isoformat()
}

# 5. Set output
print("\\n5. Setting output...")
cronium.output(result)
print("   Output set successfully")

# 6. Set condition for workflow
if input_data:
    cronium.set_condition(True)
    print("\\n6. Workflow condition set to: True")

print("\\n=== All tests completed successfully ===")`,
    description: "Full integration test of all runtime features",
    expectedBehavior: "Should demonstrate all runtime API capabilities",
  },
];

async function createAndExecuteRuntimeTest(test: RuntimeTest): Promise<{
  jobId: string;
  success: boolean;
  error?: string;
}> {
  try {
    // Create event
    const event = await storage.createScript({
      name: test.name,
      type: test.type,
      content: test.content,
      status: EventStatus.ACTIVE,
      userId: "test-user",
      environment: JSON.stringify({
        TEST_TYPE: "runtime-api",
        TEST_NAME: test.name,
      }),
      runLocation: "LOCAL",
    });

    const eventWithRelations = await storage.getEventWithRelations(event.id);
    if (!eventWithRelations) {
      throw new Error("Failed to get event");
    }

    // Create log
    const log = await storage.createLog({
      eventId: event.id,
      status: LogStatus.PENDING,
      startTime: new Date(),
      eventName: eventWithRelations.name,
      eventType: eventWithRelations.type,
      userId: eventWithRelations.userId,
    });

    // Build job payload with test input data
    const jobPayload = buildJobPayload(eventWithRelations, log.id);

    // Add test input data for input/output tests
    if (test.name.includes("Input/Output")) {
      jobPayload.inputData = [
        { id: 1, name: "Test Item 1" },
        { id: 2, name: "Test Item 2" },
        { id: 3, name: "Test Item 3" },
      ];
    }

    // Create job
    const job = await jobService.createJob({
      eventId: event.id,
      userId: eventWithRelations.userId,
      type: JobType.SCRIPT,
      payload: jobPayload,
      metadata: {
        eventName: eventWithRelations.name,
        triggeredBy: "runtime-api-test",
        testCase: test.name,
        logId: log.id,
      },
    });

    return {
      jobId: job.id,
      success: true,
    };
  } catch (error) {
    return {
      jobId: "",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runRuntimeAPITests() {
  console.log("🧪 Testing Runtime API & Helpers\n");
  console.log("This test suite verifies:");
  console.log("- Runtime API sidecar functionality");
  console.log("- Input/output data management");
  console.log("- Variable storage and retrieval");
  console.log("- Event context access");
  console.log("- Workflow condition setting");
  console.log("- Error handling\n");

  const results: Array<{
    test: RuntimeTest;
    jobId: string;
    created: boolean;
    error?: string;
  }> = [];

  // Create all test jobs
  for (const test of runtimeTests) {
    console.log(`Creating test: ${test.name}`);
    const result = await createAndExecuteRuntimeTest(test);
    results.push({
      test,
      jobId: result.jobId,
      created: result.success,
      error: result.error,
    });

    if (result.success) {
      console.log(`  ✅ Job created: ${result.jobId}`);
    } else {
      console.log(`  ❌ Failed: ${result.error}`);
    }
  }

  // Summary
  console.log("\n📊 Test Summary\n");
  console.log("Test Name | Job ID | Description");
  console.log("----------|--------|------------");

  for (const result of results) {
    if (result.created) {
      console.log(
        `${result.test.name.padEnd(40).substring(0, 40)} | ${result.jobId} | ${result.test.description}`,
      );
    }
  }

  console.log("\n📋 Expected Behaviors:");
  for (const test of runtimeTests) {
    console.log(`\n${test.name}:`);
    console.log(`  ${test.expectedBehavior}`);
  }

  console.log("\n✅ All runtime API test jobs created and queued");
  console.log("📋 Monitor execution: docker logs -f cronium-agent-dev");
  console.log(
    "📊 Check results: pnpm tsx src/scripts/check-runtime-api-results.ts",
  );
}

// Run the tests
runRuntimeAPITests().catch(console.error);
