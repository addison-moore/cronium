import { z } from "zod";
import type { ToolAction } from "@/components/tools/types/tool-plugin";
import type { Node, Edge } from "@xyflow/react";

// Node types for the visual builder
export enum NodeType {
  TRIGGER = "TRIGGER",
  ACTION = "ACTION",
  CONDITION = "CONDITION",
  TRANSFORMER = "TRANSFORMER",
  OUTPUT = "OUTPUT",
}

// Data structure for nodes - must extend Record<string, unknown> for ReactFlow compatibility
export interface ActionNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  toolId?: string;
  actionId?: string;
  action?: ToolAction;
  parameters?: Record<string, unknown>;
  isConfigured?: boolean;
  nodeType: NodeType; // Store the NodeType in data since ReactFlow uses 'type' for custom components
}

// Data structure for connections - must extend Record<string, unknown> for ReactFlow compatibility
export interface ActionConnectionData extends Record<string, unknown> {
  condition?: string;
  transformer?: string;
  connectionType?: "success" | "failure" | "always";
}

// ReactFlow compatible node type
export type ActionNode = Node<ActionNodeData>;

// ReactFlow compatible edge type
export type ActionConnection = Edge<ActionConnectionData>;

// Builder state
export interface ActionBuilderState {
  nodes: ActionNode[];
  connections: ActionConnection[];
  selectedNode?: string;
  selectedConnection?: string;
  isDirty: boolean;
}

// Data mapping configuration
export interface DataMapping {
  sourceField: string;
  targetField: string;
  transformer?: "direct" | "template" | "expression" | "custom";
  transformerConfig?: {
    template?: string;
    expression?: string;
    customFunction?: string;
  };
}

// Execution preview
export interface ExecutionPreview {
  nodeId: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  executionTime?: number;
  status: "pending" | "running" | "success" | "error";
}

// Canvas configuration
export const CANVAS_CONFIG = {
  gridSize: 20,
  snapToGrid: true,
  minZoom: 0.25,
  maxZoom: 2,
  defaultZoom: 1,
  nodeWidth: 280,
  nodeHeight: 100,
  connectionLineType: "smoothstep" as const,
};

// Node templates
export const NODE_TEMPLATES: Record<NodeType, Partial<ActionNodeData>> = {
  [NodeType.TRIGGER]: {
    label: "Trigger",
    description: "Start of the workflow",
    nodeType: NodeType.TRIGGER,
  },
  [NodeType.ACTION]: {
    label: "Action",
    description: "Execute a tool action",
    nodeType: NodeType.ACTION,
  },
  [NodeType.CONDITION]: {
    label: "Condition",
    description: "Branch based on conditions",
    nodeType: NodeType.CONDITION,
  },
  [NodeType.TRANSFORMER]: {
    label: "Transformer",
    description: "Transform data between actions",
    nodeType: NodeType.TRANSFORMER,
  },
  [NodeType.OUTPUT]: {
    label: "Output",
    description: "End of the workflow",
    nodeType: NodeType.OUTPUT,
  },
};

// Validation schemas
export const nodeDataSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  toolId: z.string().optional(),
  actionId: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
  isConfigured: z.boolean().optional(),
  nodeType: z.nativeEnum(NodeType),
}).passthrough(); // Allow additional properties for Record<string, unknown> compatibility

export const nodeSchema = z.object({
  id: z.string(),
  type: z.string(), // ReactFlow uses string type for custom components
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: nodeDataSchema,
});

export const connectionDataSchema = z.object({
  condition: z.string().optional(),
  transformer: z.string().optional(),
  connectionType: z.enum(["success", "failure", "always"]).optional(),
}).passthrough(); // Allow additional properties for Record<string, unknown> compatibility

export const connectionSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.string().optional(), // ReactFlow edge type
  data: connectionDataSchema.optional(),
});

export const builderStateSchema = z.object({
  nodes: z.array(nodeSchema),
  connections: z.array(connectionSchema),
  selectedNode: z.string().optional(),
  selectedConnection: z.string().optional(),
  isDirty: z.boolean(),
});
