/**
 * Advanced TypeScript Patterns for Cronium
 *
 * This file contains sophisticated type utilities that provide type safety
 * and better developer experience across the application.
 */

import {
  EventType,
  type RunLocation,
  type TimeUnit,
  type ConditionalActionType,
  type EventTriggerType,
  UserRole,
  type ToolType,
} from "@/shared/schema";

// ===== UTILITY TYPES =====

/**
 * Make certain properties optional while keeping others required
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// ===== TEMPLATE LITERAL TYPES =====

/**
 * Type-safe API route patterns
 */
export type ApiRoute<T extends string = string> = `/api/${T}`;

/**
 * Type-safe dashboard routes
 */
export type DashboardRoute =
  | `/dashboard`
  | `/dashboard/events`
  | `/dashboard/events/${number}`
  | `/dashboard/events/${number}/edit`
  | `/dashboard/servers`
  | `/dashboard/servers/${number}`
  | `/dashboard/workflows`
  | `/dashboard/logs`
  | `/dashboard/admin`
  | `/dashboard/console`
  | `/dashboard/monitoring`;

/**
 * Environment variable patterns
 */
export type EnvVarKey = `${string}_${Uppercase<string>}` | Uppercase<string>;

/**
 * Cron expression validation pattern
 */
export type CronExpression =
  `${number | "*"} ${number | "*"} ${number | "*"} ${number | "*"} ${number | "*"}`;

// ===== CONDITIONAL TYPES =====

/**
 * Event configuration based on event type
 */
export type EventTypeConfig<T extends EventType> =
  T extends EventType.HTTP_REQUEST
    ? {
        httpMethod: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
        httpUrl: string;
        httpHeaders?: Record<string, string>;
        httpBody?: string;
        content?: never;
      }
    : T extends EventType.NODEJS | EventType.PYTHON | EventType.BASH
      ? {
          content: string;
          httpMethod?: never;
          httpUrl?: never;
          httpHeaders?: never;
          httpBody?: never;
        }
      : never;

/**
 * Conditional action configuration based on action type
 */
export type ConditionalActionConfig<T extends ConditionalActionType> =
  T extends ConditionalActionType.SEND_MESSAGE
    ? {
        toolId: number;
        message: string;
        emailAddresses?: string;
        emailSubject?: string;
        targetEventId?: never;
      }
    : T extends ConditionalActionType.SCRIPT
      ? {
          targetEventId: number;
          toolId?: never;
          message?: never;
          emailAddresses?: never;
          emailSubject?: never;
        }
      : T extends ConditionalActionType.NONE
        ? {
            toolId?: never;
            message?: never;
            emailAddresses?: never;
            emailSubject?: never;
            targetEventId?: never;
          }
        : never;

/**
 * Server requirements based on run location
 */
export type ServerRequirement<T extends RunLocation> =
  T extends RunLocation.REMOTE
    ? { serverId: number; servers?: number[] }
    : T extends RunLocation.LOCAL
      ? { serverId?: never; servers?: never }
      : never;

// ===== DISCRIMINATED UNIONS =====

/**
 * Type-safe event configuration union
 */
export type EventConfig =
  | (EventTypeConfig<EventType.HTTP_REQUEST> & { type: EventType.HTTP_REQUEST })
  | (EventTypeConfig<EventType.NODEJS> & { type: EventType.NODEJS })
  | (EventTypeConfig<EventType.PYTHON> & { type: EventType.PYTHON })
  | (EventTypeConfig<EventType.BASH> & { type: EventType.BASH });

/**
 * Type-safe conditional action union
 */
export type ConditionalAction<
  T extends ConditionalActionType = ConditionalActionType,
> = {
  id?: number;
  type: "ON_SUCCESS" | "ON_FAILURE" | "ALWAYS" | "ON_CONDITION";
  action: T;
} & ConditionalActionConfig<T>;

/**
 * Basic API Response patterns (deprecated - use ApiResponse below)
 */
export type BasicApiResponse<T = unknown> =
  | { success: true; data: T; error?: never }
  | { success: false; error: string; data?: never };

/**
 * Form field states
 */
export type FormFieldState =
  | { status: "idle"; value: string; error?: never }
  | { status: "validating"; value: string; error?: never }
  | { status: "error"; value: string; error: string }
  | { status: "success"; value: string; error?: never };

// ===== MAPPED TYPES =====

/**
 * Form state for event fields
 */
export type EventFormState<T extends Record<string, unknown>> = {
  [K in keyof T]: FormFieldState;
};

// ===== COMPLEX UTILITY TYPES =====

/**
 * Type-safe event scheduling configuration
 */
