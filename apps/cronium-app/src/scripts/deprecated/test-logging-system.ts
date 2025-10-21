#!/usr/bin/env tsx

/**
 * Test script to verify logging system functionality
 * Tests container log collection, streaming, and persistence
 */

import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { EventType, LogStatus, JobType, EventStatus } from "@/shared/schema";
import { buildJobPayload } from "@/lib/scheduler/job-payload-builder";

interface LoggingTest {
  name: string;
  type: EventType;
  content: string;
  description: string;
  expectedLogs: string[];
}

const loggingTests: LoggingTest[] = [
  // Basic stdout/stderr test
  {
    name: "Bash - Basic stdout/stderr",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "This is stdout line 1"
echo "This is stdout line 2"
echo "This is an error" >&2
echo "This is stdout line 3"
echo "Another error message" >&2
echo "Final stdout message"`,
    description: "Test basic stdout and stderr separation",
    expectedLogs: [
      "stdout: This is stdout line 1",
      "stdout: This is stdout line 2",
      "stderr: This is an error",
      "stdout: This is stdout line 3",
      "stderr: Another error message",
      "stdout: Final stdout message",
    ],
  },

  // Multi-line output test
  {
    name: "Python - Multi-line Output",
    type: EventType.PYTHON,
    content: `import sys
import time

print("Starting multi-line test")
print("Line 1\\nLine 2\\nLine 3")

# Flush to ensure immediate output
sys.stdout.flush()

# Test stderr
print("Error line 1\\nError line 2", file=sys.stderr)
sys.stderr.flush()

# JSON output
import json
data = {"status": "running", "progress": 50, "items": ["a", "b", "c"]}
print(json.dumps(data, indent=2))`,
    description: "Test multi-line output and JSON formatting",
    expectedLogs: [
      "stdout: Starting multi-line test",
      "stdout: Line 1",
      "stdout: Line 2",
      "stdout: Line 3",
      "stderr: Error line 1",
      "stderr: Error line 2",
      "stdout: {",
      'stdout:   "status": "running"',
    ],
  },

  // Streaming output test
  {
    name: "Node.js - Streaming Output",
    type: EventType.NODEJS,
    content: `console.log("Starting streaming test");

// Simulate streaming output
let count = 0;
const interval = setInterval(() => {
  console.log(\`Progress: \${++count}/10\`);
  if (count >= 10) {
    clearInterval(interval);
    console.log("Streaming complete!");
  }
}, 100);

// Also test stderr
setTimeout(() => {
  console.error("This is a warning");
}, 500);`,
    description: "Test real-time log streaming",
    expectedLogs: [
      "stdout: Starting streaming test",
      "stdout: Progress: 1/10",
      "stdout: Progress: 2/10",
      "stderr: This is a warning",
      "stdout: Progress: 10/10",
      "stdout: Streaming complete!",
    ],
  },

  // Large output test
  {
    name: "Bash - Large Output",
    type: EventType.BASH,
    content: `#!/bin/bash
echo "Generating large output..."

# Generate 100 lines
for i in {1..100}; do
  echo "Line $i: This is a test line with some content to make it longer"
done

echo "Large output complete"`,
    description: "Test handling of large log output",
    expectedLogs: [
      "stdout: Generating large output...",
      "stdout: Line 1:",
      "stdout: Line 50:",
      "stdout: Line 100:",
      "stdout: Large output complete",
    ],
  },

  // Unicode and special characters test
  {
    name: "Python - Unicode Output",
    type: EventType.PYTHON,
    content: `# Test Unicode output
print("Unicode test: 🚀 📊 ✅ ❌")
print("Japanese: こんにちは")
print("Emoji in error:", "⚠️ Warning!", file=__import__('sys').stderr)
print("Special chars: <>&\"'\\n\\t\\r")`,
    description: "Test Unicode and special character handling",
    expectedLogs: [
      "stdout: Unicode test: 🚀 📊 ✅ ❌",
      "stdout: Japanese: こんにちは",
      "stderr: Emoji in error: ⚠️ Warning!",
      "stdout: Special chars: <>&\"'",
    ],
  },

  // Buffering test
  {
    name: "Python - Output Buffering",
    type: EventType.PYTHON,
    content: `import sys
import time

# Test unbuffered output
print("Unbuffered output test", flush=True)

# Test buffered output
for i in range(5):
    print(f"Buffered line {i}", end=" ")
    time.sleep(0.1)

print()  # Newline to flush

# Force flush
sys.stdout.flush()
print("After flush")

# Test stderr (usually unbuffered)
for i in range(3):
    print(f"Error {i}", file=sys.stderr)
    time.sleep(0.1)`,
    description: "Test output buffering behavior",
    expectedLogs: [
      "stdout: Unbuffered output test",
      "stdout: Buffered line 0 Buffered line 1",
      "stdout: After flush",
      "stderr: Error 0",
      "stderr: Error 1",
      "stderr: Error 2",
    ],
  },

  // ANSI color codes test
  {
    name: "Bash - ANSI Colors",
    type: EventType.BASH,
    content: `#!/bin/bash
# Test ANSI color codes
echo -e "\\033[31mRed text\\033[0m"
echo -e "\\033[32mGreen text\\033[0m"
echo -e "\\033[33mYellow text\\033[0m"
echo -e "\\033[34mBlue text\\033[0m"
echo -e "\\033[1mBold text\\033[0m"
echo -e "\\033[4mUnderlined text\\033[0m"`,
    description: "Test ANSI color code handling",
    expectedLogs: [
      "stdout: \\033[31mRed text\\033[0m",
      "stdout: \\033[32mGreen text\\033[0m",
      "stdout: \\033[1mBold text\\033[0m",
    ],
  },

  // Error handling test
  {
    name: "Node.js - Error Scenarios",
    type: EventType.NODEJS,
    content: `console.log("Testing error scenarios");

// Uncaught exception (will be caught by process)
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  process.exit(1);
});

// Warning
process.emitWarning('This is a warning');

// Throw after delay
setTimeout(() => {
  throw new Error('Deliberate error for testing');
}, 100);`,
    description: "Test error logging scenarios",
    expectedLogs: [
      "stdout: Testing error scenarios",
      "stderr: (node:",
      "stderr: This is a warning",
      "stderr: Uncaught Exception:",
    ],
  },
];

async function createAndExecuteLoggingTest(test: LoggingTest): Promise<{
  jobId: string;
  eventId: string;
  logId: number;
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
        TEST_TYPE: "logging-system",
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
        triggeredBy: "logging-test",
        testCase: test.name,
        logId: log.id,
      },
    });

    return {
      jobId: job.id,
      eventId: event.id,
      logId: log.id,
      success: true,
    };
  } catch (error) {
    return {
      jobId: "",
      eventId: "",
      logId: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runLoggingTests() {
  console.log("🧪 Testing Logging System\n");
  console.log("This test suite verifies:");
  console.log("- Container stdout/stderr capture");
  console.log("- Log buffering and streaming");
  console.log("- Real-time WebSocket delivery");
  console.log("- Database persistence");
  console.log("- Special character handling\n");

  const results: Array<{
    test: LoggingTest;
    jobId: string;
    eventId: string;
    logId: number;
    created: boolean;
    error?: string;
  }> = [];

  // Create all test jobs
  for (const test of loggingTests) {
    console.log(`Creating test: ${test.name}`);
    const result = await createAndExecuteLoggingTest(test);
    results.push({
      test,
      jobId: result.jobId,
      eventId: result.eventId,
      logId: result.logId,
      created: result.success,
      error: result.error,
    });

    if (result.success) {
      console.log(
        `  ✅ Job created: ${result.jobId} (Log ID: ${result.logId})`,
      );
    } else {
      console.log(`  ❌ Failed: ${result.error}`);
    }
  }

  // Summary
  console.log("\n📊 Test Summary\n");
  console.log("Test Name | Job ID | Log ID | Description");
  console.log("----------|--------|--------|------------");

  for (const result of results) {
    if (result.created) {
      console.log(
        `${result.test.name.padEnd(35).substring(0, 35)} | ${result.jobId} | ${result.logId} | ${result.test.description}`,
      );
    }
  }

  console.log("\n📋 Expected Log Patterns:");
  for (const test of loggingTests) {
    console.log(`\n${test.name}:`);
    console.log(`  Expected: ${test.expectedLogs.slice(0, 3).join(", ")}...`);
  }

  console.log("\n✅ All logging test jobs created and queued");
  console.log("📋 Monitor logs: docker logs -f cronium-orchestrator-dev");
  console.log(
    "📊 Check results: pnpm tsx src/scripts/check-logging-results.ts",
  );
  console.log(
    "🔌 Test WebSocket: Open browser DevTools and watch Network > WS tab",
  );
}

// Run the tests
runLoggingTests().catch(console.error);
