#!/usr/bin/env tsx

/**
 * Script to check the status of jobs and view their execution results
 */

import { jobService } from "@/lib/services/job-service";
import { storage } from "@/server/storage";
import { JobStatus } from "@/shared/schema";

async function checkJobStatus(jobId?: string) {
  if (jobId) {
    // Check specific job
    const job = await jobService.getJob(jobId);
    if (!job) {
      console.log(`Job ${jobId} not found`);
      return;
    }

    console.log(`\n=== Job ${job.id} ===`);
    console.log(`Status: ${job.status}`);
    console.log(`Type: ${job.type}`);
    console.log(`Event ID: ${job.eventId}`);
    console.log(`Created: ${job.createdAt}`);
    console.log(`Started: ${job.startedAt || "Not started"}`);
    console.log(`Completed: ${job.completedAt || "Not completed"}`);

    if (job.orchestratorId) {
      console.log(`Orchestrator: ${job.orchestratorId}`);
    }

    if (job.result) {
      const result = job.result as any;
      console.log(`\nResult:`);
      console.log(`  Exit Code: ${result.exitCode}`);
      console.log(`  Output: ${result.output || "No output"}`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
    }

    // Get logs for the job
    const logs = await storage.getLogsByJobId(job.id);
    if (logs.length > 0) {
      console.log(`\nExecution Logs:`);
      for (const log of logs) {
        console.log(`  [${log.timestamp}] ${log.stream}: ${log.message}`);
      }
    }
  } else {
    // List recent jobs
    console.log("\n=== Recent Jobs ===\n");

    const statuses = Object.values(JobStatus);
    for (const status of statuses) {
      const { jobs, total } = await jobService.listJobs({ status }, 5);

      if (total > 0) {
        console.log(`${status.toUpperCase()} (${total} total):`);
        for (const job of jobs) {
          const payload = job.payload as any;
          const eventName = (job.metadata as any)?.eventName || "Unknown";
          const eventType =
            payload.script?.type || payload.httpRequest ? "HTTP" : "Unknown";

          console.log(`  ${job.id} - ${eventName} (${eventType})`);
          if (job.startedAt) {
            const duration = job.completedAt
              ? (new Date(job.completedAt).getTime() -
                  new Date(job.startedAt).getTime()) /
                1000
              : "Running";
            console.log(
              `    Started: ${job.startedAt}, Duration: ${duration}s`,
            );
          }
          if (job.result) {
            const result = job.result as any;
            console.log(`    Exit Code: ${result.exitCode}`);
          }
        }
        console.log();
      }
    }

    // Show stats
    const stats = await jobService.getJobStats();
    console.log("=== Overall Statistics ===");
    console.log(`Total: ${stats.total}`);
    console.log(`Queued: ${stats.queued}`);
    console.log(`Running: ${stats.running}`);
    console.log(`Completed: ${stats.completed}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Cancelled: ${stats.cancelled}`);
  }
}

async function main() {
  const jobId = process.argv[2];

  if (jobId) {
    console.log(`Checking status for job: ${jobId}`);
  } else {
    console.log("Checking recent job statuses...");
    console.log(
      "Tip: Run with a job ID to see detailed info: pnpm tsx src/scripts/check-job-status.ts <job-id>",
    );
  }

  try {
    await checkJobStatus(jobId);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main().catch(console.error);
