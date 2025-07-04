import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/server/db";
import { and, eq, or } from "drizzle-orm";
import {
  workflows,
  workflowNodes,
  workflowConnections,
  events,
  workflowLogs,
  workflowExecutions,
  logs,
} from "@/shared/schema";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authenticateApiRequest } from "@/lib/api-auth";

// Server-side workflow validation
const validateWorkflowStructure = (nodes: any[], edges: any[]) => {
  // Check for multiple inputs to a single node (merge prevention)
  const targetNodes = new Map<string, string[]>();
  edges.forEach((edge) => {
    const target = edge.target;
    if (!targetNodes.has(target)) {
      targetNodes.set(target, []);
    }
    targetNodes.get(target)!.push(edge.source);
  });

  // Find nodes with multiple inputs
  const mergeViolations = Array.from(targetNodes.entries()).filter(
    ([target, sources]) => sources.length > 1,
  );
  if (mergeViolations.length > 0) {
    return {
      isValid: false,
      error:
        "Workflow branching violation: Multiple nodes cannot connect to the same downstream node. Each node can only have one input connection.",
    };
  }

  // Check for cycles using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const hasCycle = (nodeId: string): boolean => {
    if (recursionStack.has(nodeId)) {
      return true; // Back edge found - cycle detected
    }
    if (visited.has(nodeId)) {
      return false; // Already processed
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    // Check all outgoing edges
    const outgoingEdges = edges.filter((edge) => edge.source === nodeId);
    for (const edge of outgoingEdges) {
      if (hasCycle(edge.target)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  };

  // Check for cycles starting from all nodes
  for (const node of nodes) {
    if (!visited.has(node.id) && hasCycle(node.id)) {
      return {
        isValid: false,
        error:
          "Workflow cycle detected: Workflows cannot be cyclical as this would create infinite loops. Please remove connections that create circular dependencies.",
      };
    }
  }

  return { isValid: true };
};

// Helper function to authenticate user via session or API token
async function authenticateUser(
  request: NextRequest,
): Promise<{ userId: string } | null> {
  // First try API token
  const apiAuth = await authenticateApiRequest(request);

  if (apiAuth.authenticated && apiAuth.userId) {
    return { userId: apiAuth.userId };
  }

  // Then try session
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    return { userId: session.user.id };
  }

  // No authentication found
  return null;
}

// Get a specific workflow by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Safely unwrap params in Next.js 15
  const unwrappedParams = await params;
  const workflowId = parseInt(unwrappedParams.id);

  if (isNaN(workflowId)) {
    return NextResponse.json({ error: "Invalid workflow ID" }, { status: 400 });
  }

  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = auth.userId;

    // Get the workflow (user's own workflow OR shared workflow from others)
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.id, workflowId),
          or(
            eq(workflows.userId, userId), // User's own workflow
            eq(workflows.shared, true), // Shared workflow from others
          ),
        ),
      )
      .limit(1);

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 },
      );
    }

    // Get nodes for this workflow with their associated events
    const nodes = await db
      .select({
        id: workflowNodes.id,
        eventId: workflowNodes.eventId,
        position_x: workflowNodes.position_x,
        position_y: workflowNodes.position_y,
        eventName: events.name,
        eventType: events.type,
        eventDescription: events.description,
        eventTags: events.tags,
        eventServerId: events.serverId,
        eventCreatedAt: events.createdAt,
        eventUpdatedAt: events.updatedAt,
      })
      .from(workflowNodes)
      .leftJoin(events, eq(workflowNodes.eventId, events.id))
      .where(eq(workflowNodes.workflowId, workflowId));

    // Get connections for this workflow
    const connections = await db
      .select()
      .from(workflowConnections)
      .where(eq(workflowConnections.workflowId, workflowId));

    // Transform nodes and connections into ReactFlow format for the frontend
    const reactFlowNodes = nodes.map((node) => ({
      id: node.id.toString(),
      type: "eventNode",
      position: { x: node.position_x, y: node.position_y },
      data: {
        eventId: node.eventId,
        label: node.eventName || "Untitled",
        type: node.eventType || "BASH",
        eventTypeIcon: node.eventType || "BASH",
        description: node.eventDescription || "",
        tags: node.eventTags || [],
        serverId: node.eventServerId,
        serverName: "", // Will be populated separately if needed
        createdAt: node.eventCreatedAt,
        updatedAt: node.eventUpdatedAt,
      },
    }));

    const reactFlowEdges = connections.map((conn) => ({
      id: conn.id.toString(),
      source: conn.sourceNodeId.toString(),
      target: conn.targetNodeId.toString(),
      type: "connectionEdge",
      animated: true,
      data: {
        type: conn.connectionType,
        connectionType: conn.connectionType,
      },
    }));

    // Parse server override IDs from JSON if they exist
    let parsedOverrideServerIds = [];
    try {
      if (
        workflow.overrideServerIds &&
        typeof workflow.overrideServerIds === "string"
      ) {
        parsedOverrideServerIds = JSON.parse(workflow.overrideServerIds);
      } else if (Array.isArray(workflow.overrideServerIds)) {
        parsedOverrideServerIds = workflow.overrideServerIds;
      }
    } catch (error) {
      console.warn(
        "Failed to parse overrideServerIds, using empty array:",
        error,
      );
      parsedOverrideServerIds = [];
    }

    const workflowWithParsedOverrides = {
      ...workflow,
      overrideServerIds: parsedOverrideServerIds,
      overrideEventServers: workflow.overrideEventServers || false,
    };

    return NextResponse.json({
      workflow: workflowWithParsedOverrides,
      nodes: reactFlowNodes,
      edges: reactFlowEdges,
    });
  } catch (error) {
    console.error("Error fetching workflow:", error);
    return NextResponse.json(
      { error: "An error occurred while fetching the workflow" },
      { status: 500 },
    );
  }
}

