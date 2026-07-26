/**
 * Pure form-schema, mapping, and payload-assembly logic for
 * WorkflowDetailsForm. No React or tRPC — plain data in, plain data out.
 */
import { z } from "zod";
import {
  type Workflow,
  WorkflowTriggerType,
  EventStatus,
  TimeUnit,
  ConnectionType,
} from "@/shared/schema";

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  data?: Record<string, unknown>;
}

// Define the form schema with proper validation
export const workflowDetailsSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(100, "Name is too long"),
    description: z.string().max(500, "Description is too long").optional(),
    triggerType: z.nativeEnum(WorkflowTriggerType),
    status: z.nativeEnum(EventStatus),
    tags: z.array(z.string()),
    customSchedule: z.string().optional(),
    // Use z.any() for fields causing type issues, then refine them with superRefine
    scheduleNumber: z.any(),
    scheduleUnit: z.any(),
    useCronScheduling: z.boolean(),
    overrideEventServers: z.boolean(),
    overrideServerIds: z.array(z.number()),
    shared: z.boolean(),
  })
  .superRefine((data, ctx) => {
    // Validate scheduleNumber if it's not null or undefined
    if (data.scheduleNumber !== null && data.scheduleNumber !== undefined) {
      const num = Number(data.scheduleNumber);
      if (isNaN(num) || num < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Schedule number must be at least 1",
          path: ["scheduleNumber"],
        });
      }
    }

    // Validate scheduleUnit if it's not null or undefined
    if (data.scheduleUnit !== null && data.scheduleUnit !== undefined) {
      const validUnits = Object.values(TimeUnit);
      if (!validUnits.includes(data.scheduleUnit as TimeUnit)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid time unit",
          path: ["scheduleUnit"],
        });
      }
    }
  });

export type WorkflowDetailsFormData = z.infer<typeof workflowDetailsSchema>;

/** Map a workflow row to the details form's field values. */
export function workflowToFormValues(
  workflow: Workflow,
): WorkflowDetailsFormData {
  return {
    name: workflow.name ?? "",
    description: workflow.description ?? "",
    triggerType: workflow.triggerType ?? WorkflowTriggerType.MANUAL,
    status: workflow.status ?? EventStatus.DRAFT,
    tags: Array.isArray(workflow.tags) ? (workflow.tags as string[]) : [],
    customSchedule: workflow.customSchedule ?? "",
    scheduleNumber: workflow.scheduleNumber ?? null,
    scheduleUnit: workflow.scheduleUnit ?? null,
    useCronScheduling: !!workflow.customSchedule,
    overrideEventServers: workflow.overrideEventServers ?? false,
    overrideServerIds: Array.isArray(workflow.overrideServerIds)
      ? (workflow.overrideServerIds as number[])
      : [],
    shared: workflow.shared ?? false,
  };
}

/**
 * Assemble the `workflows.update` payload: form values plus the canvas nodes
 * and edges normalized to the shapes `updateWorkflowSchema` expects
 * (`eventNode`/`connectionEdge` type literals, tags and connectionType
 * defaults).
 */
export function buildWorkflowUpdatePayload(
  workflowId: number,
  data: WorkflowDetailsFormData,
  workflowNodes: WorkflowNode[],
  workflowEdges: WorkflowEdge[],
) {
  return {
    id: workflowId,
    ...data,
    nodes: workflowNodes.map((node) => ({
      ...node,
      type: "eventNode" as const,
      data: {
        eventId: node.data.eventId as number,
        label: node.data.label as string,
        type: node.data.type as string,
        eventTypeIcon: node.data.eventTypeIcon as string,
        description: node.data.description as string | undefined,
        tags: (node.data.tags as string[]) || [],
        serverId: node.data.serverId as number | undefined,
        serverName: node.data.serverName as string | undefined,
        createdAt: node.data.createdAt as string | undefined,
        updatedAt: node.data.updatedAt as string | undefined,
      },
    })),
    edges: workflowEdges.map((edge) => ({
      ...edge,
      type: "connectionEdge" as const,
      animated: true,
      data: {
        connectionType:
          (edge.data?.connectionType as ConnectionType | undefined) ??
          ConnectionType.ALWAYS,
      },
    })),
  };
}

/**
 * State transition for the "Use Cron Expression" checkbox: enabling cron
 * clears the simple interval fields; disabling clears the cron string.
 */
export function applyCronSchedulingToggle(
  prev: WorkflowDetailsFormData,
  checked: boolean | "indeterminate",
): WorkflowDetailsFormData {
  return {
    ...prev,
    useCronScheduling: !!checked,
    customSchedule: checked ? prev.customSchedule : "",
    scheduleNumber: checked ? null : (prev.scheduleNumber as number | null),
    scheduleUnit: checked ? null : (prev.scheduleUnit as TimeUnit | null),
  };
}

/**
 * State transition for the server-override switch: turning it off clears the
 * selected server ids.
 */
export function applyServerOverrideToggle(
  prev: WorkflowDetailsFormData,
  checked: boolean,
): WorkflowDetailsFormData {
  return {
    ...prev,
    overrideEventServers: checked,
    overrideServerIds: checked ? prev.overrideServerIds : [],
  };
}
