import { z } from "zod";
import {
  EventType,
  EventStatus,
  RunLocation,
  TimeUnit,
  EventTriggerType,
  CatchupPolicy,
  OverlapPolicy,
  LeaseLossPolicy,
} from "../schema";
import {
  intervalSecondsFor,
  validateCronExpr,
  validateIntervalSeconds,
} from "@/lib/scheduling/schedule-math";

// Shared refinement pieces for schedule fields
const timezoneField = z
  .string()
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Unknown timezone (use an IANA name like America/New_York)" },
  );
const priorityField = z.number().int().min(0).max(3);

// Base event query schema
export const eventQuerySchema = z.object({
  limit: z.number().min(1).max(1000).default(20), // Increased limit for client-side filtering
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
  status: z.nativeEnum(EventStatus).optional(),
  type: z.nativeEnum(EventType).optional(),
  shared: z.boolean().optional(),
});

// Environment variable schema
export const envVarSchema = z.object({
  key: z.string().min(1, "Environment variable key is required"),
  value: z.string(),
});

// HTTP header schema
export const httpHeaderSchema = z.object({
  key: z.string().min(1, "Header key is required"),
  value: z.string(),
});

// Create event schema
export const createEventSchema = z
  .object({
    name: z
      .string()
      .min(1, "Event name is required")
      .max(100, "Event name must be less than 100 characters"),
    description: z
      .string()
      .max(500, "Description must be less than 500 characters")
      .optional(),
    shared: z.boolean().default(false),
    tags: z.array(z.string()).default([]),

    // Event type and content
    type: z.nativeEnum(EventType, { message: "Event type is required" }),
    content: z.string().optional(),

    // HTTP Request specific fields
    httpMethod: z.string().optional(),
    httpUrl: z.string().url("Invalid URL format").optional(),
    httpHeaders: z.array(httpHeaderSchema).default([]),
    httpBody: z.string().optional(),

    // Tool Action specific fields
    toolActionConfig: z.string().optional(),

    // Status and scheduling
    status: z.nativeEnum(EventStatus).default(EventStatus.DRAFT),
    triggerType: z
      .nativeEnum(EventTriggerType)
      .default(EventTriggerType.MANUAL),
    scheduleNumber: z
      .number()
      .min(1, "Schedule number must be at least 1")
      .optional(),
    scheduleUnit: z.nativeEnum(TimeUnit).default(TimeUnit.MINUTES),
    customSchedule: z.string().optional(),
    startTime: z.string().datetime().optional().nullable(),

    // Durable-scheduler options (PLAN.md §3.1)
    timezone: timezoneField.default("UTC"),
    catchupPolicy: z.nativeEnum(CatchupPolicy).default(CatchupPolicy.SKIP),
    overlapPolicy: z.nativeEnum(OverlapPolicy).default(OverlapPolicy.ALLOW),
    leaseLossPolicy: z
      .nativeEnum(LeaseLossPolicy)
      .default(LeaseLossPolicy.RETRY),
    priority: priorityField.default(1),

    // Execution settings
    runLocation: z.nativeEnum(RunLocation).default(RunLocation.LOCAL),
    serverId: z.number().optional().nullable(),
    selectedServerIds: z.array(z.number()).default([]),
    timeoutValue: z.number().min(1, "Timeout must be at least 1").default(30),
    timeoutUnit: z.nativeEnum(TimeUnit).default(TimeUnit.MINUTES),
    retries: z
      .number()
      .min(0, "Retries must be 0 or more")
      .max(10, "Maximum 10 retries allowed")
      .default(0),
    maxExecutions: z
      .number()
      .min(0, "Max executions must be 0 or more")
      .default(0),
    resetCounterOnActive: z.boolean().default(false),

    // Environment variables and conditional events
    envVars: z.array(envVarSchema).default([]),
  })
  .refine(
    (data) => {
      // Validate HTTP request fields
      if (data.type === EventType.HTTP_REQUEST) {
        return data.httpUrl && data.httpMethod;
      }
      return true;
    },
    {
      message: "HTTP URL and method are required for HTTP request events",
      path: ["httpUrl"],
    },
  )
  .refine(
    (data) => {
      // Validate script content for script events (not HTTP or Tool Actions)
      if (
        data.type !== EventType.HTTP_REQUEST &&
        data.type !== EventType.TOOL_ACTION
      ) {
        return data.content && data.content.trim().length > 0;
      }
      return true;
    },
    {
      message: "Script content is required for script events",
      path: ["content"],
    },
  )
  .refine(
    (data) => {
      // Validate tool action configuration for tool action events
      if (data.type === EventType.TOOL_ACTION) {
        return data.toolActionConfig && data.toolActionConfig.trim().length > 0;
      }
      return true;
    },
    {
      message: "Tool action configuration is required for tool action events",
      path: ["toolActionConfig"],
    },
  )
  .refine(
    (data) => {
      // Validate server selection for remote execution (REMOTE or
      // LOCAL_AND_REMOTE)
      if (data.runLocation !== RunLocation.LOCAL) {
        return data.serverId ?? data.selectedServerIds.length > 0;
      }
      return true;
    },
    {
      message: "Server selection is required for remote execution",
      path: ["serverId"],
    },
  )
  .refine(
    (data) => {
      // Validate schedule fields for scheduled events
      if (
        data.triggerType === EventTriggerType.SCHEDULE &&
        data.status === EventStatus.ACTIVE
      ) {
        return data.scheduleNumber ?? data.customSchedule;
      }
      return true;
    },
    {
      message: "Schedule configuration is required for active scheduled events",
      path: ["scheduleNumber"],
    },
  )
  .refine(
    (data) =>
      !data.customSchedule ||
      validateCronExpr(data.customSchedule, data.timezone ?? "UTC").valid,
    {
      message: "Invalid cron expression",
      path: ["customSchedule"],
    },
  )
  .refine(
    (data) => {
      if (data.customSchedule || data.triggerType !== EventTriggerType.SCHEDULE)
        return true;
      if (!data.scheduleNumber) return true;
      return (
        validateIntervalSeconds(
          intervalSecondsFor(data.scheduleNumber, data.scheduleUnit),
        ) === null
      );
    },
    {
      message: "Intervals below 10 seconds are not supported",
      path: ["scheduleNumber"],
    },
  );