// Update a workflow by ID
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Safely unwrap params in Next.js 15
  const unwrappedParams = await params;
  const workflowId = parseInt(unwrappedParams.id);

  if (isNaN(workflowId)) {
    return NextResponse.json({ error: "Invalid workflow ID" }, { status: 400 });
  }

  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = auth.userId;

    // Verify the workflow exists and belongs to this user
    const [existingWorkflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId)))
      .limit(1);

    if (!existingWorkflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 },
      );
    }

    const data = await request.json();

    // Handle workflow property updates (name, description, status, tags, etc.)
    if (
      "name" in data ||
      "description" in data ||
      "status" in data ||
      "tags" in data ||
      "triggerType" in data ||
      "overrideEventServers" in data ||
      "overrideServerIds" in data
    ) {
      const updateData: any = { updatedAt: new Date() };

      if ("name" in data) updateData.name = data.name;
      if ("description" in data) updateData.description = data.description;
      if ("tags" in data) updateData.tags = data.tags;
      if ("status" in data) updateData.status = data.status;
      if ("triggerType" in data) updateData.triggerType = data.triggerType;
      if ("runLocation" in data) updateData.runLocation = data.runLocation;
      if ("scheduleNumber" in data)
        updateData.scheduleNumber = data.scheduleNumber;
      if ("scheduleUnit" in data) updateData.scheduleUnit = data.scheduleUnit;
      if ("customSchedule" in data)
        updateData.customSchedule = data.customSchedule;
      if ("shared" in data) updateData.shared = data.shared;
      if ("overrideEventServers" in data)
        updateData.overrideEventServers = data.overrideEventServers;
      if ("overrideServerIds" in data)
        updateData.overrideServerIds = data.overrideServerIds
          ? JSON.stringify(data.overrideServerIds)
          : null;

      await db
        .update(workflows)
        .set(updateData)
        .where(eq(workflows.id, workflowId));
    }

    // Handle nodes and edges updates if provided
    if (data.nodes && data.edges) {
      // Validate workflow structure before saving
      const validation = validateWorkflowStructure(data.nodes, data.edges);
      if (!validation.isValid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      // Delete existing nodes and connections
      await db
        .delete(workflowConnections)
        .where(eq(workflowConnections.workflowId, workflowId));

      await db
        .delete(workflowNodes)
        .where(eq(workflowNodes.workflowId, workflowId));

      // Insert new nodes
      const nodeEntries = data.nodes.map((node: any) => ({
        workflowId,
        eventId: node.data.eventId,
        position_x: Math.round(Number(node.position.x)),
        position_y: Math.round(Number(node.position.y)),
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      if (nodeEntries.length > 0) {
        const insertedNodes = await db
          .insert(workflowNodes)
          .values(nodeEntries)
          .returning();

        // Create a map of node IDs from the frontend to the database
        const nodeIdMap = new Map();
        data.nodes.forEach((node: any, index: number) => {
          const insertedNode = insertedNodes[index];
          if (insertedNode) {
            nodeIdMap.set(node.id, insertedNode.id);
          }
        });

        // Insert new connections if there are any edges
        if (data.edges && data.edges.length > 0) {
          const connectionEntries = data.edges.map((edge: any) => ({
            workflowId,
            sourceNodeId: nodeIdMap.get(edge.source),
            targetNodeId: nodeIdMap.get(edge.target),
            connectionType:
              edge.data?.type || edge.data?.connectionType || "ALWAYS",
            createdAt: new Date(),
            updatedAt: new Date(),
          }));

          await db.insert(workflowConnections).values(connectionEntries);
        }
      }
    }

    // Fetch the updated workflow
    const [updatedWorkflow] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .limit(1);

    return NextResponse.json(updatedWorkflow);
  } catch (error) {
    console.error("Error updating workflow:", error);
    return NextResponse.json(
      { error: "An error occurred while updating the workflow" },
      { status: 500 },
    );
  }
}

// Delete a workflow by ID
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  // Safely unwrap params in Next.js 15
  const unwrappedParams = await params;
  const workflowId = parseInt(unwrappedParams.id);

  if (isNaN(workflowId)) {
    return NextResponse.json({ error: "Invalid workflow ID" }, { status: 400 });
  }

  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = auth.userId;

    // Verify the workflow exists and belongs to this user
    const [existingWorkflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId)))
      .limit(1);

    if (!existingWorkflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 },
      );
    }

    // Delete related records first (foreign key constraints)
    // Delete workflow logs
    await db
      .delete(workflowLogs)
      .where(eq(workflowLogs.workflowId, workflowId));

    // Delete workflow executions and their events (cascade will handle workflow_execution_events)
    await db
      .delete(workflowExecutions)
      .where(eq(workflowExecutions.workflowId, workflowId));

    // Delete regular logs that reference this workflow
    await db.delete(logs).where(eq(logs.workflowId, workflowId));

    // Delete the workflow (cascade delete will handle nodes and connections)
    await db.delete(workflows).where(eq(workflows.id, workflowId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting workflow:", error);
    return NextResponse.json(
      { error: "An error occurred while deleting the workflow" },
      { status: 500 },
    );
  }
}
