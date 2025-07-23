// Workflow core operations module
import {
  workflows,
  workflowNodes,
  workflowConnections,
  workflowLogs,
  type WorkflowNode,
  type WorkflowConnection,
  type Server,
  type ConditionalAction,
} from "../../../shared/schema";
import { db } from "../../db";
import { eq, and, inArray } from "drizzle-orm";
import type {
  Workflow,
  InsertWorkflow,
  WorkflowWithRelations,
  WorkflowNodeWithEvent,
  EventWithRelations,
} from "../types";

export class WorkflowStorage {
  async getWorkflow(id: number): Promise<Workflow | undefined> {
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, id));
    return workflow;
  }

  async getWorkflowWithRelations(
    id: number,
  ): Promise<WorkflowWithRelations | null> {
    // Fetch workflow with all relations in a single query
    const workflowWithRelations = await db.query.workflows.findFirst({
      where: eq(workflows.id, id),
      with: {
        nodes: {
          with: {
            event: {
              with: {
                envVars: true,
                server: true,
                eventServers: {
                  with: {
                    server: true,
                  },
                },
                onSuccessEvents: {
                  with: {
                    targetEvent: true,
                  },
                },
                onFailEvents: {
                  with: {
                    targetEvent: true,
                  },
                },
                onAlwaysEvents: {
                  with: {
                    targetEvent: true,
                  },
                },
              },
            },
          },
        },
        connections: true,
      },
    });

    if (!workflowWithRelations) return null;

    // Transform nodes to include properly structured event relations
    const nodesWithEvents: WorkflowNodeWithEvent[] =
      workflowWithRelations.nodes.map((node): WorkflowNodeWithEvent => {
        if (node.event) {
          // Transform event data to match EventWithRelations structure
          const servers =
            node.event.eventServers
              ?.map((es) => es.server)
              .filter((s): s is Server => s !== null) || [];
          const successEvents = node.event.onSuccessEvents || [];
          const failEvents = node.event.onFailEvents || [];
          const alwaysEvents = node.event.onAlwaysEvents || [];
          const conditionEvents: ConditionalAction[] = [];

          const eventWithRelations: EventWithRelations = {
            ...node.event,
            envVars: node.event.envVars ?? [],
            server: node.event.server ?? null,
            servers,
            successEvents,
            failEvents,
            alwaysEvents,
            conditionEvents,
          };

          return {
            ...node,
            event: eventWithRelations,
          };
        }
        // Return node without event property when event is not present
        return {
          ...node,
          event: undefined,
        };
      });

    return {
      ...workflowWithRelations,
      nodes: nodesWithEvents,
    };
  }

  async getAllWorkflows(userId: string): Promise<Workflow[]> {
    const userWorkflows = await db
      .select()
      .from(workflows)
      .where(eq(workflows.userId, userId))
      .orderBy(workflows.name);

    return userWorkflows;
  }

  async getWorkflowsUsingEvent(
    eventId: number,
    userId: string,
  ): Promise<Workflow[]> {
    // First get unique workflow IDs that use this event
    const workflowIds = await db
      .selectDistinct({
        workflowId: workflowNodes.workflowId,
      })
      .from(workflowNodes)
      .innerJoin(workflows, eq(workflowNodes.workflowId, workflows.id))
      .where(
        and(eq(workflowNodes.eventId, eventId), eq(workflows.userId, userId)),
      );

    // Then fetch the full workflow details
    if (workflowIds.length === 0) {
      return [];
    }

    const ids = workflowIds.map((w) => w.workflowId);
    const workflowsUsingEvent = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.userId, userId), inArray(workflows.id, ids)))
      .orderBy(workflows.name);

    return workflowsUsingEvent;
  }

  async createWorkflow(insertWorkflow: InsertWorkflow): Promise<Workflow> {
    const [workflow] = await db
      .insert(workflows)
      .values(insertWorkflow)
      .returning();

    if (!workflow) {
      throw new Error("Failed to create workflow");
    }
    return workflow;
  }

  async updateWorkflow(
    id: number,
    updateData: Partial<InsertWorkflow>,
  ): Promise<Workflow> {
    const [workflow] = await db
      .update(workflows)
      .set(updateData)
      .where(eq(workflows.id, id))
      .returning();

    if (!workflow) {
      throw new Error("Failed to update workflow - workflow not found");
    }
    return workflow;
  }

  async deleteWorkflow(id: number): Promise<void> {
    // Delete all nodes
    const nodes = await this.getWorkflowNodes(id);
    for (const node of nodes) {
      await this.deleteWorkflowNode(node.id);
    }

    // Delete all connections
    const connections = await this.getWorkflowConnections(id);
    for (const connection of connections) {
      await this.deleteWorkflowConnection(connection.id);
    }

    // Delete logs
    await db.delete(workflowLogs).where(eq(workflowLogs.workflowId, id));

    // Delete the workflow itself
    await db.delete(workflows).where(eq(workflows.id, id));
  }

  // Helper methods used by deleteWorkflow
  private async getWorkflowNodes(workflowId: number): Promise<WorkflowNode[]> {
    const nodes = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, workflowId));
    return nodes;
  }

  private async deleteWorkflowNode(id: number): Promise<void> {
    // Delete connections that include this node
    await db
      .delete(workflowConnections)
      .where(eq(workflowConnections.sourceNodeId, id));
    await db
      .delete(workflowConnections)
      .where(eq(workflowConnections.targetNodeId, id));

    // Delete the node itself
    await db.delete(workflowNodes).where(eq(workflowNodes.id, id));
  }

  private async getWorkflowConnections(
    workflowId: number,
  ): Promise<WorkflowConnection[]> {
    const connections = await db
      .select()
      .from(workflowConnections)
      .where(eq(workflowConnections.workflowId, workflowId));
    return connections;
  }

  private async deleteWorkflowConnection(id: number): Promise<void> {
    await db.delete(workflowConnections).where(eq(workflowConnections.id, id));
  }
}
