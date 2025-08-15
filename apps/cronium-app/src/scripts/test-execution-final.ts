#!/usr/bin/env tsx

import { db } from "../server/db";
import { executions } from "../shared/schema";
import { desc } from "drizzle-orm";

async function testExecutionContext() {
  console.log("\n=== Testing Execution System ===\n");

  try {
    // 1. Check latest execution in database
    console.log("1. Checking latest execution in database...");
    const [latestExecution] = await db
      .select()
      .from(executions)
      .orderBy(desc(executions.createdAt))
      .limit(1);

    if (!latestExecution) {
      console.log("✗ No executions found in database");
      console.log(
        "\nTry running an event first to create an execution record.",
      );
      process.exit(1);
    }

    const executionId = latestExecution.id;
    console.log("✓ Execution found:");
    console.log(`  - ID: ${latestExecution.id}`);
    console.log(`  - Job ID: ${latestExecution.jobId}`);
    console.log(`  - Status: ${latestExecution.status}`);
    console.log(
      `  - Server: ${latestExecution.serverName ?? "local/container"}`,
    );
    console.log(`  - Exit Code: ${latestExecution.exitCode ?? "N/A"}`);
    console.log(`  - Created: ${latestExecution.createdAt.toISOString()}`);

    // 2. Test execution context API
    console.log("\n2. Testing execution context API...");
    const apiKey =
      process.env.INTERNAL_API_KEY ?? "VYMGQuZAL31iqg1voO6pgi3zXlnEM77O";
    const baseUrl = "http://localhost:5001";

    try {
      const response = await fetch(
        `${baseUrl}/api/internal/executions/${executionId}/context`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      );

      if (response.ok) {
        const context = (await response.json()) as {
          executionId: string;
          jobId: string;
          eventId: string | null;
          userId: string;
          metadata: Record<string, unknown>;
          event: unknown;
          user: unknown;
        };

        console.log("✓ Context API working:");
        console.log(`  - Execution ID: ${context.executionId}`);
        console.log(`  - Job ID: ${context.jobId}`);
        console.log(`  - Event ID: ${context.eventId ?? "N/A"}`);
        console.log(`  - User ID: ${context.userId ?? "N/A"}`);

        // Verify eventId is a string if present
        if (context.eventId !== null && typeof context.eventId === "string") {
          console.log("✓ Event ID is correctly formatted as string");
        } else if (context.eventId !== null) {
          console.log(`✗ Event ID type issue: ${typeof context.eventId}`);
        }
      } else {
        console.log(
          `✗ Context API failed: ${response.status} ${response.statusText}`,
        );
        const error = await response.text();
        console.log(`  Error: ${error}`);
      }
    } catch (error) {
      console.log(`✗ Context API request failed: ${String(error)}`);
    }

    // 3. Check recent executions
    console.log("\n3. Checking recent executions...");
    const recentExecutions = await db
      .select()
      .from(executions)
      .orderBy(desc(executions.createdAt))
      .limit(5);

    console.log(`Found ${recentExecutions.length} recent executions:`);
    recentExecutions.forEach((exec) => {
      console.log(
        `  - ${exec.id}: status=${exec.status}, exitCode=${exec.exitCode ?? "N/A"}`,
      );
    });
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }

  console.log("\n=== Test Complete ===\n");
  process.exit(0);
}

testExecutionContext().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
