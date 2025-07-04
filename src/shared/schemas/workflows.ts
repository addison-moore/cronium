import { z } from "zod";
import {
  WorkflowTriggerType,
  RunLocation,
  TimeUnit,
  EventStatus,
  ConnectionType,
  WorkflowLogLevel,
  LogStatus,
} from "../schema";

// Base workflow query schema
export const workflowQuerySchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
  status: z.nativeEnum(EventStatus).optional(),
  triggerType: z.nativeEnum(WorkflowTriggerType).optional(),
  shared: z.boolean().optional(),
});

// ReactFlow node schema
export const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.literal("eventNode"),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: z.object({
    eventId: z.number().int().positive(),
    label: z.string(),
    type: z.string(),
    eventTypeIcon: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    serverId: z.number().int().positive().optional(),
    serverName: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  }),
});

// ReactFlow edge schema
export const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.literal("connectionEdge"),
  animated: z.boolean().default(true),
  data: z.object({
    type: z.nativeEnum(ConnectionType),
    connectionType: z.nativeEnum(ConnectionType),
  }),
});

// Create workflow schema
export const createWorkflowSchema = z
  .object({
    name: z
      .string()
      .min(1, "Workflow name is required")
      .max(100, "Workflow name must be less than 100 characters"),
    description: z
      .string()
      .max(500, "Description must be less than 500 characters")
      .optional(),
    tags: z.array(z.string()).default([]),

    // Trigger configuration
    triggerType: z.nativeEnum(WorkflowTriggerType, {
      required_error: "Trigger type is required",
    }),
    webhookKey: z.string().optional(),

    // Scheduling configuration
    scheduleNumber: z
      .number()
      .min(1, "Schedule number must be at least 1")
      .optional(),
    scheduleUnit: z.nativeEnum(TimeUnit).optional(),
    customSchedule: z.string().optional(),
    useCronScheduling: z.boolean().default(false),

    // Execution configuration
    runLocation: z.nativeEnum(RunLocation).default(RunLocation.LOCAL),
    overrideEventServers: z.boolean().default(false),
    overrideServerIds: z.array(z.number().int().positive()).default([]),

    // Status and sharing
    status: z.nativeEnum(EventStatus).default(EventStatus.DRAFT),
    shared: z.boolean().default(false),

    // Workflow structure
    nodes: z.array(workflowNodeSchema).default([]),
    edges: z.array(workflowEdgeSchema).default([]),
  })
  .refine(
    (data) => {
      // Validate scheduling for scheduled workflows
      if (
        data.triggerType === WorkflowTriggerType.SCHEDULE &&
        data.status === EventStatus.ACTIVE
      ) {
        if (data.useCronScheduling) {
          return data.customSchedule && data.customSchedule.trim().length > 0;
        } else {
          return data.scheduleNumber && data.scheduleUnit;
        }
      }
      return true;
    },
    {
      message:
        "Schedule configuration is required for active scheduled workflows",
      path: ["scheduleNumber"],
    },
  )
  .refine(
    (data) => {
      // Validate webhook key for webhook workflows
      if (data.triggerType === WorkflowTriggerType.WEBHOOK) {
        return data.webhookKey && data.webhookKey.trim().length > 0;
      }
      return true;
    },
    {
      message: "Webhook key is required for webhook-triggered workflows",
      path: ["webhookKey"],
    },
  )
  .refine(
    (data) => {
      // Validate server override configuration
      if (
        data.overrideEventServers &&
        data.runLocation === RunLocation.REMOTE
      ) {
        return data.overrideServerIds.length > 0;
      }
      return true;
    },
    {
      message:
        "Server selection is required when overriding event servers for remote execution",
      path: ["overrideServerIds"],
    },
  )
  .refine(
    (data) => {
      // Validate workflow structure has at least one node
      if (data.status === EventStatus.ACTIVE) {
        return data.nodes.length > 0;
      }
      return true;
    },
    {
      message: "Active workflows must have at least one node",
      path: ["nodes"],
    },
  )
  .refine(
    (data) => {
      // Validate edge connections reference existing nodes
      const nodeIds = new Set(data.nodes.map((node) => node.id));
      return data.edges.every(
        (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
      );
    },
    {
      message: "All edge connections must reference existing nodes",
      path: ["edges"],
    },
  )
  .refine(
    (data) => {
      // Validate no self-loops
      return data.edges.every((edge) => edge.source !== edge.target);
    },
    {
      message: "Self-loops are not allowed in workflow connections",
      path: ["edges"],
    },
  )
  .refine(
    (data) => {
      // Basic cycle detection using DFS
      if (data.nodes.length === 0 || data.edges.length === 0) return true;

      const graph = new Map<string, string[]>();
      data.nodes.forEach((node) => graph.set(node.id, []));
      data.edges.forEach((edge) => {
        if (!graph.has(edge.source)) graph.set(edge.source, []);
        graph.get(edge.source)!.push(edge.target);
      });

      const visited = new Set<string>();
      const recStack = new Set<string>();

      function hasCycle(node: string): boolean {
        if (recStack.has(node)) return true;
        if (visited.has(node)) return false;

        visited.add(node);
        recStack.add(node);

        const neighbors = graph.get(node) ?? [];
        for (const neighbor of neighbors) {
          if (hasCycle(neighbor)) return true;
        }

        recStack.delete(node);
        return false;
      }

      for (const nodeId of graph.keys()) {
        if (!visited.has(nodeId) && hasCycle(nodeId)) {
          return false;
        }
      }

      return true;
    },
    {
      message: "Workflow cannot contain cycles",
      path: ["edges"],
    },
  );

// Update workflow schema
export const updateWorkflowSchema = z.object({
  id: z.number().int().positive("Workflow ID must be a positive integer"),
  name: z.string().min(1).max(100).nullish(),
  description: z.string().max(500).nullish(),
  tags: z.array(z.string()).nullish(),
  triggerType: z.nativeEnum(WorkflowTriggerType).nullish(),
  webhookKey: z.string().nullish(),
  scheduleNumber: z.number().min(1).nullish(),
  scheduleUnit: z.nativeEnum(TimeUnit).nullish(),
  customSchedule: z.string().nullish(),
  useCronScheduling: z.boolean().nullish(),
  runLocation: z.nativeEnum(RunLocation).nullish(),
  overrideEventServers: z.boolean().nullish(),
  overrideServerIds: z.array(z.number().int().positive()).nullish(),
  status: z.nativeEnum(EventStatus).nullish(),
  shared: z.boolean().nullish(),
  nodes: z.array(workflowNodeSchema).optional(),
  edges: z.array(workflowEdgeSchema).optional(),
});

// Workflow ID parameter schema
export const workflowIdSchema = z.object({
  id: z.number().int().positive("Workflow ID must be a positive integer"),
});

// Workflow execution schema
export const executeWorkflowSchema = z.object({
  id: z.number().int().positive("Workflow ID must be a positive integer"),
  manual: z.boolean().default(true),
  payload: z.record(z.any()).optional(),
});

// Workflow executions query schema
export const workflowExecutionsSchema = z.object({
  id: z
    .number()
    .int()
    .positive("Workflow ID must be a positive integer")
    .optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  status: z.nativeEnum(LogStatus).optional(),
});

// Workflow logs query schema
export const workflowLogsSchema = z.object({
  id: z.number().int().positive("Workflow ID must be a positive integer"),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  level: z.nativeEnum(WorkflowLogLevel).optional(),
});

// Bulk operations schema
export const bulkWorkflowOperationSchema = z.object({
  workflowIds: z
    .array(z.number().int().positive())
    .min(1, "At least one workflow must be selected"),
  operation: z.enum(["archive", "delete", "activate", "pause"]),
});

// Workflow download schema
export const workflowDownloadSchema = z.object({
  workflowIds: z
    .array(z.number().int().positive())
    .min(1, "At least one workflow must be selected"),
  format: z.enum(["json", "zip"]).default("json"),
  includeNodes: z.boolean().default(true),
  includeConnections: z.boolean().default(true),
});

// Webhook execution schema
export const webhookExecutionSchema = z.object({
  key: z.string().min(1, "Webhook key is required"),
  payload: z.record(z.any()).optional(),
});

// Type definitions inferred from schemas
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type WorkflowQueryInput = z.infer<typeof workflowQuerySchema>;
export type ExecuteWorkflowInput = z.infer<typeof executeWorkflowSchema>;
export type WorkflowExecutionsInput = z.infer<typeof workflowExecutionsSchema>;
export type WorkflowLogsInput = z.infer<typeof workflowLogsSchema>;
export type BulkWorkflowOperationInput = z.infer<
  typeof bulkWorkflowOperationSchema
>;
export type WorkflowDownloadInput = z.infer<typeof workflowDownloadSchema>;
export type WebhookExecutionInput = z.infer<typeof webhookExecutionSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
