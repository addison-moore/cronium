#!/usr/bin/env tsx
/**
 * Migration script to move output data from job.result to execution records
 * This is part of Phase 2: Consolidate Output Storage
 *
 * Run with: pnpm tsx src/scripts/migrations/migrate-output-to-executions.ts
 */

import { db } from "@/server/db";
import { jobs, executions } from "@/shared/schema";
import { eq, isNotNull } from "drizzle-orm";

async function migrateOutputToExecutions() {
  console.log("Starting migration: Move output from job.result to executions");

  try {
    // Get all jobs with result data
    const jobsWithResult = await db
      .select()
      .from(jobs)
      .where(isNotNull(jobs.result));

    console.log(`Found ${jobsWithResult.length} jobs with result data`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const job of jobsWithResult) {
      const result = job.result as any;

      // Skip if no output or error to migrate
      if (!result?.output && !result?.error) {
        skippedCount++;
        continue;
      }

      // Find executions for this job
      const jobExecutions = await db
        .select()
        .from(executions)
        .where(eq(executions.jobId, job.id));

      if (jobExecutions.length === 0) {
        console.log(`No execution found for job ${job.id}, skipping`);
        skippedCount++;
        continue;
      }

      // Update each execution with the output/error from job.result
      for (const execution of jobExecutions) {
        const updateData: any = {};

        // Only update if execution doesn't already have the data
        if (!execution.output && result.output) {
          updateData.output = result.output;
        }

        if (!execution.error && result.error) {
          updateData.error = result.error;
        }

        if (!execution.exitCode && result.exitCode !== undefined) {
          updateData.exitCode = result.exitCode;
        }

        if (Object.keys(updateData).length > 0) {
          await db
            .update(executions)
            .set(updateData)
            .where(eq(executions.id, execution.id));

          console.log(`Updated execution ${execution.id} for job ${job.id}`);
          migratedCount++;
        }
      }

      // Now clean up the job.result to only keep exitCode and metrics
      const cleanedResult: any = {};
      if (result.exitCode !== undefined) {
        cleanedResult.exitCode = result.exitCode;
      }
      if (result.metrics) {
        cleanedResult.metrics = result.metrics;
      }

      // Update job with cleaned result
      await db
        .update(jobs)
        .set({
          result: Object.keys(cleanedResult).length > 0 ? cleanedResult : null,
        })
        .where(eq(jobs.id, job.id));
    }

    console.log(`
Migration completed:
- Migrated: ${migratedCount} executions
- Skipped: ${skippedCount} jobs (no output/error or no execution)
- Total processed: ${jobsWithResult.length} jobs
`);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

// Run migration
migrateOutputToExecutions()
  .then(() => {
    console.log("Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration error:", error);
    process.exit(1);
  });
