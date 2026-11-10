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
} from "@/shared/schema";

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
 * The form's fields whose value isn't the one that was sent, compared by value: what
 * was typed while a save was on its way. `sent` is the save's payload.
 */
export function fieldsChangedSince(
  sent: Partial<Record<keyof WorkflowDetailsFormData, unknown>>,
  now: WorkflowDetailsFormData,
): Partial<WorkflowDetailsFormData> {
  return Object.fromEntries(
    Object.entries(now).filter(
      ([name, value]) =>
        JSON.stringify(value) !==
        JSON.stringify(sent[name as keyof WorkflowDetailsFormData]),
    ),
  );
}

/**
 * The `workflows.update` payload for a Details save: the form's fields, and no graph.
 * The server takes any graph it's sent as a new one: it deletes every node and connection
 * and makes them again with new ids, and a running workflow's remaining steps then fail.
 * Sending the page's graph also wrote back a copy older than one saved elsewhere, and
 * saved unfinished canvas edits. Those wait for the canvas's own Save.
 */
export function buildWorkflowUpdatePayload(
  workflowId: number,
  data: WorkflowDetailsFormData,
) {
  return { id: workflowId, ...data };
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
