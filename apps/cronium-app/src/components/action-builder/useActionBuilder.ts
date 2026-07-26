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
import type { ActionNode, ActionConnection, NodeType } from "./types";
import {
  buildActionEdge,
  buildActionNode,
  getExecutionOrder,
  validateFlow,
} from "./lib/flow-graph";

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
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  onConnect: (connection) => {
    const newEdge: ActionConnection = buildActionEdge(connection);
    set({
      edges: addEdge(newEdge, get().edges),
    });
  },

  addNode: (type, position, data) => {
    const newNode: ActionNode = buildActionNode(type, position, data);
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
    return getExecutionOrder(nodes, edges);
  },

  validateFlow: () => {
    const { nodes, edges } = get();
    return validateFlow(nodes, edges);
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
