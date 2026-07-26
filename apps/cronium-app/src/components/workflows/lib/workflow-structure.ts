/**
 * Pure graph-structure validation for the workflow canvas.
 *
 * Mirrors the server-side rules in `@/shared/schemas/workflows`
 * (single-predecessor / no fan-in, no cycles) so invalid connections are
 * rejected in the UI before they ever reach the API.
 */

/** Minimal node shape needed for validation (ReactFlow `Node` is assignable). */
export interface WorkflowGraphNode {
  id: string;
}

/** Minimal edge shape needed for validation (ReactFlow `Edge`/`Connection` are assignable). */
export interface WorkflowGraphEdge {
  source: string;
  target: string;
}

export interface WorkflowStructureValidation {
  isValid: boolean;
  error?: string;
  type?: "merge" | "cycle";
}

// Validation functions for workflow integrity
export const validateWorkflowStructure = (
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
  newConnection?: WorkflowGraphEdge,
): WorkflowStructureValidation => {
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
      return false; // Already processed
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    // Check all outgoing edges
    const outgoingEdges = allEdges.filter((edge) => edge.source === nodeId);
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
        type: "cycle",
      };
    }
  }

  return { isValid: true };
};
