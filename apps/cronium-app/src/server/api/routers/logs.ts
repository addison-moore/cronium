import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../trpc";
import { normalizePagination } from "@/server/utils/db-patterns";
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
import { storage, type LogFilters } from "@/server/storage";
import { LogStatus } from "@shared/schema";

// Use centralized authentication from trpc.ts

export const logsRouter = createTRPCRouter({
  // Get logs for current user
  getAll: protectedProcedure
    .input(logsQuerySchema)
    .query(async ({ ctx, input }) => {
      try {
        // Build filter object for database query
        const filters: LogFilters = {
          userId: ctx.session.user.id,
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
          if (event.userId !== ctx.session.user.id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Unauthorized access to event",
            });
          }
          filters.eventId = String(input.eventId);
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

        // Normalize pagination
        const pagination = normalizePagination(input);

        // Use page/pageSize if provided, otherwise use limit/offset
        const limit = input.pageSize ?? pagination.limit;
        const page = input.page ?? Math.floor(pagination.offset / limit) + 1;

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
  getById: protectedProcedure
    .input(logIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        const log = await storage.getLog(input.id);
        if (!log) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Log not found" });
        }

        // Check if user has access to the event this log belongs to
        const event = await storage.getEvent(log.eventId);
        if (!event) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        }
        if (event.userId !== ctx.session.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        // Return log with additional event info
        return {
          ...log,
          eventName: event.name ?? "Unknown",
          scriptContent: event.content ?? "",
          eventType: event.type,
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
  create: protectedProcedure
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
        if (event.userId !== ctx.session.user.id) {
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
  update: protectedProcedure
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
        if (!event || event.userId !== ctx.session.user.id) {
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
  delete: protectedProcedure
    .input(logIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const log = await storage.getLog(input.id);
        if (!log) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Log not found" });
        }

        // Check if user has access to the event this log belongs to
        const event = await storage.getEvent(log.eventId);
        if (!event || event.userId !== ctx.session.user.id) {
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
  search: protectedProcedure
    .input(logSearchSchema)
    .query(async ({ ctx, input }) => {
      try {
        // Build search filters
        const filters: LogFilters & {
          search?: string;
          searchFields?: string[];
          caseSensitive?: boolean;
          regex?: boolean;
        } = {
          userId: ctx.session.user.id,
        };

        if (input.eventId) filters.eventId = String(input.eventId);
        if (input.workflowId) filters.workflowId = input.workflowId;
        if (input.status) filters.status = input.status;

        // Note: search functionality is not yet implemented in storage
        // These fields are included for future implementation
        if (input.query) {
          filters.search = input.query;
          filters.searchFields = input.searchFields;
          filters.caseSensitive = input.caseSensitive;
          filters.regex = input.regex;
        }

        // For now, use the existing filtered logs method with search
        const pagination = normalizePagination(input);
        const page = Math.floor(pagination.offset / pagination.limit) + 1;
        const { logs, total } = await storage.getFilteredLogs(
          filters,
          pagination.limit,
          page,
        );

        return {
          logs,
          total,
          hasMore: pagination.offset + pagination.limit < total,
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
  getWorkflowLogs: protectedProcedure
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
        if (workflow.userId !== ctx.session.user.id && !workflow.shared) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        // Get workflow logs
        const pagination = normalizePagination(input);
        const { logs } = await storage.getWorkflowLogs(
          workflowId,
          pagination.limit,
          Math.floor(pagination.offset / pagination.limit) + 1,
        );

        // Filter by status if provided
        const filteredLogs = input.status
          ? logs.filter((log) => log.status === input.status)
          : logs;

        return {
          logs: filteredLogs,
          total: filteredLogs.length,
          hasMore: pagination.offset + pagination.limit < filteredLogs.length,
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
  getStats: protectedProcedure
    .input(logStatsSchema)
    .query(async ({ ctx, input }) => {
      try {
        // Build filters for user's logs
        const filters: LogFilters & {
          startDate?: string;
          endDate?: string;
        } = { userId: ctx.session.user.id };
        if (input.eventId) filters.eventId = String(input.eventId);
        if (input.workflowId) filters.workflowId = input.workflowId;
        // Note: startDate/endDate filtering is not yet implemented in storage
        if (input.startDate) filters.startDate = input.startDate;
        if (input.endDate) filters.endDate = input.endDate;

        // For now, get all logs and calculate stats
        const { logs } = await storage.getFilteredLogs(filters, 1000, 1);

        const stats = {
          total: logs.length,
          success: logs.filter((log) => log.status === LogStatus.SUCCESS)
            .length,
          failure: logs.filter((log) => log.status === LogStatus.FAILURE)
            .length,
          running: logs.filter((log) => log.status === LogStatus.RUNNING)
            .length,
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
              (sum, log) => sum + (log.duration ?? 0),
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
  getAllAdmin: adminProcedure
    .input(adminLogsQuerySchema)
    .query(async ({ input }) => {
      try {
        const filters: LogFilters & {
          level?: string;
          startDate?: string;
          endDate?: string;
        } = {};

        // Admin can filter by specific user
        if (input.userId && !input.allUsers) {
          filters.userId = input.userId;
        }

        // Add other filters
        if (input.eventId) filters.eventId = String(input.eventId);
        if (input.status) filters.status = input.status;
        if (input.level) filters.level = input.level;
        if (input.date) filters.date = input.date;
        if (input.startDate) filters.startDate = input.startDate;
        if (input.endDate) filters.endDate = input.endDate;

        const pagination = normalizePagination(input);
        const page =
          input.page ?? Math.floor(pagination.offset / pagination.limit) + 1;
        const { logs, total } = await storage.getAllLogs(
          pagination.limit,
          page,
        );

        return {
          logs,
          total,
          page,
          pageSize: pagination.limit,
          totalPages: Math.ceil(total / pagination.limit),
          hasMore: page * pagination.limit < total,
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
  bulkOperation: protectedProcedure
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
            if (!event || event.userId !== ctx.session.user.id) {
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
