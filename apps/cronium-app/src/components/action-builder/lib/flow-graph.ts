/**
 * Pure node-graph logic extracted from the useActionBuilder zustand store:
 * node/edge assembly and flow ordering/validation, with no React imports.
 *
 * Behavior is preserved exactly, including two long-standing quirks that are
 * pinned by tests rather than "fixed":
 * - getExecutionOrder pushes every node exactly once even when the graph has
 *   a cycle (the cycle re-entry is skipped, the outer loop sweeps the rest),
 *   so validateFlow's `executionOrder.length !== nodes.length` cycle check
 *   can never fire.
 * - Node/edge ids are derived from Date.now(), so two calls within the same
 *   millisecond collide.
 */

import type { Connection } from "@xyflow/react";
import {
  type ActionNode,
  type ActionConnection,
  NodeType,
  NODE_TEMPLATES,
} from "../types";

/** Assemble a new canvas node from its template, position and overrides. */
export function buildActionNode(
  type: NodeType,
  position: { x: number; y: number },
  data?: unknown,
): ActionNode {
  const template = NODE_TEMPLATES[type];
  const id = `${type}-${Date.now()}`;
  return {
    id,
    type: "action", // ReactFlow node type for custom component
    position,
    data: {
      label: template.label ?? type,
      ...template,
      ...(data as Record<string, unknown>),
      nodeType: type, // Store our NodeType in data
      id,
    },
  };
}

/** Assemble a new "always" edge from a ReactFlow connection. */
export function buildActionEdge(connection: Connection): ActionConnection {
  return {
    ...connection,
    id: `edge-${Date.now()}`,
    type: "action",
    data: {
      connectionType: "always" as const,
    },
  };
}

/**
 * Depth-first execution order over the node graph, starting from trigger
 * nodes (explicit TRIGGER type or no incoming edges), visiting each node's
 * dependencies first, then sweeping any remaining unvisited nodes.
 */
export function getExecutionOrder(
  nodes: ActionNode[],
  edges: ActionConnection[],
): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  // Find trigger nodes (nodes with no incoming edges)
  const triggerNodes = nodes.filter(
    (node) =>
      node.data.nodeType === NodeType.TRIGGER ||
      !edges.some((edge) => edge.target === node.id),
  );

  // Depth-first traversal
  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) {
      console.warn("Cycle detected in flow");
      return;
    }

    visiting.add(nodeId);

    // Visit all dependencies first
    const incomingEdges = edges.filter((edge) => edge.target === nodeId);
    for (const edge of incomingEdges) {
      visit(edge.source);
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
    order.push(nodeId);
  };

  // Start from trigger nodes
  for (const node of triggerNodes) {
    visit(node.id);
  }

  // Visit any remaining unvisited nodes
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      visit(node.id);
    }
  }

  return order;
}

/** Validate the flow: trigger/output presence, connectivity, configuration. */
export function validateFlow(
  nodes: ActionNode[],
  edges: ActionConnection[],
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for trigger node
  const triggerNodes = nodes.filter(
    (n) => n.data.nodeType === NodeType.TRIGGER,
  );
  if (triggerNodes.length === 0) {
    errors.push("Flow must have at least one trigger node");
  }

  // Check for output node
  const outputNodes = nodes.filter((n) => n.data.nodeType === NodeType.OUTPUT);
  if (outputNodes.length === 0) {
    errors.push("Flow must have at least one output node");
  }

  // Check for disconnected nodes
  const connectedNodes = new Set<string>();
  edges.forEach((edge) => {
    connectedNodes.add(edge.source);
    connectedNodes.add(edge.target);
  });

  const disconnectedNodes = nodes.filter(
    (node) => !connectedNodes.has(node.id) && nodes.length > 1,
  );
  if (disconnectedNodes.length > 0) {
    errors.push(
      `Disconnected nodes found: ${disconnectedNodes.map((n) => n.data.label).join(", ")}`,
    );
  }

  // Check for unconfigured nodes
  const unconfiguredNodes = nodes.filter((n) => !n.data.isConfigured);
  if (unconfiguredNodes.length > 0) {
    errors.push(
      `Unconfigured nodes: ${unconfiguredNodes.map((n) => n.data.label).join(", ")}`,
    );
  }

  // Check for cycles
  const executionOrder = getExecutionOrder(nodes, edges);
  if (executionOrder.length !== nodes.length) {
    errors.push("Flow contains cycles or unreachable nodes");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
