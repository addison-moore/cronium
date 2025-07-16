import type { Node, Edge, Connection } from "@xyflow/react";

/**
 * Validates the workflow structure to ensure it follows the rules:
 * 1. No cycles allowed (DAG constraint)
 * 2. No merge points (each node can only have one input)
 * @returns An object with isValid flag and error message if invalid
 */
export const validateWorkflowStructure = (
  nodes: Node[],
  edges: Edge[],
  newConnection?: Connection,
) => {
  const allEdges = newConnection
    ? [
        ...edges,
        {
          ...newConnection,
          id: `temp-${newConnection.source}-${newConnection.target}`,
        },
      ]
    : edges;

  // Check for multiple inputs to a single node (merge prevention)
  const targetNodes = new Map<string, string[]>();
  allEdges.forEach((edge) => {
    const target = edge.target;
    if (!targetNodes.has(target)) {
      targetNodes.set(target, []);
    }
    targetNodes.get(target)!.push(edge.source);
  });

  // Find nodes with multiple inputs
  const mergeViolations = Array.from(targetNodes.entries()).filter(
    ([_target, sources]) => sources.length > 1,
  );
  if (mergeViolations.length > 0) {
    return {
      isValid: false,
      error:
        "Workflow branching violation: Multiple nodes cannot connect to the same downstream node. Each node can only have one input connection.",
      type: "merge",
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
      return false; // Already processed this path
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    // Get all outgoing edges from this node
    const outgoingEdges = allEdges.filter((edge) => edge.source === nodeId);
    for (const edge of outgoingEdges) {
      if (hasCycle(edge.target)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  };

  // Check for cycles starting from each unvisited node
  for (const node of nodes) {
    if (!visited.has(node.id) && hasCycle(node.id)) {
      return {
        isValid: false,
        error:
          "Cycle detected in workflow. Workflows must be directed acyclic graphs (DAG). Check for circular dependencies.",
        type: "cycle",
      };
    }
  }

  return { isValid: true };
};