// Update event schema (partial of create schema with id)
export const updateEventSchema = z.object({
  id: z.number().int().positive("Event ID must be a positive integer"),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  shared: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  type: z.nativeEnum(EventType).optional(),
  content: z.string().optional(),
  httpMethod: z.string().optional(),
  httpUrl: z.string().url().optional(),
  httpHeaders: z.array(httpHeaderSchema).optional(),
  httpBody: z.string().optional(),
  toolActionConfig: z.string().optional(),
  status: z.nativeEnum(EventStatus).optional(),
  triggerType: z.nativeEnum(EventTriggerType).optional(),
  scheduleNumber: z.number().min(1).optional(),
  scheduleUnit: z.nativeEnum(TimeUnit).optional(),
  customSchedule: z
    .string()
    .optional()
    .refine((expr) => !expr || validateCronExpr(expr).valid, {
      message: "Invalid cron expression",
    }),
  startTime: z.string().datetime().optional().nullable(),
  timezone: timezoneField.optional(),
  catchupPolicy: z.nativeEnum(CatchupPolicy).optional(),
  overlapPolicy: z.nativeEnum(OverlapPolicy).optional(),
  leaseLossPolicy: z.nativeEnum(LeaseLossPolicy).optional(),
  priority: priorityField.optional(),
  runLocation: z.nativeEnum(RunLocation).optional(),
  serverId: z.number().optional().nullable(),
  selectedServerIds: z.array(z.number()).optional(),
  timeoutValue: z.number().min(1).optional(),
  timeoutUnit: z.nativeEnum(TimeUnit).optional(),
  retries: z.number().min(0).max(10).optional(),
  maxExecutions: z.number().min(0).optional(),
  resetCounterOnActive: z.boolean().optional(),
  envVars: z.array(envVarSchema).optional(),
});

/** Strict compatibility schema for the legacy REST PATCH/PUT endpoint. */
export const legacyEventPatchSchema = updateEventSchema
  .omit({ id: true })
  .extend({ httpRequest: z.string().optional() })
  .strict();

// Event ID parameter schema
export const eventIdSchema = z.object({
  id: z.number().int().positive("Event ID must be a positive integer"),
});

// Event execution schema
export const executeEventSchema = z.object({
  id: z.number().int().positive("Event ID must be a positive integer"),
  serverId: z.number().int().positive().optional(),
  manual: z.boolean().default(true),
  // Manual-run input payload, forwarded to dispatch and readable by the
  // script via cronium.input(). Must be declared here: zod strips undeclared
  // keys, which silently dropped every manual-run input (FINDINGS #13).
  input: z.record(z.string(), z.any()).optional(),
});

// Event logs query schema
export const eventLogsSchema = z.object({
  id: z.number().int().positive("Event ID must be a positive integer"),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
  status: z.string().optional(),
});

// Event activation schema
export const eventActivationSchema = z.object({
  id: z.number().int().positive("Event ID must be a positive integer"),
  resetCounter: z.boolean().default(false),
});

// Event download schema
export const eventDownloadSchema = z.object({
  eventIds: z
    .array(z.number().int().positive())
    .min(1, "At least one event must be selected"),
  format: z.enum(["json"]).default("json"),
});

// Event filter schema - for lightweight data used in dropdowns/filters
export const eventFilterSchema = z.object({
  limit: z.number().min(1).max(200).default(100),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
  status: z.nativeEnum(EventStatus).optional(),
});

// Type definitions inferred from schemas
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type EventQueryInput = z.infer<typeof eventQuerySchema>;
export type ExecuteEventInput = z.infer<typeof executeEventSchema>;
export type EventLogsInput = z.infer<typeof eventLogsSchema>;
export type EventActivationInput = z.infer<typeof eventActivationSchema>;
export type EventDownloadInput = z.infer<typeof eventDownloadSchema>;
export type EventFilterInput = z.infer<typeof eventFilterSchema>;
export type EnvVar = z.infer<typeof envVarSchema>;
export type HttpHeader = z.infer<typeof httpHeaderSchema>;
