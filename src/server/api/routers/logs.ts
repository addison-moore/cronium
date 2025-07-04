import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "../trpc";
import {
  logsQuerySchema,
  adminLogsQuerySchema,
  createLogSchema,
  updateLogSchema,
  logIdSchema,
  bulkLogOperationSchema,
  logStatsSchema,
  logSearchSchema,
  workflowLogsSchema,
} from "@shared/schemas/logs";
import { storage } from "@/server/storage";
import { UserRole, LogStatus } from "@shared/schema";

// Custom procedure that handles auth for tRPC fetch adapter
const logProcedure = publicProcedure.use(async ({ ctx, next }) => {
  let session = null;
  let userId = null;

  try {
    // If session exists in context, use it
    if (ctx.session?.user?.id) {
      session = ctx.session;
      userId = ctx.session.user.id;
    } else {
      // For development, get first admin user
      if (process.env.NODE_ENV === "development") {
        const allUsers = await storage.getAllUsers();
        const adminUsers = allUsers.filter(
          (user) => user.role === UserRole.ADMIN,
        );
        const firstAdmin = adminUsers[0];
        if (firstAdmin) {
          userId = firstAdmin.id;
          session = { user: { id: firstAdmin.id } };
        }
      }
    }

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    return next({
      ctx: {
        ...ctx,
        session,
        userId,
      },
    });
  } catch (error) {
    console.error("Auth error in logProcedure:", error);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication failed",
    });
  }
});

// Admin-only procedure
const adminLogProcedure = publicProcedure.use(async ({ ctx, next }) => {
  let session = null;
  let userId = null;
  let userRole = null;

  try {
    // If session exists in context, use it
    if (ctx.session?.user?.id) {
      session = ctx.session;
      userId = ctx.session.user.id;
      userRole = ctx.session.user.role;
    } else {
      // For development, get first admin user
      if (process.env.NODE_ENV === "development") {
        const allUsers = await storage.getAllUsers();
        const adminUsers = allUsers.filter(
          (user) => user.role === UserRole.ADMIN,
        );
        const firstAdmin = adminUsers[0];
        if (firstAdmin) {
          userId = firstAdmin.id;
          userRole = firstAdmin.role;
          session = { user: { id: firstAdmin.id, role: firstAdmin.role } };
        }
      }
    }

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    if (userRole !== UserRole.ADMIN) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Admin access required",
      });
    }

    return next({
      ctx: {
        ...ctx,
        session,
        userId,
        userRole,
      },
    });
  } catch (error) {
    console.error("Auth error in adminLogProcedure:", error);
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication failed",
    });
  }
});

