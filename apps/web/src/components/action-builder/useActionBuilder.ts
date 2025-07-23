import { useMemo } from "react";
import {
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  addEdge,
} from "@xyflow/react";
import { create } from "zustand";
import {
  type ActionNode,
  type ActionConnection,
  type ActionNodeData,
  NodeType,
  NODE_TEMPLATES,
} from "./types";

interface ActionBuilderState {
  nodes: ActionNode[];
  edges: ActionConnection[];
  setNodes: (nodes: ActionNode[]) => void;
  setEdges: (edges: ActionConnection[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (
    type: NodeType,
    position: { x: number; y: number },
    data?: unknown,
  ) => void;
  updateNode: (nodeId: string, data: Partial<ActionNode>) => void;
  deleteNode: (nodeId: string) => void;
  updateConnection: (
    connectionId: string,
    data: Partial<ActionConnection>,
  ) => void;
  deleteConnection: (connectionId: string) => void;
  getNodeById: (nodeId: string) => ActionNode | undefined;
  getConnectionById: (connectionId: string) => ActionConnection | undefined;
  getExecutionOrder: () => string[];
  validateFlow: () => { isValid: boolean; errors: string[] };
  clearFlow: () => void;
}

export const useActionBuilderStore = create<ActionBuilderState>((set, get) => ({
  nodes: [],
  edges: [],

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes) as ActionNode[],
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges) as ActionConnection[],
    });
  },

  onConnect: (connection) => {
    const newEdge: ActionConnection = {
      ...connection,
      id: `edge-${Date.now()}`,
      type: "action",
      data: {
        connectionType: "always" as const,
      },
    } as ActionConnection;
    set({
      edges: addEdge(newEdge, get().edges),
    });
  },

  addNode: (type, position, data) => {
    const template = NODE_TEMPLATES[type];
    const id = `${type}-${Date.now()}`;
    const newNode: ActionNode = {
      id,
      type: "action", // ReactFlow node type for custom component
      position,
      data: {
        label: template.label ?? type,
        ...template,
        ...(data as Record<string, unknown>),
        nodeType: type, // Store our NodeType in data
        id,
      } as ActionNodeData,
    };
    set({
      nodes: [...get().nodes, newNode],
    });
  },

  updateNode: (nodeId, data) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } }
          : node,
      ),
    });
  },

  deleteNode: (nodeId) => {
    set({
      nodes: get().nodes.filter((node) => node.id !== nodeId),
      edges: get().edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      ),
    });
  },

  updateConnection: (connectionId, data) => {
    set({
      edges: get().edges.map((edge) =>
        edge.id === connectionId
          ? ({ ...edge, data: { ...edge.data, ...data } } as ActionConnection)
          : edge,
      ),
    });
  },

  deleteConnection: (connectionId) => {
    set({
      edges: get().edges.filter((edge) => edge.id !== connectionId),
    });
  },

  getNodeById: (nodeId) => {
    return get().nodes.find((node) => node.id === nodeId);
  },

  getConnectionById: (connectionId) => {
    return get().edges.find((edge) => edge.id === connectionId);
  },

  getExecutionOrder: () => {
    const { nodes, edges } = get();
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
  },

  validateFlow: () => {
    const { nodes, edges } = get();
    const errors: string[] = [];

    // Check for trigger node
    const triggerNodes = nodes.filter(
      (n) => n.data.nodeType === NodeType.TRIGGER,
    );
    if (triggerNodes.length === 0) {
      errors.push("Flow must have at least one trigger node");
    }

    // Check for output node
    const outputNodes = nodes.filter(
      (n) => n.data.nodeType === NodeType.OUTPUT,
    );
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
    const executionOrder = get().getExecutionOrder();
    if (executionOrder.length !== nodes.length) {
      errors.push("Flow contains cycles or unreachable nodes");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  },

  clearFlow: () => {
    set({ nodes: [], edges: [] });
  },
}));

// Hook wrapper
export function useActionBuilder() {
  const store = useActionBuilderStore();

  const connections = useMemo(() => {
    return store.edges;
  }, [store.edges]);

  return {
    nodes: store.nodes,
    edges: store.edges,
    connections,
    setNodes: store.setNodes,
    setEdges: store.setEdges,
    onNodesChange: store.onNodesChange,
    onEdgesChange: store.onEdgesChange,
    onConnect: store.onConnect,
    addNode: store.addNode,
    updateNode: store.updateNode,
    deleteNode: store.deleteNode,
    updateConnection: store.updateConnection,
    deleteConnection: store.deleteConnection,
    getNodeById: store.getNodeById,
    getConnectionById: store.getConnectionById,
    getExecutionOrder: store.getExecutionOrder,
    validateFlow: store.validateFlow,
    clearFlow: store.clearFlow,
  };
}
