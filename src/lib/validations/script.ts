import { z } from "zod";
import {
  EventType,
  EventStatus,
  TimeUnit,
  RunLocation,
  ConditionalActionType,
} from "@/shared/schema";

// Schema for environment variables
export const envVarSchema = z.object({
  key: z.string().min(1, "Key is required"),
  value: z.string().min(1, "Value is required"),
});

// Schema for events (success/failure handlers)
export const eventSchema = z.object({
  type: z.nativeEnum(ConditionalActionType),
  value: z.string().optional(),
  targetScriptId: z.coerce.number().optional(),
});

// HTTP Header schema
export const httpHeaderSchema = z.object({
  key: z.string().min(1, "Header name is required"),
  value: z.string().min(1, "Header value is required"),
});

export type HttpHeader = z.infer<typeof httpHeaderSchema>;

// Schema for script form with conditional validation
export const scriptSchema = z
  .object({
    id: z.number().optional(),
    name: z.string().min(1, "Name is required"),
    type: z.nativeEnum(EventType),

    // Fields that are conditionally required based on script type
    content: z.string().optional(),

    // HTTP Request specific fields
    httpMethod: z.string().optional(),
    httpUrl: z.string().optional(),
    httpHeaders: z.array(httpHeaderSchema).optional(),
    httpBody: z.string().optional(),

    // Common fields
    status: z.nativeEnum(EventStatus),
    isCustomSchedule: z.boolean().default(false),
    scheduleNumber: z.number().min(1, "Schedule number must be at least 1"),
    scheduleUnit: z.nativeEnum(TimeUnit),
    customSchedule: z.string().optional(),
    // Add start time field - optional date field
    startTime: z.union([z.date(), z.string(), z.null()]).optional(),
    useStartTime: z.boolean().default(false),
    maxExecutions: z.number().min(0).default(0),
    resetCounterOnActive: z.boolean().default(false),
    runLocation: z.nativeEnum(RunLocation),
    serverId: z
      .union([
        z.coerce
          .number()
          .refine((id) => id > 0, "Server ID must be a positive number"),
        z.null(),
      ])
      .optional(),
    timeoutValue: z.number().min(1, "Timeout value must be at least 1"),
    timeoutUnit: z.nativeEnum(TimeUnit),
    retries: z.number().min(0, "Retries must be at least 0"),
    envVars: z.array(envVarSchema).default([]),
    onSuccessEvents: z.array(eventSchema).default([]),
    onFailEvents: z.array(eventSchema).default([]),
  })
  .refine(
    (data) => {
      // For HTTP_REQUEST type, require httpUrl and httpMethod
      if (data.type === EventType.HTTP_REQUEST) {
        return !!data.httpUrl && !!data.httpMethod;
      }
      // For all other script types, require content
      return !!data.content;
    },
    {
      message: "Required fields are missing for the selected script type",
      path: ["type"], // Show error on the type field
    },
  )
  .refine(
    (data) => {
      // Validate URL format when HTTP_REQUEST is selected
      if (data.type === EventType.HTTP_REQUEST && data.httpUrl) {
        try {
          new URL(data.httpUrl);
          return true;
        } catch (e) {
          return false;
        }
      }
      return true;
    },
    {
      message: "Please enter a valid URL",
      path: ["httpUrl"],
    },
  )
  .refine(
    (data) => {
      // For REMOTE location, require a valid serverId
      if (data.runLocation === RunLocation.REMOTE) {
        return !!data.serverId && data.serverId > 0;
      }
      // For LOCAL location, serverId is not required
      return true;
    },
    {
      message: "Please select a server for remote execution",
      path: ["serverId"],
    },
  );

export type ScriptFormValues = z.infer<typeof scriptSchema>;