export const logsRouter = createTRPCRouter({
  // Get logs for current user
  getAll: logProcedure.input(logsQuerySchema).query(async ({ ctx, input }) => {
    try {
      // Build filter object for database query
      const filters: any = {
        userId: ctx.userId,
        ownEventsOnly: input.ownEventsOnly,
        sharedOnly: input.sharedOnly,
      };

      // Add filters
      if (input.eventId) {
        // Check if user has access to this event
        const event = await storage.getEvent(input.eventId);
        if (!event) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }
        if (event.userId !== ctx.userId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized access to event",
          });
        }
        filters.eventId = input.eventId;
      }

      if (input.status) filters.status = input.status;
      if (input.date) filters.date = input.date;
      if (input.workflowId) {
        if (input.workflowId === -1) {
          filters.workflowId = null; // No workflow
        } else {
          filters.workflowId = input.workflowId;
        }
      }

      // Use page/pageSize if provided, otherwise use limit/offset
      const limit = input.pageSize || input.limit;
      const page = input.page || Math.floor(input.offset / limit) + 1;

      const { logs, total } = await storage.getFilteredLogs(
        filters,
        limit,
        page,
      );

      return {
        logs,
        total,
        page,
        pageSize: limit,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch logs",
        cause: error,
      });
    }
  }),

  // Get single log by ID
  getById: logProcedure.input(logIdSchema).query(async ({ ctx, input }) => {
    try {
      const log = await storage.getLog(input.id);
      if (!log) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Log not found" });
      }

      // Check if user has access to the event this log belongs to
      const event = await storage.getEvent(log.eventId);
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      }
      if (event.userId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      // Return log with additional event info
      return {
        ...log,
        eventName: event.name,
        scriptContent: event.content,
        scriptType: event.type,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch log",
        cause: error,
      });
    }
  }),

  // Create new log entry
  create: logProcedure
    .input(createLogSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if user has access to this event
        const event = await storage.getEvent(input.eventId);
        if (!event) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }
        if (event.userId !== ctx.userId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Unauthorized access to event",
          });
        }

        const log = await storage.createLog({
          ...input,
          startTime: input.startTime ? new Date(input.startTime) : new Date(),
          endTime: input.endTime ? new Date(input.endTime) : undefined,
        });

        return log;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create log",
          cause: error,
        });
      }
    }),

  // Update existing log
  update: logProcedure
    .input(updateLogSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...updateData } = input;

        const existingLog = await storage.getLog(id);
        if (!existingLog) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Log not found" });
        }

        // Check if user has access to the event this log belongs to
        const event = await storage.getEvent(existingLog.eventId);
        if (!event || event.userId !== ctx.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        const updatedLog = await storage.updateLog(id, {
          ...updateData,
          endTime: updateData.endTime
            ? new Date(updateData.endTime)
            : undefined,
        });

        return updatedLog;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update log",
          cause: error,
        });
      }
    }),

  // Delete log
  delete: logProcedure.input(logIdSchema).mutation(async ({ ctx, input }) => {
    try {
      const log = await storage.getLog(input.id);
      if (!log) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Log not found" });
      }

      // Check if user has access to the event this log belongs to
      const event = await storage.getEvent(log.eventId);
      if (!event || event.userId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      await storage.deleteLog(input.id);
      return { success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to delete log",
        cause: error,
      });
    }
  }),

  // Search logs by content
  search: logProcedure.input(logSearchSchema).query(async ({ ctx, input }) => {
    try {
      // Build search filters
      const filters: any = {
        userId: ctx.userId,
        search: input.query,
        searchFields: input.searchFields,
        caseSensitive: input.caseSensitive,
        regex: input.regex,
      };

      if (input.eventId) filters.eventId = input.eventId;
      if (input.workflowId) filters.workflowId = input.workflowId;
      if (input.status) filters.status = input.status;

      // For now, use the existing filtered logs method with search
      const page = Math.floor(input.offset / input.limit) + 1;
      const { logs, total } = await storage.getFilteredLogs(
        filters,
        input.limit,
        page,
      );

      return {
        logs,
        total,
        hasMore: input.offset + input.limit < total,
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to search logs",
        cause: error,
      });
    }
  }),

  // Get logs for a specific workflow
  getWorkflowLogs: logProcedure
    .input(workflowLogsSchema)
    .query(async ({ ctx, input }) => {
      try {
        let workflowId = input.workflowId;

        // If executionId is provided, get the workflow from the execution
        if (input.executionId) {
          const execution = await storage.getWorkflowExecution(
            input.executionId,
          );
          if (!execution) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Workflow execution not found",
            });
          }
          workflowId = execution.workflowId;
        }

        if (!workflowId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Either workflowId or executionId must be provided",
          });
        }

        // Check if user has access to this workflow
        const workflow = await storage.getWorkflow(workflowId);
        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }
        if (workflow.userId !== ctx.userId && !workflow.shared) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        // Get workflow logs
        const { logs } = await storage.getWorkflowLogs(
          workflowId,
          input.limit,
          Math.floor(input.offset / input.limit) + 1,
        );

        // Filter by status if provided
        const filteredLogs = input.status
          ? logs.filter((log) => log.status === input.status)
          : logs;

        return {
          logs: filteredLogs,
          total: filteredLogs.length,
          hasMore: input.offset + input.limit < filteredLogs.length,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch workflow logs",
          cause: error,
        });
      }
    }),

  // Get log statistics
  getStats: logProcedure.input(logStatsSchema).query(async ({ ctx, input }) => {
    try {
      // Build filters for user's logs
      const filters: any = { userId: ctx.userId };
      if (input.eventId) filters.eventId = input.eventId;
      if (input.workflowId) filters.workflowId = input.workflowId;
      if (input.startDate) filters.startDate = input.startDate;
      if (input.endDate) filters.endDate = input.endDate;

      // For now, get all logs and calculate stats
      const { logs } = await storage.getFilteredLogs(filters, 1000, 1);

      const stats = {
        total: logs.length,
        success: logs.filter((log) => log.status === LogStatus.SUCCESS).length,
        failure: logs.filter((log) => log.status === LogStatus.FAILURE).length,
        running: logs.filter((log) => log.status === LogStatus.RUNNING).length,
        successRate: 0,
        failureRate: 0,
        averageDuration: 0,
      };

      if (stats.total > 0) {
        stats.successRate = Math.round((stats.success / stats.total) * 100);
        stats.failureRate = Math.round((stats.failure / stats.total) * 100);

        const completedLogs = logs.filter(
          (log) => log.duration && log.duration > 0,
        );
        if (completedLogs.length > 0) {
          const totalDuration = completedLogs.reduce(
            (sum, log) => sum + (log.duration || 0),
            0,
          );
          stats.averageDuration = Math.round(
            totalDuration / completedLogs.length,
          );
        }
      }

      return stats;
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get log statistics",
        cause: error,
      });
    }
  }),

  // Admin-only endpoints
  // Get all logs (admin)
  getAllAdmin: adminLogProcedure
    .input(adminLogsQuerySchema)
    .query(async ({ ctx, input }) => {
      try {
        const filters: any = {};

        // Admin can filter by specific user
        if (input.userId && !input.allUsers) {
          filters.userId = input.userId;
        }

        // Add other filters
        if (input.eventId) filters.eventId = input.eventId;
        if (input.status) filters.status = input.status;
        if (input.level) filters.level = input.level;
        if (input.date) filters.date = input.date;
        if (input.startDate) filters.startDate = input.startDate;
        if (input.endDate) filters.endDate = input.endDate;

        const page = input.page || Math.floor(input.offset / input.limit) + 1;
        const { logs, total } = await storage.getAllLogs(input.limit, page);

        return {
          logs,
          total,
          page,
          pageSize: input.limit,
          totalPages: Math.ceil(total / input.limit),
          hasMore: page * input.limit < total,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch admin logs",
          cause: error,
        });
      }
    }),

  // Bulk operations on logs
  bulkOperation: logProcedure
    .input(bulkLogOperationSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const results = [];

        for (const logId of input.logIds) {
          try {
            const log = await storage.getLog(logId);
            if (!log) {
              results.push({
                id: logId,
                success: false,
                error: "Log not found",
              });
              continue;
            }

            // Check if user has access to the event this log belongs to
            const event = await storage.getEvent(log.eventId);
            if (!event || event.userId !== ctx.userId) {
              results.push({
                id: logId,
                success: false,
                error: "Access denied",
              });
              continue;
            }

            switch (input.operation) {
              case "delete":
                await storage.deleteLog(logId);
                results.push({ id: logId, success: true });
                break;
              case "export":
                // Mark as successful for export - actual data handled separately
                results.push({ id: logId, success: true });
                break;
              case "archive":
                // TODO: Implement archive functionality
                results.push({
                  id: logId,
                  success: true,
                  message: "Archive functionality not yet implemented",
                });
                break;
            }
          } catch (error) {
            results.push({
              id: logId,
              success: false,
              error: (error as Error).message,
            });
          }
        }

        return { results };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to perform bulk operation",
          cause: error as Error,
        });
      }
    }),
});
