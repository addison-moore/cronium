// Workflow nodes and connections module
import {
  workflowNodes,
  workflowConnections,
  type WorkflowNode,
  type InsertWorkflowNode,
  type WorkflowConnection,
  type InsertWorkflowConnection,
} from "@shared/schema";
import { db } from "@server/db";
import { eq } from "drizzle-orm";

export class WorkflowNodeStorage {
  // Workflow node methods
  async getWorkflowNode(id: number): Promise<WorkflowNode | undefined> {
    const [node] = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.id, id));
    return node;
  }

  async getWorkflowNodes(workflowId: number): Promise<WorkflowNode[]> {
    const nodes = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, workflowId));
    return nodes;
  }

  async createWorkflowNode(
    insertNode: InsertWorkflowNode,
  ): Promise<WorkflowNode> {
    const [node] = await db
      .insert(workflowNodes)
      .values(insertNode)
      .returning();

    if (!node) {
      throw new Error("Failed to create workflow node");
    }
    return node;
  }

  async updateWorkflowNode(
    id: number,
    updateData: Partial<InsertWorkflowNode>,
  ): Promise<WorkflowNode> {
    const [node] = await db
      .update(workflowNodes)
      .set(updateData)
      .where(eq(workflowNodes.id, id))
      .returning();

    if (!node) {
      throw new Error("Failed to update workflow node - node not found");
    }
    return node;
  }

  async deleteWorkflowNode(id: number): Promise<void> {
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

  // Workflow connection methods
  async getWorkflowConnection(
    id: number,
  ): Promise<WorkflowConnection | undefined> {
    const [connection] = await db
      .select()
      .from(workflowConnections)
      .where(eq(workflowConnections.id, id));
    return connection;
  }

  async getWorkflowConnections(
    workflowId: number,
  ): Promise<WorkflowConnection[]> {
    const connections = await db
      .select()
      .from(workflowConnections)
      .where(eq(workflowConnections.workflowId, workflowId));
    return connections;
  }

  async createWorkflowConnection(
    insertConnection: InsertWorkflowConnection,
  ): Promise<WorkflowConnection> {
    const [connection] = await db
      .insert(workflowConnections)
      .values(insertConnection)
      .returning();

    if (!connection) {
      throw new Error("Failed to create workflow connection");
    }
    return connection;
  }

  async updateWorkflowConnection(
    id: number,
    updateData: Partial<InsertWorkflowConnection>,
  ): Promise<WorkflowConnection> {
    const [connection] = await db
      .update(workflowConnections)
      .set(updateData)
      .where(eq(workflowConnections.id, id))
      .returning();

    if (!connection) {
      throw new Error(
        "Failed to update workflow connection - connection not found",
      );
    }
    return connection;
  }

  async deleteWorkflowConnection(id: number): Promise<void> {
    await db.delete(workflowConnections).where(eq(workflowConnections.id, id));
  }
}
