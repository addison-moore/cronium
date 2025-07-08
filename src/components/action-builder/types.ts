import { z } from "zod";
import type { ToolAction } from "@/components/tools/types/tool-plugin";

// Node types for the visual builder
export enum NodeType {
  TRIGGER = "TRIGGER",
  ACTION = "ACTION",
  CONDITION = "CONDITION",
  TRANSFORMER = "TRANSFORMER",
  OUTPUT = "OUTPUT",
}

// Node data structure
export interface ActionNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: {
    label: string;
    description?: string;
    icon?: React.ComponentType<{ size?: number; className?: string }>;
    toolId?: string;
    actionId?: string;
    action?: ToolAction;
    parameters?: Record<string, unknown>;
    isConfigured?: boolean;
  };
}

// Connection between nodes
export interface ActionConnection {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: "success" | "failure" | "always";
  data?: {
    condition?: string;
    transformer?: string;
  };
}

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
export const NODE_TEMPLATES: Record<NodeType, Partial<ActionNode>> = {
  [NodeType.TRIGGER]: {
    type: NodeType.TRIGGER,
    data: {
      label: "Trigger",
      description: "Start of the workflow",
    },
  },
  [NodeType.ACTION]: {
    type: NodeType.ACTION,
    data: {
      label: "Action",
      description: "Execute a tool action",
    },
  },
  [NodeType.CONDITION]: {
    type: NodeType.CONDITION,
    data: {
      label: "Condition",
      description: "Branch based on conditions",
    },
  },
  [NodeType.TRANSFORMER]: {
    type: NodeType.TRANSFORMER,
    data: {
      label: "Transformer",
      description: "Transform data between actions",
    },
  },
  [NodeType.OUTPUT]: {
    type: NodeType.OUTPUT,
    data: {
      label: "Output",
      description: "End of the workflow",
    },
  },
};

// Validation schemas
export const nodeSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(NodeType),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: z.object({
    label: z.string(),
    description: z.string().optional(),
    toolId: z.string().optional(),
    actionId: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
    isConfigured: z.boolean().optional(),
  }),
});

export const connectionSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.enum(["success", "failure", "always"]).optional(),
  data: z
    .object({
      condition: z.string().optional(),
      transformer: z.string().optional(),
    })
    .optional(),
});

export const builderStateSchema = z.object({
  nodes: z.array(nodeSchema),
  connections: z.array(connectionSchema),
  selectedNode: z.string().optional(),
  selectedConnection: z.string().optional(),
  isDirty: z.boolean(),
});
