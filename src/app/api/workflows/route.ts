import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/server/db";
import { eq, or, and, ne } from "drizzle-orm";
import {
  workflows,
  workflowNodes,
  workflowConnections,
  EventStatus,
} from "@/shared/schema";
import { nanoid } from "nanoid";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { WorkflowTriggerType } from "@/shared/schema";
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

// Get all workflows for the current user
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = auth.userId;
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get("includeArchived") === "true";

    // Build base query conditions
    let whereConditions = or(
      eq(workflows.userId, userId), // User's own workflows
      eq(workflows.shared, true), // Shared workflows from other users
    );

    // By default, exclude archived workflows unless explicitly requested
    if (!includeArchived) {
      whereConditions = and(
        whereConditions,
        ne(workflows.status, EventStatus.ARCHIVED),
      );
    }

    // Get workflows with appropriate filtering
    const allWorkflows = await db
      .select()
      .from(workflows)
      .where(whereConditions)
      .orderBy(workflows.updatedAt);

    // For each workflow, get the latest log to determine lastRunAt
    // In this simplified version, we're just returning the workflows without logs
    // since there may be issues with the workflowLogs table
    const workflowsWithLogs = allWorkflows.map((workflow) => ({
      ...workflow,
      lastRunAt: null,
    }));

    return NextResponse.json(workflowsWithLogs);
  } catch (error) {
    console.error("Error fetching workflows:", error);
    return NextResponse.json(
      { error: "An error occurred while fetching workflows" },
      { status: 500 },
    );
  }
}

// Create a new workflow
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUser(request);

    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = auth.userId;
    const data = await request.json();

    // Generate a webhook key if this is a webhook triggered workflow
    let webhookKey = null;
    if (data.triggerType === WorkflowTriggerType.WEBHOOK) {
      webhookKey = nanoid(16);
    }

    // Extract nodes and edges for workflow design
    const { nodes, edges, ...workflowData } = data;

    // Validate workflow structure if nodes and edges are provided
    if (nodes && edges) {
      const validation = validateWorkflowStructure(nodes, edges);
      if (!validation.isValid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    }

    // Prepare workflow data with server override fields
    const workflowInsertData = {
      ...workflowData,
      userId: userId,
      webhookKey,
      overrideEventServers: workflowData.overrideEventServers || false,
      overrideServerIds: workflowData.overrideServerIds
        ? JSON.stringify(workflowData.overrideServerIds)
        : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert the workflow
    const [createdWorkflow] = await db
      .insert(workflows)
      .values(workflowInsertData)
      .returning();

    // If we have nodes and edges, insert those as well
    if (nodes?.length) {
      // Insert workflow nodes
      if (!createdWorkflow) {
        throw new Error("Failed to create workflow");
      }
      const workflowId = createdWorkflow.id;

      const nodeEntries = nodes.map((node: any) => ({
        workflowId,
        eventId: node.eventId || node.data?.eventId,
        position_x: Math.round(Number(node.position.x)),
        position_y: Math.round(Number(node.position.y)),
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const insertedNodes = await db
        .insert(workflowNodes)
        .values(nodeEntries)
        .returning();

      // Create a map of node IDs from the frontend to the database
      const nodeIdMap = new Map();
      nodes.forEach((node: any, index: number) => {
        const insertedNode = insertedNodes[index];
        if (insertedNode) {
          nodeIdMap.set(node.id, insertedNode.id);
        }
      });

      // Insert workflow connections
      if (edges?.length) {
        const connectionEntries = edges.map((edge: any) => ({
          workflowId,
          sourceNodeId: nodeIdMap.get(edge.source),
          targetNodeId: nodeIdMap.get(edge.target),
          connectionType: edge.data?.connectionType || "ALWAYS",
          createdAt: new Date(),
          updatedAt: new Date(),
        }));

        await db.insert(workflowConnections).values(connectionEntries);
      }
    }

    return NextResponse.json(createdWorkflow);
  } catch (error) {
    console.error("Error creating workflow:", error);
    return NextResponse.json(
      { error: "An error occurred while creating the workflow" },
      { status: 500 },
    );
  }
}
