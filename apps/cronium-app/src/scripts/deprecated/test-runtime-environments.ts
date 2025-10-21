#!/usr/bin/env tsx

/**
 * Test script to verify runtime environments (Bash, Python, Node.js)
 * Tests error handling, package support, and runtime capabilities
 */

import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { EventType, LogStatus, JobType, EventStatus } from "@/shared/schema";
import { buildJobPayload } from "@/lib/scheduler/job-payload-builder";

interface TestCase {
  name: string;
  type: EventType;
  content: string;
  expectedSuccess: boolean;
  description: string;
}

const testCases: TestCase[] = [
  // Bash Runtime Tests
  {
    name: "Bash - Basic Execution",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "Testing Bash runtime"
echo "Bash version: $BASH_VERSION"
echo "Current directory: $(pwd)"
echo "User: $(whoami)"
exit 0`,
    expectedSuccess: true,
    description: "Basic bash script execution",
  },
  {
    name: "Bash - Error Handling",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "Testing error handling"
echo "This will fail" >&2
exit 1`,
    expectedSuccess: false,
    description: "Bash script with non-zero exit code",
  },
  {
    name: "Bash - Using Installed Tools",
    type: EventType.BASH,
    content: `#!/bin/bash
# Test installed tools
echo "Testing curl:"
curl --version | head -1

echo -e "\\nTesting jq:"
echo '{"test": "value"}' | jq .test

echo -e "\\nTesting environment:"
printenv | grep CRONIUM_ | sort`,
    expectedSuccess: true,
    description: "Testing pre-installed bash utilities",
  },

  // Python Runtime Tests
  {
    name: "Python - Basic Execution",
    type: EventType.PYTHON,
    content: `import sys
import platform

print("Testing Python runtime")
print(f"Python version: {sys.version}")
print(f"Platform: {platform.platform()}")
print(f"User: {platform.node()}")`,
    expectedSuccess: true,
    description: "Basic Python script execution",
  },
  {
    name: "Python - Error Handling",
    type: EventType.PYTHON,
    content: `import sys

print("Testing error handling")
sys.stderr.write("This is an error message\\n")
raise Exception("Test exception")`,
    expectedSuccess: false,
    description: "Python script with exception",
  },
  {
    name: "Python - Using Pre-installed Packages",
    type: EventType.PYTHON,
    content: `import requests
import aiohttp
import asyncio

print("Testing pre-installed packages")

# Test requests
response = requests.get('https://httpbin.org/json')
print(f"Requests test: Status {response.status_code}")

# Test aiohttp
async def test_aiohttp():
    async with aiohttp.ClientSession() as session:
        async with session.get('https://httpbin.org/json') as resp:
            print(f"Aiohttp test: Status {resp.status}")

asyncio.run(test_aiohttp())

# Test environment
import os
for key, value in os.environ.items():
    if key.startswith('CRONIUM_'):
        print(f"{key}={value}")`,
    expectedSuccess: true,
    description: "Testing pre-installed Python packages",
  },

  // Node.js Runtime Tests
  {
    name: "Node.js - Basic Execution",
    type: EventType.NODEJS,
    content: `console.log("Testing Node.js runtime");
console.log("Node version:", process.version);
console.log("Platform:", process.platform);
console.log("Architecture:", process.arch);
console.log("Current directory:", process.cwd());`,
    expectedSuccess: true,
    description: "Basic Node.js script execution",
  },
  {
    name: "Node.js - Error Handling",
    type: EventType.NODEJS,
    content: `console.log("Testing error handling");
console.error("This is an error message");
throw new Error("Test error");`,
    expectedSuccess: false,
    description: "Node.js script with thrown error",
  },
  {
    name: "Node.js - Using Pre-installed Packages",
    type: EventType.NODEJS,
    content: `const axios = require('axios');

console.log("Testing pre-installed packages");

// Test axios
axios.get('https://httpbin.org/json')
  .then(response => {
    console.log('Axios test: Status', response.status);
    
    // Test environment
    console.log('\\nEnvironment variables:');
    Object.keys(process.env)
      .filter(key => key.startsWith('CRONIUM_'))
      .sort()
      .forEach(key => {
        console.log(\`\${key}=\${process.env[key]}\`);
      });
  })
  .catch(error => {
    console.error('Request failed:', error.message);
    process.exit(1);
  });`,
    expectedSuccess: true,
    description: "Testing pre-installed Node.js packages",
  },

  // Advanced Tests
  {
    name: "Bash - Long Running Script",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "Starting long-running task..."
for i in {1..5}; do
  echo "Progress: $i/5"
  sleep 1
done
echo "Task completed!"`,
    expectedSuccess: true,
    description: "Testing script execution with delays",
  },
  {
    name: "Python - Memory and CPU Test",
    type: EventType.PYTHON,
    content: `import time
import psutil
import os

print("Testing resource usage...")

# Get memory info
try:
    process = psutil.Process(os.getpid())
    print(f"Memory usage: {process.memory_info().rss / 1024 / 1024:.2f} MB")
except:
    print("psutil not available, skipping memory test")

# Simple CPU test
start = time.time()
result = sum(i ** 2 for i in range(1000000))
elapsed = time.time() - start
print(f"CPU test completed in {elapsed:.2f} seconds")`,
    expectedSuccess: true,
    description: "Testing resource monitoring",
  },
  {
    name: "Node.js - Async Operations",
    type: EventType.NODEJS,
    content: `async function testAsync() {
  console.log("Testing async operations...");
  
  // Simulate async work
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  console.log("Starting async tasks...");
  const results = await Promise.all([
    delay(100).then(() => "Task 1 complete"),
    delay(200).then(() => "Task 2 complete"),
    delay(150).then(() => "Task 3 complete")
  ]);
  
  results.forEach(result => console.log(result));
  console.log("All async tasks completed!");
}

testAsync().catch(console.error);`,
    expectedSuccess: true,
    description: "Testing async/await functionality",
  },
];

async function createAndExecuteTest(testCase: TestCase): Promise<{
  jobId: string;
  success: boolean;
  error?: string;
}> {
  try {
    // Create event
    const event = await storage.createScript({
      name: testCase.name,
      type: testCase.type,
      content: testCase.content,
      status: EventStatus.ACTIVE,
      userId: "test-user",
      environment: JSON.stringify({
        TEST_ENV: "runtime-test",
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

    // Build job payload
    const jobPayload = buildJobPayload(eventWithRelations, log.id);

    // Create job
    const job = await jobService.createJob({
      eventId: event.id,
      userId: eventWithRelations.userId,
      type: JobType.SCRIPT,
      payload: jobPayload,
      metadata: {
        eventName: eventWithRelations.name,
        triggeredBy: "runtime-test",
        testCase: testCase.name,
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

async function runTests() {
  console.log("🧪 Testing Runtime Environments\n");
  console.log("This test suite verifies:");
  console.log("- Basic script execution for each runtime");
  console.log("- Error handling and exit codes");
  console.log("- Pre-installed package availability");
  console.log("- Resource constraints and async operations\n");

  const results: Array<{
    testCase: TestCase;
    jobId: string;
    created: boolean;
    error?: string;
  }> = [];

  // Create all test jobs
  for (const testCase of testCases) {
    console.log(`Creating test: ${testCase.name}`);
    const result = await createAndExecuteTest(testCase);
    results.push({
      testCase,
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
  console.log("Runtime | Test Case | Job ID | Expected Result");
  console.log("--------|-----------|--------|----------------");

  for (const result of results) {
    if (result.created) {
      const runtime = result.testCase.type;
      const testName = result.testCase.name.substring(runtime.length + 3);
      const expected = result.testCase.expectedSuccess ? "Success" : "Failure";
      console.log(
        `${runtime.padEnd(7)} | ${testName.padEnd(25).substring(0, 25)} | ${result.jobId} | ${expected}`,
      );
    }
  }

  console.log("\n📋 Test Descriptions:");
  for (const testCase of testCases) {
    console.log(`\n${testCase.name}:`);
    console.log(`  ${testCase.description}`);
    console.log(
      `  Expected: ${testCase.expectedSuccess ? "Success" : "Failure"}`,
    );
  }

  console.log("\n✅ All test jobs created and queued for execution");
  console.log("📋 Monitor execution: docker logs -f cronium-orchestrator-dev");
  console.log(
    "📊 Check results: pnpm tsx src/scripts/check-runtime-test-results.ts",
  );
}

// Run the tests
runTests().catch(console.error);
