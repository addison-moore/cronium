import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, withTiming } from "../trpc";
import {
  withErrorHandling,
  notFoundError,
  permissionError,
} from "@/server/utils/error-utils";
import {
  listResponse,
  resourceResponse,
  mutationResponse,
  statsResponse,
} from "@/server/utils/api-patterns";
import {
  normalizePagination,
  createPaginatedResult,
} from "@/server/utils/db-patterns";
import { jobService } from "@/lib/services/job-service";
import { JobStatus, logs } from "@/shared/schema";
import { db } from "@/server/db";
import { eq } from "drizzle-orm";

// Use standardized procedure with timing
const jobProcedure = protectedProcedure.use(withTiming);

// Schema definitions
const getJobSchema = z.object({
  jobId: z.string(),
});

const listJobsSchema = z.object({
  status: z
    .enum([
      JobStatus.QUEUED,
      JobStatus.CLAIMED,
      JobStatus.RUNNING,
      JobStatus.COMPLETED,
      JobStatus.FAILED,
      JobStatus.CANCELLED,
    ])
    .optional(),
  eventId: z.number().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

const cancelJobSchema = z.object({
  jobId: z.string(),
});

const getJobLogsSchema = z.object({
  jobId: z.string(),
  limit: z.number().min(1).max(1000).default(100),
  offset: z.number().min(0).default(0),
});

export const jobsRouter = createTRPCRouter({
  // Get a specific job
  get: jobProcedure.input(getJobSchema).query(async ({ ctx, input }) => {
    return withErrorHandling(
      async () => {
        const job = await jobService.getJob(input.jobId);

        if (!job) {
          throw notFoundError("Job");
        }

        // Ensure user can only see their own jobs
        if (job.userId !== ctx.session.user.id) {
          throw permissionError("view this job");
        }

        return resourceResponse(job);
      },
      {
        component: "jobsRouter",
        operationName: "get",
        userId: ctx.session.user.id,
      },
    );
  }),

  // List jobs for the current user
  list: jobProcedure.input(listJobsSchema).query(async ({ ctx, input }) => {
    return withErrorHandling(
      async () => {
        const pagination = normalizePagination(input);

        const filter: Parameters<typeof jobService.listJobs>[0] = {
          userId: ctx.session.user.id,
        };
        if (input.status !== undefined) {
          filter.status = input.status;
        }
        if (input.eventId !== undefined) {
          filter.eventId = input.eventId;
        }

        const { jobs, total } = await jobService.listJobs(
          filter,
          pagination.limit,
          pagination.offset,
        );

        const result = createPaginatedResult(jobs, total, pagination);
        const filters: {
          search?: string;
          status?: string;
          type?: string;
          [key: string]: unknown;
        } = {};
        if (input.status !== undefined) {
          filters.status = String(input.status);
        }
        if (input.eventId !== undefined) {
          filters.eventId = input.eventId;
        }
        return listResponse(result, filters);
      },
      {
        component: "jobsRouter",
        operationName: "list",
        userId: ctx.session.user.id,
      },
    );
  }),

  // Get job statistics
  stats: jobProcedure.query(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        const stats = await jobService.getJobStats(ctx.session.user.id);
        return statsResponse(
          {
            start: new Date(
              Date.now() - 30 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            end: new Date().toISOString(),
          },
          stats,
        );
      },
      {
        component: "jobsRouter",
        operationName: "stats",
        userId: ctx.session.user.id,
      },
    );
  }),

  // Cancel a job
  cancel: jobProcedure
    .input(cancelJobSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const job = await jobService.getJob(input.jobId);

          if (!job) {
            throw notFoundError("Job");
          }

          // Ensure user can only cancel their own jobs
          if (job.userId !== ctx.session.user.id) {
            throw permissionError("cancel this job");
          }

          // Can only cancel queued or running jobs
          if (
            ![JobStatus.QUEUED, JobStatus.CLAIMED, JobStatus.RUNNING].includes(
              job.status,
            )
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Job cannot be cancelled in its current state",
            });
          }

          const cancelledJob = await jobService.cancelJob(input.jobId);

          if (!cancelledJob) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to cancel job",
            });
          }

          return mutationResponse(cancelledJob, "Job cancelled successfully");
        },
        {
          component: "jobsRouter",
          operationName: "cancel",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get job logs
  logs: jobProcedure.input(getJobLogsSchema).query(async ({ ctx, input }) => {
    return withErrorHandling(
      async () => {
        // First verify the job exists and belongs to the user
        const job = await jobService.getJob(input.jobId);

        if (!job) {
          throw notFoundError("Job");
        }

        // Ensure user can only see logs for their own jobs
        if (job.userId !== ctx.session.user.id) {
          throw permissionError("view logs for this job");
        }

        const pagination = normalizePagination(input);

        // Get logs for this job
        const jobLogs = await db
          .select({
            id: logs.id,
            output: logs.output,
            error: logs.error,
            timestamp: logs.startTime,
          })
          .from(logs)
          .where(eq(logs.jobId, input.jobId))
          .orderBy(logs.startTime)
          .limit(pagination.limit)
          .offset(pagination.offset);

        // Get total count for pagination
        const countResult = await db
          .select({ count: logs.id })
          .from(logs)
          .where(eq(logs.jobId, input.jobId));

        const total = countResult.length;

        const result = createPaginatedResult(jobLogs, total, pagination);
        return listResponse(result);
      },
      {
        component: "jobsRouter",
        operationName: "logs",
        userId: ctx.session.user.id,
      },
    );
  }),
});
