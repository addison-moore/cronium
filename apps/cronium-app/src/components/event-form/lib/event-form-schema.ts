import { z } from "zod";
import {
  EventType,
  EventStatus,
  RunLocation,
  TimeUnit,
  EventTriggerType,
  CatchupPolicy,
  OverlapPolicy,
} from "@/shared/schema";
import type { ToolActionConfig } from "../ToolActionSection";

// Form schema using Zod (client-side mirror of the server's createEventSchema;
// pure module — no React/tRPC imports so it can be unit-tested directly).
export const eventFormSchema = z
  .object({
    name: z.string().min(1, "Event name is required"),
    description: z.string().optional(),
    shared: z.boolean().default(false),
    type: z.nativeEnum(EventType),
    content: z.string().optional(),
    status: z.nativeEnum(EventStatus),
    triggerType: z.nativeEnum(EventTriggerType),
    scheduleNumber: z.number().min(1).default(5),
    scheduleUnit: z.nativeEnum(TimeUnit).default(TimeUnit.MINUTES),
    startTime: z.string().optional().nullable(),
    useCronScheduling: z.boolean().default(false),
    customSchedule: z.string().optional(),
    timezone: z.string().default("UTC"),
    catchupPolicy: z.nativeEnum(CatchupPolicy).default(CatchupPolicy.SKIP),
    overlapPolicy: z.nativeEnum(OverlapPolicy).default(OverlapPolicy.ALLOW),
    priority: z.number().int().min(0).max(3).default(1),
    timeoutValue: z.number().min(1).default(30),
    timeoutUnit: z.nativeEnum(TimeUnit).default(TimeUnit.SECONDS),
    runLocation: z.nativeEnum(RunLocation).default(RunLocation.LOCAL),
    runOnLocal: z.boolean().default(true),
    selectedServerIds: z.array(z.number()).default([]),
    retries: z.number().min(0).max(10).default(0),
    maxExecutions: z.number().min(0).default(0),
    resetCounterOnActive: z.boolean().default(false),
    envVars: z
      .array(
        z.object({
          key: z.string(),
          value: z.string(),
        }),
      )
      .default([]),
    tags: z.array(z.string()).default([]),
    // HTTP Request specific fields
    httpMethod: z.string().optional(),
    httpUrl: z.string().optional(),
    httpHeaders: z
      .array(
        z.object({
          key: z.string(),
          value: z.string(),
        }),
      )
      .optional(),
    httpBody: z.string().optional(),
    // Tool Action specific field
    toolActionConfig: z.custom<ToolActionConfig>().optional().nullable(),
  })
  .refine(
    (data) => {
      // Validate content is provided for script types
      if (
        [EventType.PYTHON, EventType.BASH, EventType.NODEJS].includes(data.type)
      ) {
        return data.content && data.content.trim().length > 0;
      }
      return true;
    },
    {
      message: "Script content is required",
      path: ["content"],
    },
  )
  .refine(
    (data) => {
      // Validate HTTP request fields
      if (data.type === EventType.HTTP_REQUEST) {
        return data.httpMethod && data.httpUrl;
      }
      return true;
    },
    {
      message: "HTTP method and URL are required",
      path: ["httpUrl"],
    },
  )
  .refine(
    (data) => {
      // Validate Tool Action config
      if (data.type === EventType.TOOL_ACTION) {
        return data.toolActionConfig?.toolId && data.toolActionConfig.actionId;
      }
      return true;
    },
    {
      message: "Tool and action selection is required",
      path: ["toolActionConfig"],
    },
  )
  .refine(
    (data) => {
      // At least one execution location: local and/or a remote server
      return data.runOnLocal || data.selectedServerIds.length > 0;
    },
    {
      message: "Select at least one execution location",
      path: ["selectedServerIds"],
    },
  );

export type EventFormData = z.infer<typeof eventFormSchema>;
