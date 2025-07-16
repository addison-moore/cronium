import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createTRPCRouter,
  publicProcedure,
  withTiming,
  withCache,
} from "../trpc";
import { jobService } from "@/lib/services/job-service";
import { JobStatus, logs } from "@/shared/schema";
import { db } from "@/server/db";
import { eq } from "drizzle-orm";

// Type for authenticated job context
interface JobContext {
  userId: string;
}

// Custom procedure that handles auth
const jobProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      userId: ctx.session.user.id,
    },
  });
});

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
  get: jobProcedure
    .use(withTiming)
    .use(withCache(5000)) // Cache for 5 seconds
    .input(getJobSchema)
    .query(async ({ ctx, input }) => {
      const jobCtx = ctx as JobContext;

      const job = await jobService.getJob(input.jobId);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Ensure user can only see their own jobs
      if (job.userId !== jobCtx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
        });
      }

      return job;
    }),

  // List jobs for the current user
  list: jobProcedure
    .use(withTiming)
    .use(withCache(5000)) // Cache for 5 seconds
    .input(listJobsSchema)
    .query(async ({ ctx, input }) => {
      const jobCtx = ctx as JobContext;

      const { jobs, total } = await jobService.listJobs(
        {
          userId: jobCtx.userId,
          status: input.status,
          eventId: input.eventId,
        },
        input.limit,
        input.offset,
      );

      return {
        jobs,
        total,
        hasMore: input.offset + jobs.length < total,
      };
    }),

  // Get job statistics
  stats: jobProcedure
    .use(withTiming)
    .use(withCache(10000)) // Cache for 10 seconds
    .query(async ({ ctx }) => {
      const jobCtx = ctx as JobContext;

      return await jobService.getJobStats(jobCtx.userId);
    }),

  // Cancel a job
  cancel: jobProcedure
    .use(withTiming)
    .input(cancelJobSchema)
    .mutation(async ({ ctx, input }) => {
      const jobCtx = ctx as JobContext;

      const job = await jobService.getJob(input.jobId);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Ensure user can only cancel their own jobs
      if (job.userId !== jobCtx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
        });
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

      return cancelledJob;
    }),

  // Get job logs
  logs: jobProcedure
    .use(withTiming)
    .use(withCache(5000)) // Cache for 5 seconds
    .input(getJobLogsSchema)
    .query(async ({ ctx, input }) => {
      const jobCtx = ctx as JobContext;

      // First verify the job exists and belongs to the user
      const job = await jobService.getJob(input.jobId);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Ensure user can only see logs for their own jobs
      if (job.userId !== jobCtx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
        });
      }

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
        .limit(input.limit)
        .offset(input.offset);

      // Get total count for pagination
      const countResult = await db
        .select({ count: logs.id })
        .from(logs)
        .where(eq(logs.jobId, input.jobId));

      const total = countResult.length;

      return {
        logs: jobLogs,
        total,
        hasMore: input.offset + jobLogs.length < total,
      };
    }),
});
