import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
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
} from "@shared/schemas/workflows";
import {
  storage,
  type WorkflowWithRelations,
  type WorkflowExecution,
} from "@/server/storage";
import { EventStatus, LogStatus, UserRole } from "@shared/schema";
import { cachedQueries, cacheInvalidation } from "../middleware/cache";

// Custom procedure that handles auth for tRPC fetch adapter
const workflowProcedure = publicProcedure.use(async ({ ctx, next }) => {
  // Try to get session from headers/cookies
  let session = null;
  let userId = null;

  try {
    // If session exists in context, use it
    if (ctx.session?.user?.id) {
      session = ctx.session;
      userId = ctx.session.user.id;
    } else {
      if (process.env.NODE_ENV === "development") {
        const allUsers = await storage.getAllUsers();
        const adminUsers = allUsers.filter(
          (user) => user.role === UserRole.ADMIN,
        );
        if (adminUsers.length > 0) {
          userId = adminUsers[0]!.id;
          session = { user: { id: adminUsers[0]!.id } };
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
  } catch (error: unknown) {
    console.error("Auth error in workflowProcedure:", error);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication failed",
    });
  }
});

export const workflowsRouter = createTRPCRouter({
  // Get all workflows for user
  getAll: workflowProcedure
    .input(workflowQuerySchema)
    .query(async ({ ctx, input }) => {
      try {
        // Use cached query wrapper for workflow lists
        const result = await cachedQueries.workflowList(
          input,
          ctx.userId,
          async () => {
            const workflows = await storage.getAllWorkflows(ctx.userId);

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

            // Apply pagination
            const paginatedWorkflows = filteredWorkflows.slice(
              input.offset,
              input.offset + input.limit,
            );

            return {
              workflows: paginatedWorkflows,
              total: filteredWorkflows.length,
              hasMore: input.offset + input.limit < filteredWorkflows.length,
            };
          },
        );

        return result;
      } catch (error: unknown) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch workflows",
          cause: error,
        });
      }
    }),

  // Get single workflow by ID with relations
  getById: workflowProcedure
    .input(workflowIdSchema)
    .query(async ({ ctx, input }) => {
      try {
        // Use cached query wrapper for individual workflows
        const workflow = await cachedQueries.workflowById(
          { id: input.id },
          ctx.userId,
          async () => {
            const workflow = await storage.getWorkflowWithRelations(input.id);
            if (!workflow) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Workflow not found",
              });
            }

            // Check if user owns the workflow or it's shared
            if (workflow.userId !== ctx.userId && !workflow.shared) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "Access denied",
              });
            }

            return workflow;
          },
        );

        return workflow;
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch workflow",
          cause: error,
        });
      }
    }),

  // Create new workflow
  create: workflowProcedure
    .input(createWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { nodes, edges, ...workflowData } = input;

        // Add user ID to workflow data
        const workflowToCreate = {
          ...workflowData,
          userId: ctx.userId,
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
        return completeWorkflow;
      } catch (error: unknown) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create workflow",
          cause: error,
        });
      }
    }),

  // Update existing workflow
  update: workflowProcedure
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
        if (existingWorkflow.userId !== ctx.userId) {
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
  delete: workflowProcedure
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
        if (workflow.userId !== ctx.userId) {
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
  execute: workflowProcedure
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
        if (workflow.userId !== ctx.userId && !workflow.shared) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }

        // Create workflow execution record
        const _execution = await storage.createWorkflowExecution({
          workflowId: input.id,
          userId: ctx.userId,
          status: LogStatus.RUNNING,
          triggerType: input.manual ? "MANUAL" : "API",
          startedAt: new Date(),
          executionData: input.payload ?? {},
        });

        // Import and use workflow executor
        const { workflowExecutor } = await import("@/lib/workflow-executor");

        // Execute the workflow
        const result = await workflowExecutor.executeWorkflow(
          input.id,
          ctx.userId,
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
  getExecutions: workflowProcedure
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
          if (workflow.userId !== ctx.userId && !workflow.shared) {
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
          // Get all workflows for the user first
          const userWorkflows = await storage.getAllWorkflows(ctx.userId);

          if (userWorkflows.length === 0) {
            return {
              executions: { executions: [], total: 0 },
              hasMore: false,
            };
          }

          // Use optimized method to get all user workflow executions in a single query
          const userExecutions = await storage.getUserWorkflowExecutions(
            ctx.userId,
            input.limit,
            input.offset,
          );

          return {
            executions: userExecutions,
            hasMore: userExecutions.total > input.offset + input.limit,
          };
        }
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch workflow executions",
          cause: error,
        });
      }
    }),

  // Get workflow logs
  getLogs: workflowProcedure
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
        if (workflow.userId !== ctx.userId && !workflow.shared) {
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
  archive: workflowProcedure
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
        if (workflow.userId !== ctx.userId) {
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
  bulkOperation: workflowProcedure
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
            if (!workflow || workflow.userId !== ctx.userId) {
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
  getExecution: workflowProcedure
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
        if (workflow.userId !== ctx.userId && !workflow.shared) {
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
  download: workflowProcedure
    .input(workflowDownloadSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Check permissions for all workflows
        const userWorkflows = await storage.getAllWorkflows(ctx.userId);
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
});
