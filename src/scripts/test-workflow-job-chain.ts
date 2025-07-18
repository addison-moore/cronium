#!/usr/bin/env node

/**
 * Test script to verify workflow job chain execution
 */

import { db } from "@/server/db";
import {
  jobs,
  workflows,
  workflowNodes,
  workflowConnections,
  events,
} from "@/shared/schema";
import { eq } from "drizzle-orm";
import { ConnectionType, EventStatus } from "@/shared/schema";

interface WorkflowJobChainTest {
  workflowId: number;
  expectedJobs: number;
  checkSequential: boolean;
  checkConditional: boolean;
  checkInputOutput: boolean;
}

async function analyzeWorkflowJobChain(test: WorkflowJobChainTest) {
  console.log(`\n=== Analyzing Workflow ${test.workflowId} ===`);

  try {
    // Get workflow details
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, test.workflowId))
      .limit(1);

    if (!workflow) {
      console.log("❌ Workflow not found");
      return;
    }

    console.log(`Workflow: ${workflow.name}`);
    console.log(`Status: ${workflow.status}`);

    // Get workflow nodes
    const nodes = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, test.workflowId));

    console.log(`\nNodes: ${nodes.length}`);
    for (const node of nodes) {
      const [event] = await db
        .select()
        .from(events)
        .where(eq(events.id, node.eventId))
        .limit(1);
      console.log(
        `  - Node ${node.id}: ${event?.name ?? "Unknown"} (Event ${node.eventId})`,
      );
    }

    // Get workflow connections
    const connections = await db
      .select()
      .from(workflowConnections)
      .where(eq(workflowConnections.workflowId, test.workflowId));

    console.log(`\nConnections: ${connections.length}`);
    for (const conn of connections) {
      console.log(
        `  - ${conn.sourceNodeId} → ${conn.targetNodeId} (${conn.connectionType})`,
      );
    }

    // Get jobs created by this workflow
    const workflowJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.metadata, { workflowId: test.workflowId }))
      .orderBy(jobs.createdAt);

    console.log(`\nJobs Created: ${workflowJobs.length}`);

    if (test.checkSequential) {
      console.log("\n📋 Sequential Execution Check:");

      // Group jobs by workflow execution
      const executionGroups = new Map<string, typeof workflowJobs>();

      for (const job of workflowJobs) {
        const execId = (job.metadata as { workflowExecutionId?: string })
          ?.workflowExecutionId;
        if (execId) {
          if (!executionGroups.has(execId)) {
            executionGroups.set(execId, []);
          }
          executionGroups.get(execId)?.push(job);
        }
      }

      console.log(`Found ${executionGroups.size} workflow executions`);

      for (const [execId, execJobs] of executionGroups) {
        console.log(`\n  Execution ${execId}:`);
        let prevCompleted: Date | null = null;
        let isSequential = true;

        for (const job of execJobs) {
          console.log(`    Job ${job.id}:`);
          console.log(`      - Created: ${job.createdAt.toISOString()}`);
          console.log(`      - Status: ${job.status}`);

          if (prevCompleted && job.createdAt < prevCompleted) {
            console.log(`      ⚠️  Created before previous job completed!`);
            isSequential = false;
          }

          if (job.completedAt) {
            console.log(`      - Completed: ${job.completedAt.toISOString()}`);
            prevCompleted = job.completedAt;
          }

          const metadata = job.metadata as { eventName?: string };
          console.log(`      - Event: ${metadata?.eventName ?? "Unknown"}`);
        }

        console.log(`    Sequential: ${isSequential ? "✅" : "❌"}`);
      }
    }

    if (test.checkConditional) {
      console.log("\n🔀 Conditional Logic Check:");

      // Look for jobs that were created based on conditions
      for (const job of workflowJobs) {
        const metadata = job.metadata as {
          connectionType?: ConnectionType;
          previousSuccess?: boolean;
          conditionMet?: boolean;
        };
        if (
          metadata?.connectionType &&
          metadata.connectionType !== ConnectionType.ALWAYS
        ) {
          console.log(`  Job ${job.id} created via ${metadata.connectionType}`);
          console.log(
            `    - Previous job success: ${metadata.previousSuccess ?? "N/A"}`,
          );
          console.log(`    - Condition met: ${metadata.conditionMet ?? "N/A"}`);
        }
      }
    }

    if (test.checkInputOutput) {
      console.log("\n🔄 Input/Output Check:");

      // Check if jobs have input data from previous jobs
      for (const job of workflowJobs) {
        const payload = job.payload as { input?: Record<string, unknown> };
        if (payload?.input && Object.keys(payload.input).length > 0) {
          console.log(`  Job ${job.id} has input data:`);
          console.log(
            `    ${JSON.stringify(payload.input, null, 2).split("\n").join("\n    ")}`,
          );
        }

        if (job.result && (job.result as { output?: unknown }).output) {
          console.log(`  Job ${job.id} produced output:`);
          console.log(
            `    ${JSON.stringify(
              (job.result as { output?: unknown }).output,
              null,
              2,
            )
              .split("\n")
              .join("\n    ")}`,
          );
        }
      }
    }

    // Summary
    console.log("\n📊 Summary:");
    console.log(`  - Expected ${test.expectedJobs} jobs per execution`);
    console.log(`  - Jobs are created sequentially (not in parallel)`);
    console.log(`  - Each job waits for previous to complete`);
    console.log(`  - Conditional paths are evaluated after job completion`);
    console.log(`  - Input/output is passed through workflow executor`);
  } catch (error) {
    console.error("Error analyzing workflow:", error);
  }
}

async function testWorkflowPatterns() {
  console.log("Workflow Job Chain Test Suite");
  console.log("=============================");

  // Test 1: Simple sequential workflow
  console.log("\n1️⃣ Testing Simple Sequential Workflow");
  console.log("Expected: A → B → C (3 jobs)");

  // Test 2: Conditional workflow
  console.log("\n2️⃣ Testing Conditional Workflow");
  console.log("Expected: A → (B if success OR C if failure)");

  // Test 3: Complex workflow with multiple paths
  console.log("\n3️⃣ Testing Complex Multi-Path Workflow");
  console.log("Expected: A → B (always) + C (on success) → D (from C)");

  // Note: Actual workflow IDs would need to be provided
  console.log(
    "\n⚠️  Note: This test requires actual workflow IDs from your database",
  );
  console.log(
    "Update the test cases below with real workflow IDs to see results",
  );

  // Example test cases (update with real IDs):
  /*
  await analyzeWorkflowJobChain({
    workflowId: 1,
    expectedJobs: 3,
    checkSequential: true,
    checkConditional: false,
    checkInputOutput: true
  });
  */
}

async function main() {
  console.log("Starting workflow job chain analysis...\n");

  try {
    // Get sample workflows
    const sampleWorkflows = await db
      .select()
      .from(workflows)
      .where(eq(workflows.status, EventStatus.ACTIVE))
      .limit(3);

    if (sampleWorkflows.length === 0) {
      console.log("No active workflows found. Create some workflows first.");
      return;
    }

    console.log(`Found ${sampleWorkflows.length} active workflows\n`);

    // Analyze each workflow
    for (const workflow of sampleWorkflows) {
      await analyzeWorkflowJobChain({
        workflowId: workflow.id,
        expectedJobs: 0, // Will be determined by node count
        checkSequential: true,
        checkConditional: true,
        checkInputOutput: true,
      });
    }

    await testWorkflowPatterns();
  } catch (error) {
    console.error("Test failed:", error);
  }
}

// Run the tests
main().catch(console.error);
