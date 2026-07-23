/**
 * Workflows Router
 *
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
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
  WorkflowTriggerType,
  workflowExecutions,
  workflows,
} from "@shared/schema";
import { db } from "@/server/db";
import { eq, desc, sql } from "drizzle-orm";
import { newWorkflowWebhookKeyFields as newWebhookKeyFields } from "@/lib/workflow-webhook-key";
import {
  assertWorkflowCapability,
  assertWorkflowDefinition,
  assertWorkflowGraphCapability,
} from "@/server/security/resource-access";
import {
  toWorkflowApiDto,
  toWorkflowListApiDto,
} from "@/server/security/api-dto";

// Use centralized authentication from trpc.ts

export const workflowsRouter = createTRPCRouter({
  // Get all workflows for user
  getAll: protectedProcedure
    .input(workflowQuerySchema)
    .query(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          const result = await storage.queryWorkflows(
            ctx.session.user.id,
            input,
          );

          return {
            workflows: result.items.map((workflow) =>
              toWorkflowListApiDto(workflow, ctx.session.user.id),
            ),
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
          await assertWorkflowGraphCapability(
            input.id,
            ctx.session.user.id,
            "view",
          );
          const workflow = await storage.getWorkflowWithRelations(input.id);
          if (!workflow) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Workflow not found",
            });
          }

          return resourceResponse(
            toWorkflowApiDto(workflow, ctx.session.user.id),
          );
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
          // A caller-supplied webhookKey is ignored: the key is generated
          // server-side with high entropy so it is unguessable and unique
          // (HI-12). Never trust a client-chosen key.
          const {
            nodes,
            edges,
            webhookKey: _ignoredWebhookKey,
            ...workflowData
          } = input;
          await assertWorkflowDefinition(
            ctx.session.user.id,
            nodes.map((node) => node.data.eventId),
            input.overrideServerIds,
          );

          // Add user ID to workflow data. WEBHOOK workflows get a fresh
          // server-generated key; only its hash is stored, the plaintext is
          // returned once below.
          const keyFields =
            input.triggerType === WorkflowTriggerType.WEBHOOK
              ? newWebhookKeyFields()
              : null;
          const workflowToCreate = {
            ...workflowData,
            userId: ctx.session.user.id,
            webhookKey: keyFields?.webhookKey ?? null,
            webhookKeyHash: keyFields?.webhookKeyHash ?? null,
            // Provenance (e.g. "mcp") for workflows created by an AI agent.
            source: ctx.requestSource ?? null,
          };

          // Create the workflow
          const workflow = await storage.createWorkflow(workflowToCreate);

          if (ctx.requestSource === "mcp") {
            console.log(
              `[MCP-AUDIT] user=${ctx.session.user.id} created workflow #${workflow.id} "${workflow.name}" via mcp`,
            );
          }

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

            if (sourceNodeDbId !== undefined && targetNodeDbId !== undefined) {
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

          const dto = completeWorkflow
            ? toWorkflowApiDto(completeWorkflow, ctx.session.user.id)
            : completeWorkflow;
          return mutationResponse(
            // Surface the plaintext key exactly once, on creation.
            dto && keyFields
              ? { ...dto, webhookKey: keyFields.plaintext }
              : dto,
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
        // A caller-supplied webhookKey is ignored (see create); the key is
        // server-generated and never overwritten by client input (HI-12).
        const {
          id,
          nodes,
          edges,
          webhookKey: _ignoredWebhookKey,
          ...workflowData
        } = input;

        // Check if user owns the workflow
        const existingWorkflow = await storage.getWorkflow(id);
        if (!existingWorkflow) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Workflow not found",
          });
        }
        await assertWorkflowCapability(id, ctx.session.user.id, "edit");

        // Ensure a WEBHOOK-triggered workflow always has a strong key: mint one
        // when switching to (or already on) WEBHOOK without an existing key.
        const effectiveTriggerType =
          input.triggerType ?? existingWorkflow.triggerType;
        const ensureWebhookKey =
          effectiveTriggerType === WorkflowTriggerType.WEBHOOK &&
          !existingWorkflow.webhookKeyHash;

        const proposedNodes =
          nodes ??
          (await storage.getWorkflowNodes(id)).map((node) => ({
            data: { eventId: node.eventId },
          }));
        const proposedOverrideServerIds =
          workflowData.overrideServerIds ??
          (Array.isArray(existingWorkflow.overrideServerIds)
            ? existingWorkflow.overrideServerIds.filter(
                (value): value is number =>
                  Number.isInteger(value) && Number(value) > 0,
              )
            : []);
        await assertWorkflowDefinition(
          ctx.session.user.id,
          proposedNodes.map((node) => node.data.eventId),
          proposedOverrideServerIds,
        );

        // Update workflow properties
        let mintedWebhookKey: string | null = null;
        if (Object.keys(workflowData).length > 0 || ensureWebhookKey) {
          // Filter out null values to match the expected Partial<InsertWorkflow> type
          const filteredWorkflowData = Object.fromEntries(
            Object.entries(workflowData).filter(([_, value]) => value !== null),
          ) as Partial<InsertWorkflow>;

          if (ensureWebhookKey) {
            const keyFields = newWebhookKeyFields();
            filteredWorkflowData.webhookKey = keyFields.webhookKey;
            filteredWorkflowData.webhookKeyHash = keyFields.webhookKeyHash;
            mintedWebhookKey = keyFields.plaintext;
          }

          await storage.updateWorkflow(id, filteredWorkflowData);
        }

        // If nodes are provided, update the workflow structure. Edges can only
        // be applied together with the nodes array (edge source/target are
        // ReactFlow ids that exist only in the submitted nodes), so an
        // edges-only payload must NOT wipe the persisted graph.
        if (nodes !== undefined) {
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

              if (
                sourceNodeDbId !== undefined &&
                targetNodeDbId !== undefined
              ) {
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
        const dto = updatedWorkflow
          ? toWorkflowApiDto(updatedWorkflow, ctx.session.user.id)
          : updatedWorkflow;
        // Surface a newly-minted key exactly once.
        return dto && mintedWebhookKey
          ? { ...dto, webhookKey: mintedWebhookKey }
          : dto;
      } catch (error: unknown) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update workflow",
          cause: error,
        });
      }
    }),

  // Rotate the webhook key for a WEBHOOK-triggered workflow. Returns the new
  // plaintext key exactly once; only its hash is stored.
  rotateWebhookKey: protectedProcedure
    .input(workflowIdSchema)
    .mutation(async ({ ctx, input }) => {
      const workflow = await storage.getWorkflow(input.id);
      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }
      await assertWorkflowCapability(input.id, ctx.session.user.id, "edit");
      if (workflow.triggerType !== WorkflowTriggerType.WEBHOOK) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This workflow is not webhook-triggered.",
        });
      }
      const keyFields = newWebhookKeyFields();
      await storage.updateWorkflow(input.id, {
        webhookKey: keyFields.webhookKey,
        webhookKeyHash: keyFields.webhookKeyHash,
      });
      return { webhookKey: keyFields.plaintext };
    }),

  // Delete workflow
  delete: protectedProcedure
    .input(workflowIdSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await assertWorkflowCapability(input.id, ctx.session.user.id, "edit");

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
        await assertWorkflowGraphCapability(
          input.id,
          ctx.session.user.id,
          "execute",
        );

        // Event-sourced engine: creates the run + step rows and dispatches
        // the starting nodes; the scheduling worker advances it to completion.
        const { startWorkflowRun } =
          await import("@/lib/scheduling/workflow-engine");
        const { WorkflowTriggerType } = await import("@/shared/schema");

        const result = await startWorkflowRun(input.id, {
          userId: ctx.session.user.id,
          triggerType: WorkflowTriggerType.MANUAL,
          input: input.payload,
        });

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
          // Execution history can contain secret-derived input/output and is
          // never included in a view-only share.
          await assertWorkflowCapability(
            input.id,
            ctx.session.user.id,
            "execute",
          );

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
            executions: userExecutions,
            hasMore: userExecutions.total > input.offset + input.limit,
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
        await assertWorkflowCapability(
          input.id,
          ctx.session.user.id,
          "execute",
        );

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
        await assertWorkflowCapability(input.id, ctx.session.user.id, "edit");

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
            await assertWorkflowCapability(
              workflowId,
              ctx.session.user.id,
              "edit",
            );

            if (input.operation === "activate") {
              await assertWorkflowGraphCapability(
                workflowId,
                ctx.session.user.id,
                "execute",
              );
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
        await assertWorkflowCapability(
          input.workflowId,
          ctx.session.user.id,
          "execute",
        );

        // Get execution details
        const execution = await storage.getWorkflowExecution(input.executionId);
        if (execution?.workflowId !== input.workflowId) {
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

        // Single workflow JSON download
        if (allowedWorkflowIds.length === 1) {
          await assertWorkflowGraphCapability(
            allowedWorkflowIds[0]!,
            ctx.session.user.id,
            "view",
          );
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
            data: JSON.stringify(
              toWorkflowApiDto(workflow, ctx.session.user.id),
              null,
              2,
            ),
          };
        }

        // Multiple workflows JSON download
        await Promise.all(
          allowedWorkflowIds.map((id) =>
            assertWorkflowGraphCapability(id, ctx.session.user.id, "view"),
          ),
        );
        const workflows = await Promise.all(
          allowedWorkflowIds.map((id) => storage.getWorkflowWithRelations(id)),
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
          data: JSON.stringify(
            validWorkflows.map((workflow) =>
              toWorkflowApiDto(workflow, ctx.session.user.id),
            ),
            null,
            2,
          ),
        };
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