export type ScheduleConfig<T extends EventTriggerType> =
  T extends EventTriggerType.SCHEDULE
    ? {
        triggerType: EventTriggerType.SCHEDULE;
        scheduleNumber: number;
        scheduleUnit: TimeUnit;
        customSchedule?: string;
        startTime?: string;
      }
    : T extends EventTriggerType.MANUAL
      ? {
          triggerType: EventTriggerType.MANUAL;
          scheduleNumber?: never;
          scheduleUnit?: never;
          customSchedule?: never;
          startTime?: never;
        }
      : never;

/**
 * Tool configuration based on tool type
 */
export type ToolConfig<T extends ToolType> = {
  type: T;
  name: string;
  credentials: T extends ToolType.EMAIL
    ? {
        smtpHost: string;
        smtpPort: number;
        smtpUser: string;
        smtpPassword: string;
        fromEmail: string;
        fromName?: string;
        enableTLS?: boolean;
      }
    : T extends ToolType.SLACK
      ? {
          webhookUrl: string;
          channel?: string;
          username?: string;
        }
      : T extends ToolType.DISCORD
        ? {
            webhookUrl: string;
            username?: string;
            avatarUrl?: string;
          }
        : T extends ToolType.WEBHOOK
          ? {
              url: string;
              method?: "GET" | "POST" | "PUT" | "DELETE";
              headers?: Record<string, string>;
              authToken?: string;
            }
          : Record<string, unknown>;
};

// ===== BRANDED TYPES =====

/**
 * Branded types for ID safety
 */
export type UserId = string & { readonly __brand: "UserId" };
export type EventId = number & { readonly __brand: "EventId" };
export type ServerId = number & { readonly __brand: "ServerId" };
export type ToolId = number & { readonly __brand: "ToolId" };

// ===== TYPE PREDICATES AND GUARDS =====

/**
 * Type guard for checking if a value is a valid enum value
 */
export function isEnumValue<T extends Record<string, string>>(
  enumObject: T,
  value: unknown,
): value is T[keyof T] {
  return Object.values(enumObject).includes(value as string);
}

/**
 * Type guard for API responses
 */
export function isSuccessResponse<T>(
  response: ApiResponse<T>,
): response is { success: true; data: T } {
  return response.success === true;
}

/**
 * Type guard for error responses
 */
export function isErrorResponse<T>(
  response: ApiResponse<T>,
): response is { success: false; error: string } {
  return response.success === false;
}

/**
 * Type guard for checking event type
 */
export function isHttpEvent(
  event: EventConfig,
): event is EventTypeConfig<EventType.HTTP_REQUEST> & {
  type: EventType.HTTP_REQUEST;
} {
  return event.type === EventType.HTTP_REQUEST;
}

/**
 * Type guard for checking script event
 */
export function isScriptEvent(
  event: EventConfig,
): event is EventTypeConfig<
  EventType.NODEJS | EventType.PYTHON | EventType.BASH
> & { type: EventType.NODEJS | EventType.PYTHON | EventType.BASH } {
  return [EventType.NODEJS, EventType.PYTHON, EventType.BASH].includes(
    event.type,
  );
}

// ===== ASSERTION FUNCTIONS =====

/**
 * Assert that a value is defined (not null or undefined)
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message ?? "Value must be defined");
  }
}

/**
 * Assert that a value is a valid event type
 */
export function assertValidEventType(
  value: unknown,
): asserts value is EventType {
  if (!isEnumValue(EventType, value)) {
    throw new Error(`Invalid event type: ${String(value)}`);
  }
}

/**
 * Assert that a value is a valid user role
 */
export function assertValidUserRole(value: unknown): asserts value is UserRole {
  if (!isEnumValue(UserRole, value)) {
    throw new Error(`Invalid user role: ${String(value)}`);
  }
}

// ===== ERROR TYPES =====

/**
 * Application-specific error types
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public code = "VALIDATION_ERROR",
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AuthorizationError extends Error {
  constructor(
    message = "Unauthorized access",
    public requiredRole?: UserRole,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class ResourceNotFoundError extends Error {
  constructor(resource: string, id: string | number) {
    super(`${resource} with id ${id} not found`);
    this.name = "ResourceNotFoundError";
  }
}

// ===== DATABASE TYPE SAFETY UTILITIES =====

/**
 * Type-safe database query result handling
 */
export type DatabaseQueryResult<T> = T[] | undefined;

/**
 * Type-safe tRPC handler wrapper
 */
export type SafeTRPCHandler<TInput, TOutput> = (
  input: TInput,
) => Promise<TOutput> | TOutput;

/**
 * Enhanced API response type with error handling
 */
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Create safe API response
 */
export function createApiResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

/**
 * Create error API response
 */
export function createErrorResponse(
  error: string,
  code?: string,
): ApiResponse<never> {
  return code ? { success: false, error, code } : { success: false, error };
}
