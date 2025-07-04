import { z } from "zod";
import {
  EventType,
  EventStatus,
  RunLocation,
  TimeUnit,
  EventTriggerType,
  ConditionalActionType,
} from "../schema";

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

// Conditional event schema - Updated to match frontend data structure
export const conditionalActionSchema = z.object({
  type: z.string(), // ON_SUCCESS, ON_FAILURE, ALWAYS, ON_CONDITION
  action: z.nativeEnum(ConditionalActionType), // SCRIPT or SEND_MESSAGE
  details: z
    .object({
      emailAddresses: z.string().optional(),
      emailSubject: z.string().optional(),
      targetEventId: z.number().optional().nullable(),
      toolId: z.number().optional().nullable(),
      message: z.string().optional(),
    })
    .optional(),
  // Legacy fields for backward compatibility
  value: z.string().optional(),
  targetScriptId: z.number().optional().nullable(),
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
    type: z.nativeEnum(EventType, { required_error: "Event type is required" }),
    content: z.string().optional(),

    // HTTP Request specific fields
    httpMethod: z.string().optional(),
    httpUrl: z.string().url("Invalid URL format").optional(),
    httpHeaders: z.array(httpHeaderSchema).default([]),
    httpBody: z.string().optional(),

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
    onSuccessActions: z.array(conditionalActionSchema).default([]),
    onFailActions: z.array(conditionalActionSchema).default([]),
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
      // Validate script content for non-HTTP events
      if (data.type !== EventType.HTTP_REQUEST) {
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
      // Validate server selection for remote execution
      if (data.runLocation === RunLocation.REMOTE) {
        return data.serverId || data.selectedServerIds.length > 0;
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
        return data.scheduleNumber || data.customSchedule;
      }
      return true;
    },
    {
      message: "Schedule configuration is required for active scheduled events",
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
  status: z.nativeEnum(EventStatus).optional(),
  triggerType: z.nativeEnum(EventTriggerType).optional(),
  scheduleNumber: z.number().min(1).optional(),
  scheduleUnit: z.nativeEnum(TimeUnit).optional(),
  customSchedule: z.string().optional(),
  startTime: z.string().datetime().optional().nullable(),
  runLocation: z.nativeEnum(RunLocation).optional(),
  serverId: z.number().optional().nullable(),
  selectedServerIds: z.array(z.number()).optional(),
  timeoutValue: z.number().min(1).optional(),
  timeoutUnit: z.nativeEnum(TimeUnit).optional(),
  retries: z.number().min(0).max(10).optional(),
  maxExecutions: z.number().min(0).optional(),
  resetCounterOnActive: z.boolean().optional(),
  envVars: z.array(envVarSchema).optional(),
  onSuccessActions: z.array(conditionalActionSchema).optional(),
  onFailActions: z.array(conditionalActionSchema).optional(),
});

// Event ID parameter schema
export const eventIdSchema = z.object({
  id: z.number().int().positive("Event ID must be a positive integer"),
});

// Event execution schema
export const executeEventSchema = z.object({
  id: z.number().int().positive("Event ID must be a positive integer"),
  serverId: z.number().int().positive().optional(),
  manual: z.boolean().default(true),
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
  format: z.enum(["json", "zip"]).default("json"),
});

// Type definitions inferred from schemas
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type EventQueryInput = z.infer<typeof eventQuerySchema>;
export type ExecuteEventInput = z.infer<typeof executeEventSchema>;
export type EventLogsInput = z.infer<typeof eventLogsSchema>;
export type EventActivationInput = z.infer<typeof eventActivationSchema>;
export type EventDownloadInput = z.infer<typeof eventDownloadSchema>;
export type EnvVar = z.infer<typeof envVarSchema>;
export type HttpHeader = z.infer<typeof httpHeaderSchema>;
export type ConditionalAction = z.infer<typeof conditionalActionSchema>;
