/**
 * Workflows Router
 *
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  normalizePagination,
  createPaginatedResult,
  checkResourceAccess,
} from "@/server/utils/db-patterns";
import { withErrorHandling } from "@/server/utils/error-utils";
import {
  mutationResponse,
  resourceResponse,
} from "@/server/utils/api-patterns";
import type { InsertWorkflow } from "../../../shared/schema";
import {
  createWorkflowSchema,
  updateWorkflowSchema,
  workflowQuerySchema,
  workflowIdSchema,
  executeWorkflowSchema,
  workflowExecutionsSchema,
  workflowLogsSchema,
  bulkWorkflowOperationSchema,
  workflowDownloadSchema,
  workflowFilterSchema,
} from "@shared/schemas/workflows";
import { storage, type WorkflowWithRelations } from "@/server/storage";
import {
  EventStatus,
  LogStatus,
  workflowExecutions,
  workflows,
} from "@shared/schema";
import { db } from "@/server/db";
import { eq, desc, sql } from "drizzle-orm";

// Use centralized authentication from trpc.ts

export const workflowsRouter = createTRPCRouter({
  // Get all workflows for user
  getAll: protectedProcedure
    .input(workflowQuerySchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const userId = ctx.session.user.id;
          const pagination = normalizePagination(input);

          // Direct storage call without caching
          const workflows = await storage.getAllWorkflows(userId);

          // Apply filters
          let filteredWorkflows = workflows;

          if (input.search) {
            const searchLower = input.search.toLowerCase();
            filteredWorkflows = filteredWorkflows.filter(
              (workflow) =>
                workflow.name.toLowerCase().includes(searchLower) ||
                workflow.description?.toLowerCase().includes(searchLower),
            );
          }

          if (input.status) {
            filteredWorkflows = filteredWorkflows.filter(
              (workflow) => workflow.status === input.status,
            );
          }

          if (input.triggerType) {
            filteredWorkflows = filteredWorkflows.filter(
              (workflow) => workflow.triggerType === input.triggerType,
            );
          }

          if (input.shared !== undefined) {
            filteredWorkflows = filteredWorkflows.filter(
              (workflow) => workflow.shared === input.shared,
            );
          }

          // Apply pagination in memory (should be moved to database level)
          const paginatedWorkflows = filteredWorkflows.slice(
            pagination.offset,
            pagination.offset + pagination.limit,
          );

          const result = createPaginatedResult(
            paginatedWorkflows,
            filteredWorkflows.length,
            pagination,
          );

          // Return in the format the frontend expects
          return {
            workflows: result.items,
            total: result.total,
            hasMore: result.hasMore,
          };
        },
        {
          component: "workflowsRouter",
          operationName: "getAll",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get single workflow by ID with relations
  getById: protectedProcedure
    .input(workflowIdSchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const workflow = await storage.getWorkflowWithRelations(input.id);
          const accessibleWorkflow = await checkResourceAccess(
            workflow ?? undefined,
            ctx.session.user.id,
            "workflow",
          );

          return resourceResponse(accessibleWorkflow);
        },
        {
          component: "workflowsRouter",
          operationName: "getById",
          userId: ctx.session.user.id,
          metadata: { workflowId: input.id },
        },
      );
    }),

  // Create new workflow
  create: protectedProcedure
    .input(createWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const { nodes, edges, ...workflowData } = input;

          // Add user ID to workflow data
          const workflowToCreate = {
            ...workflowData,
            userId: ctx.session.user.id,
          };

          // Create the workflow
          const workflow = await storage.createWorkflow(workflowToCreate);

          // Create workflow nodes
          const nodeIdMap = new Map<string, number>(); // ReactFlow ID -> DB ID
          for (const node of nodes) {
            const dbNode = await storage.createWorkflowNode({
              workflowId: workflow.id,
              eventId: node.data.eventId,
              position_x: node.position.x,
              position_y: node.position.y,
            });
            nodeIdMap.set(node.id, dbNode.id);
          }

          // Create workflow connections
          for (const edge of edges) {
            const sourceNodeDbId = nodeIdMap.get(edge.source);
            const targetNodeDbId = nodeIdMap.get(edge.target);

            if (sourceNodeDbId && targetNodeDbId) {
              await storage.createWorkflowConnection({
                workflowId: workflow.id,
                sourceNodeId: sourceNodeDbId,
                targetNodeId: targetNodeDbId,
                connectionType: edge.data.connectionType,
              });
            }
          }

          // Get the complete workflow with relations
          const completeWorkflow = await storage.getWorkflowWithRelations(
            workflow.id,
          );

          return mutationResponse(
            completeWorkflow,
            "Workflow created successfully",
          );
        },
        {
          component: "workflowsRouter",
          operationName: "create",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Update existing workflow
  update: protectedProcedure
    .input(updateWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, nodes, edges, ...workflowData } = input;

        // Check if user owns the workflow
        const existingWorkflow = await storage.getWorkflow(id);
        if (!existingWorkflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }
        if (existingWorkflow.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to edit this workflow",
          });
        }

        // Update workflow properties
        if (Object.keys(workflowData).length > 0) {
          // Filter out null values to match the expected Partial<InsertWorkflow> type
          const filteredWorkflowData = Object.fromEntries(
            Object.entries(workflowData).filter(([_, value]) => value !== null),
          ) as Partial<InsertWorkflow>;

          await storage.updateWorkflow(id, filteredWorkflowData);
        }

        // If nodes and edges are provided, update the workflow structure
        if (nodes !== undefined || edges !== undefined) {
          // Delete existing nodes and connections
          const existingNodes = await storage.getWorkflowNodes(id);
          for (const node of existingNodes) {
            await storage.deleteWorkflowNode(node.id);
          }

          const existingConnections = await storage.getWorkflowConnections(id);
          for (const connection of existingConnections) {
            await storage.deleteWorkflowConnection(connection.id);
          }

          // Create new nodes
          const nodeIdMap = new Map<string, number>();
          if (nodes) {
            for (const node of nodes) {
              const dbNode = await storage.createWorkflowNode({
                workflowId: id,
                eventId: node.data.eventId,
                position_x: node.position.x,
                position_y: node.position.y,
              });
              nodeIdMap.set(node.id, dbNode.id);
            }
          }

          // Create new connections
          if (edges && nodes) {
            for (const edge of edges) {
              const sourceNodeDbId = nodeIdMap.get(edge.source);
              const targetNodeDbId = nodeIdMap.get(edge.target);

              if (sourceNodeDbId && targetNodeDbId) {
                await storage.createWorkflowConnection({
                  workflowId: id,
                  sourceNodeId: sourceNodeDbId,
                  targetNodeId: targetNodeDbId,
                  connectionType: edge.data.connectionType,
                });
              }
            }
          }
        }

        // Get the updated workflow with relations
        const updatedWorkflow = await storage.getWorkflowWithRelations(id);
        return updatedWorkflow;
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update workflow",
          cause: error,
        });
      }
    }),

  // Delete workflow
  delete: protectedProcedure
    .input(workflowIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if user owns the workflow
        const workflow = await storage.getWorkflow(input.id);
        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }
        if (workflow.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to delete this workflow",
          });
        }

        await storage.deleteWorkflow(input.id);
        return { success: true };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete workflow",
          cause: error,
        });
      }
    }),

  // Execute workflow
  execute: protectedProcedure
    .input(executeWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if user can access the workflow
        const workflow = await storage.getWorkflow(input.id);
        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }
        if (workflow.userId !== ctx.session.user.id && !workflow.shared) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        // Import and use workflow executor
        const { workflowExecutor } = await import("@/lib/workflow-executor");

        // Execute the workflow (it will create its own execution record)
        const result = await workflowExecutor.executeWorkflow(
          input.id,
          ctx.session.user.id,
          input.payload,
        );

        return result;
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to execute workflow",
          cause: error,
        });
      }
    }),

  // Get workflow executions
  getExecutions: protectedProcedure
    .input(workflowExecutionsSchema)
    .query(async ({ ctx, input }) => {
      try {
        if (input.id) {
          // Get executions for specific workflow
          const workflow = await storage.getWorkflow(input.id);
          if (!workflow) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Workflow not found",
            });
          }
          if (workflow.userId !== ctx.session.user.id && !workflow.shared) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Access denied",
            });
          }

          const executions = await storage.getWorkflowExecutions(
            input.id,
            input.limit,
            Math.floor(input.offset / input.limit) + 1, // Convert offset to page number
          );

          return {
            executions,
            hasMore: executions.executions.length === input.limit,
          };
        } else {
          // Get all workflow executions for the user with workflow names
          // Direct database query since storage method isn't available
          const limit = input.limit;
          const offset = input.offset;

          const executions = await db
            .select({
              id: workflowExecutions.id,
              workflowId: workflowExecutions.workflowId,
              userId: workflowExecutions.userId,
              status: workflowExecutions.status,
              triggerType: workflowExecutions.triggerType,
              startedAt: workflowExecutions.startedAt,
              completedAt: workflowExecutions.completedAt,
              totalDuration: workflowExecutions.totalDuration,
              totalEvents: workflowExecutions.totalEvents,
              successfulEvents: workflowExecutions.successfulEvents,
              failedEvents: workflowExecutions.failedEvents,
              executionData: workflowExecutions.executionData,
              createdAt: workflowExecutions.createdAt,
              updatedAt: workflowExecutions.updatedAt,
              workflowName: workflows.name,
            })
            .from(workflowExecutions)
            .leftJoin(
              workflows,
              eq(workflowExecutions.workflowId, workflows.id),
            )
            .where(eq(workflowExecutions.userId, ctx.session.user.id))
            .orderBy(desc(workflowExecutions.startedAt))
            .limit(limit)
            .offset(offset);

          // Get total count
          const [totalResult] = await db
            .select({ count: sql`count(*)::int` })
            .from(workflowExecutions)
            .where(eq(workflowExecutions.userId, ctx.session.user.id));

          const totalCount = Number(totalResult?.count ?? 0);

          const userExecutions = {
            executions,
            total: totalCount,
          };

          return {
            executions: userExecutions.executions,
            hasMore: userExecutions.total > input.offset + input.limit,
            total: userExecutions.total,
          };
        }
      } catch (error: unknown) {
        console.error("Error fetching workflow executions:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch workflow executions",
          cause: error,
        });
      }
    }),

  // Get workflow logs
  getLogs: protectedProcedure
    .input(workflowLogsSchema)
    .query(async ({ ctx, input }) => {
      try {
        // Check if user can access the workflow
        const workflow = await storage.getWorkflow(input.id);
        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }
        if (workflow.userId !== ctx.session.user.id && !workflow.shared) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        const logs = await storage.getWorkflowLogs(
          input.id,
          input.limit,
          Math.floor(input.offset / input.limit) + 1, // Convert offset to page number
        );

        return {
          logs: logs.logs,
          hasMore: logs.logs.length === input.limit,
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch workflow logs",
          cause: error,
        });
      }
    }),

  // Archive workflow
  archive: protectedProcedure
    .input(workflowIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if user owns the workflow
        const workflow = await storage.getWorkflow(input.id);
        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }
        if (workflow.userId !== ctx.session.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Not authorized to archive this workflow",
          });
        }

        // Archive the workflow
        await storage.updateWorkflow(input.id, {
          status: EventStatus.ARCHIVED,
          updatedAt: new Date(),
        });

        return { success: true, message: "Workflow archived successfully" };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to archive workflow",
          cause: error,
        });
      }
    }),

  // Bulk operations on workflows
  bulkOperation: protectedProcedure
    .input(bulkWorkflowOperationSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        type BulkOperationResult =
          | { id: number; success: true }
          | { id: number; success: false; error: string };

        const results: BulkOperationResult[] = [];

        for (const workflowId of input.workflowIds) {
          try {
            // Check if user owns the workflow
            const workflow = await storage.getWorkflow(workflowId);
            if (!workflow || workflow.userId !== ctx.session.user.id) {
              results.push({
                id: workflowId,
                success: false,
                error: "Access denied",
              });
              continue;
            }

            switch (input.operation) {
              case "archive":
                await storage.updateWorkflow(workflowId, {
                  status: EventStatus.ARCHIVED,
                });
                break;
              case "delete":
                await storage.deleteWorkflow(workflowId);
                break;
              case "activate":
                await storage.updateWorkflow(workflowId, {
                  status: EventStatus.ACTIVE,
                });
                break;
              case "pause":
                await storage.updateWorkflow(workflowId, {
                  status: EventStatus.PAUSED,
                });
                break;
            }

            results.push({ id: workflowId, success: true });
          } catch (error: unknown) {
            results.push({
              id: workflowId,
              success: false,
              error:
                typeof error === "object" &&
                error !== null &&
                "message" in error &&
                typeof error.message === "string"
                  ? error.message
                  : "Unknown error",
            });
          }
        }

        return { results };
      } catch (error: unknown) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to perform bulk operation",
          cause: error,
        });
      }
    }),

  // Get workflow execution details
  getExecution: protectedProcedure
    .input(
      z.object({
        workflowId: z.number(),
        executionId: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        // Check if user has access to this workflow
        const workflow = await storage.getWorkflow(input.workflowId);
        if (!workflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }

        // Check access permissions
        if (workflow.userId !== ctx.session.user.id && !workflow.shared) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        // Get execution details
        const execution = await storage.getWorkflowExecution(input.executionId);
        if (!execution || execution.workflowId !== input.workflowId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Execution not found",
          });
        }

        // Get execution events
        const events = await storage.getWorkflowExecutionEvents(
          input.executionId,
        );

        // Calculate execution statistics
        const totalEvents = events.length;
        const successfulEvents = events.filter(
          (event) => event.status === LogStatus.SUCCESS,
        ).length;
        const failedEvents = events.filter(
          (event) =>
            event.status === LogStatus.FAILURE ||
            event.status === LogStatus.TIMEOUT,
        ).length;

        // Return detailed execution with statistics
        return {
          ...execution,
          totalEvents,
          successfulEvents,
          failedEvents,
          events,
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch execution details",
          cause: error,
        });
      }
    }),

  // Download workflows
  download: protectedProcedure
    .input(workflowDownloadSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check permissions for all workflows
        const userWorkflows = await storage.getAllWorkflows(
          ctx.session.user.id,
        );
        const userWorkflowIds = userWorkflows.map((w) => w.id);
        const allowedWorkflowIds = input.workflowIds.filter((id) =>
          userWorkflowIds.includes(id),
        );

        if (allowedWorkflowIds.length === 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "No authorized workflows found",
          });
        }

        if (input.format === "json") {
          // Single workflow JSON download
          if (allowedWorkflowIds.length === 1) {
            const workflow = await storage.getWorkflowWithRelations(
              allowedWorkflowIds[0]!,
            );
            if (!workflow) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Workflow not found",
              });
            }
            return {
              format: "json",
              filename: `${workflow.name}.json`,
              data: JSON.stringify(workflow, null, 2),
            };
          }

          // Multiple workflows JSON download
          const workflows = await Promise.all(
            allowedWorkflowIds.map((id) =>
              storage.getWorkflowWithRelations(id),
            ),
          );
          // Filter out any null workflows
          const validWorkflows = workflows.filter(
            (workflow): workflow is WorkflowWithRelations => workflow !== null,
          );
          if (validWorkflows.length === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "No workflows found",
            });
          }
          return {
            format: "json",
            filename: "workflows.json",
            data: JSON.stringify(validWorkflows, null, 2),
          };
        } else {
          // ZIP download
          throw new TRPCError({
            code: "NOT_IMPLEMENTED",
            message: "ZIP download not implemented in tRPC - use REST endpoint",
          });
        }
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to download workflows",
          cause: error,
        });
      }
    }),

  // Get lightweight workflow data for filters/dropdowns
  getForFilters: protectedProcedure
    .input(workflowFilterSchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const userId = ctx.session.user.id;

          // Get all workflows for the user
          const workflows = await storage.getAllWorkflows(userId);

          // Apply filters if provided
          let filteredWorkflows = workflows;

          if (input.search) {
            const searchLower = input.search.toLowerCase();
            filteredWorkflows = filteredWorkflows.filter((workflow) =>
              workflow.name.toLowerCase().includes(searchLower),
            );
          }

          if (input.status) {
            filteredWorkflows = filteredWorkflows.filter(
              (workflow) => workflow.status === input.status,
            );
          }

          // Apply pagination
          const start = input.offset;
          const end = start + input.limit;
          const paginatedWorkflows = filteredWorkflows.slice(start, end);

          // Return only id and name for each workflow
          const lightweightWorkflows = paginatedWorkflows.map((workflow) => ({
            id: workflow.id,
            name: workflow.name,
          }));

          return {
            workflows: lightweightWorkflows,
            total: filteredWorkflows.length,
            hasMore: end < filteredWorkflows.length,
          };
        },
        {
          component: "workflowsRouter",
          operationName: "getForFilters",
          userId: ctx.session.user.id,
        },
      );
    }),
});
