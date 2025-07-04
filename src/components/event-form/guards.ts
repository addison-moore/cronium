/**
 * Type Guards and Validation Utilities for Event Forms
 *
 * This file contains type guards, assertion functions, and validation utilities
 * specifically designed for the EventForm component ecosystem.
 */

import { EventType, RunLocation, EventTriggerType } from "@/shared/schema";

import type {
  EventFormData,
  EventFormErrors,
  EnvironmentVariable,
  HttpRequestConfig,
  EditorSettings,
} from "./types";

import {
  isEnumValue,
  assertDefined,
  ValidationError,
} from "@/lib/advanced-types";

// ===== TYPE GUARDS =====

/**
 * Type guard to check if event type requires script content
 */
export function requiresScriptContent(eventType: EventType): boolean {
  return [EventType.NODEJS, EventType.PYTHON, EventType.BASH].includes(
    eventType,
  );
}

/**
 * Type guard to check if event type requires HTTP configuration
 */
export function requiresHttpConfig(eventType: EventType): boolean {
  return eventType === EventType.HTTP_REQUEST;
}

/**
 * Type guard to check if trigger type requires schedule configuration
 */
export function requiresScheduleConfig(triggerType: EventTriggerType): boolean {
  return triggerType === EventTriggerType.SCHEDULE;
}

/**
 * Type guard to check if run location requires server selection
 */
export function requiresServerSelection(runLocation: RunLocation): boolean {
  return runLocation === RunLocation.REMOTE;
}

/**
 * Type guard for valid environment variable
 */
export function isValidEnvironmentVariable(
  envVar: any,
): envVar is EnvironmentVariable {
  return (
    typeof envVar === "object" &&
    envVar !== null &&
    typeof envVar.key === "string" &&
    typeof envVar.value === "string" &&
    envVar.key.length > 0
  );
}

/**
 * Type guard for valid HTTP request configuration
 */
export function isValidHttpConfig(config: any): config is HttpRequestConfig {
  const validMethods = [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "PATCH",
    "HEAD",
    "OPTIONS",
  ];

  return (
    typeof config === "object" &&
    config !== null &&
    validMethods.includes(config.method) &&
    typeof config.url === "string" &&
    config.url.length > 0 &&
    Array.isArray(config.headers) &&
    typeof config.body === "string"
  );
}

/**
 * Type guard for valid editor settings
 */
export function isValidEditorSettings(
  settings: any,
): settings is EditorSettings {
  const validThemes = ["vs-dark", "vs-light", "hc-black"];

  return (
    typeof settings === "object" &&
    settings !== null &&
    typeof settings.fontSize === "number" &&
    validThemes.includes(settings.theme) &&
    typeof settings.wordWrap === "boolean" &&
    typeof settings.minimap === "boolean" &&
    typeof settings.lineNumbers === "boolean"
  );
}

/**
 * Type guard for valid cron expression
 */
export function isValidCronExpression(expression: string): boolean {
  // Basic cron validation (5 fields: minute hour day month dayOfWeek)
  const cronRegex =
    /^(\*|([0-5]?\d)) (\*|([01]?\d|2[0-3])) (\*|([0-2]?\d|3[01])) (\*|([0-9]|1[0-2])) (\*|([0-6]))$/;
  return cronRegex.test(expression.trim());
}

/**
 * Type guard for valid URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Type guard for valid positive integer
 */
export function isValidPositiveInteger(value: any): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Type guard for valid event name
 */
export function isValidEventName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length >= 3 &&
    name.length <= 255 &&
    /^[a-zA-Z0-9\s\-_]+$/.test(name)
  );
}

// ===== ASSERTION FUNCTIONS =====

/**
 * Assert that event type is valid for form submission
 */
export function assertValidEventType(
  eventType: unknown,
): asserts eventType is EventType {
  if (!isEnumValue(EventType, eventType)) {
    throw new ValidationError(
      "Invalid event type",
      "type",
      "INVALID_EVENT_TYPE",
    );
  }
}

/**
 * Assert that event has required fields based on its type
 */
export function assertEventHasRequiredFields<T extends EventType>(
  eventData: EventFormData<T>,
  eventType: T,
): void {
  assertDefined(eventData.name, "Event name is required");

  if (!isValidEventName(eventData.name)) {
    throw new ValidationError(
      "Event name must be 3-255 characters and contain only letters, numbers, spaces, hyphens, and underscores",
      "name",
      "INVALID_EVENT_NAME",
    );
  }

  if (requiresScriptContent(eventType)) {
    assertDefined(
      eventData.content,
      "Script content is required for script events",
    );
    if (
      typeof eventData.content !== "string" ||
      eventData.content.trim().length === 0
    ) {
      throw new ValidationError(
        "Script content cannot be empty",
        "content",
        "EMPTY_SCRIPT_CONTENT",
      );
    }
  }

  if (requiresHttpConfig(eventType)) {
    assertDefined(
      eventData.httpUrl,
      "HTTP URL is required for HTTP request events",
    );
    if (!isValidUrl(eventData.httpUrl)) {
      throw new ValidationError(
        "Invalid HTTP URL format",
        "httpUrl",
        "INVALID_HTTP_URL",
      );
    }
    assertDefined(
      eventData.httpMethod,
      "HTTP method is required for HTTP request events",
    );
  }

  if (requiresScheduleConfig(eventData.triggerType)) {
    assertDefined(
      eventData.scheduleNumber,
      "Schedule number is required for scheduled events",
    );
    if (
      !isValidPositiveInteger(eventData.scheduleNumber) ||
      eventData.scheduleNumber === 0
    ) {
      throw new ValidationError(
        "Schedule number must be a positive integer",
        "scheduleNumber",
        "INVALID_SCHEDULE_NUMBER",
      );
    }

    if (
      eventData.customSchedule &&
      !isValidCronExpression(eventData.customSchedule)
    ) {
      throw new ValidationError(
        "Invalid cron expression format",
        "customSchedule",
        "INVALID_CRON_EXPRESSION",
      );
    }
  }

  if (requiresServerSelection(eventData.runLocation)) {
    if (
      !eventData.serverId &&
      (!eventData.selectedServerIds || eventData.selectedServerIds.length === 0)
    ) {
      throw new ValidationError(
        "Server selection is required for remote execution",
        "serverId",
        "NO_SERVER_SELECTED",
      );
    }
  }
}

/**
 * Assert that environment variables are valid
 */
export function assertValidEnvironmentVariables(
  envVars: EnvironmentVariable[],
): void {
  const keys = new Set<string>();

  envVars.forEach((envVar, index) => {
    if (!isValidEnvironmentVariable(envVar)) {
      throw new ValidationError(
        `Invalid environment variable at index ${index}`,
        `envVars.${index}`,
        "INVALID_ENV_VAR",
      );
    }

    if (keys.has(envVar.key)) {
      throw new ValidationError(
        `Duplicate environment variable key: ${envVar.key}`,
        `envVars.${index}.key`,
        "DUPLICATE_ENV_VAR_KEY",
      );
    }

    keys.add(envVar.key);
  });
}

// ===== VALIDATION FUNCTIONS =====

/**
 * Validate event form data and return errors
 */
export function validateEventFormData<T extends EventType>(
  data: EventFormData<T>,
): EventFormErrors | null {
  const errors: EventFormErrors = {};

  // Validate name
  if (!data.name || data.name.trim().length === 0) {
    errors.name = "Event name is required";
  } else if (!isValidEventName(data.name)) {
    errors.name = "Invalid event name format";
  }

  // Validate content for script events
  if (
    requiresScriptContent(data.type) &&
    (!data.content || data.content.trim().length === 0)
  ) {
    errors.content = "Script content is required";
  }

  // Validate HTTP configuration
  if (requiresHttpConfig(data.type)) {
    if (!data.httpUrl || data.httpUrl.trim().length === 0) {
      errors.httpUrl = "HTTP URL is required";
    } else if (!isValidUrl(data.httpUrl)) {
      errors.httpUrl = "Invalid URL format";
    }

    if (!data.httpMethod) {
      errors.httpMethod = "HTTP method is required";
    }
  }

  // Validate schedule configuration
  if (requiresScheduleConfig(data.triggerType)) {
    if (
      !isValidPositiveInteger(data.scheduleNumber) ||
      data.scheduleNumber === 0
    ) {
      errors.scheduleNumber = "Schedule number must be a positive integer";
    }

    if (data.customSchedule && !isValidCronExpression(data.customSchedule)) {
      errors.customSchedule = "Invalid cron expression format";
    }
  }

  // Validate timeout
  if (!isValidPositiveInteger(data.timeoutValue) || data.timeoutValue === 0) {
    errors.timeoutValue = "Timeout must be a positive integer";
  }

  // Validate retries
  if (!isValidPositiveInteger(data.retries)) {
    errors.retries = "Retries must be a non-negative integer";
  }

  // Validate max executions
  if (!isValidPositiveInteger(data.maxExecutions)) {
    errors.maxExecutions = "Max executions must be a non-negative integer";
  }

  // Validate environment variables
  try {
    assertValidEnvironmentVariables(data.envVars);
  } catch (error) {
    if (error instanceof ValidationError) {
      if (error.field?.startsWith("envVars.")) {
        const match = /envVars\.(\d+)/.exec(error.field);
        if (match?.[1]) {
          const index = parseInt(match[1], 10);
          errors.envVars = errors.envVars || {};
          errors.envVars[index] =
            error.message ?? "Invalid environment variable";
        }
      }
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Validate individual form field
 */
export function validateFormField<T extends EventType>(
  fieldName: keyof EventFormData<T>,
  value: any,
  eventData: EventFormData<T>,
): string | null {
  switch (fieldName) {
    case "name":
      if (!value || value.trim().length === 0) {
        return "Event name is required";
      }
      if (!isValidEventName(value)) {
        return "Invalid event name format";
      }
      break;

    case "content":
      if (
        requiresScriptContent(eventData.type) &&
        (!value || value.trim().length === 0)
      ) {
        return "Script content is required";
      }
      break;

    case "httpUrl":
      if (requiresHttpConfig(eventData.type)) {
        if (!value || value.trim().length === 0) {
          return "HTTP URL is required";
        }
        if (!isValidUrl(value)) {
          return "Invalid URL format";
        }
      }
      break;

    case "scheduleNumber":
      if (requiresScheduleConfig(eventData.triggerType)) {
        if (!isValidPositiveInteger(value) || value === 0) {
          return "Schedule number must be a positive integer";
        }
      }
      break;

    case "customSchedule":
      if (value && !isValidCronExpression(value)) {
        return "Invalid cron expression format";
      }
      break;

    case "timeoutValue":
      if (!isValidPositiveInteger(value) || value === 0) {
        return "Timeout must be a positive integer";
      }
      break;

    case "retries":
      if (!isValidPositiveInteger(value)) {
        return "Retries must be a non-negative integer";
      }
      break;

    case "maxExecutions":
      if (!isValidPositiveInteger(value)) {
        return "Max executions must be a non-negative integer";
      }
      break;

    default:
      return null;
  }

  return null;
}

// ===== UTILITY FUNCTIONS =====

/**
 * Check if form has any validation errors
 */
export function hasFormErrors(errors: EventFormErrors): boolean {
  if (Object.keys(errors).length === 0) return false;

  return Object.values(errors).some((error) => {
    if (typeof error === "string") return error.length > 0;
    if (typeof error === "object" && error !== null) {
      return Object.values(error).some(
        (nestedError) =>
          typeof nestedError === "string" && nestedError.length > 0,
      );
    }
    return false;
  });
}

/**
 * Get first error message from form errors
 */
export function getFirstFormError(errors: EventFormErrors): string | null {
  for (const [_field, error] of Object.entries(errors)) {
    if (typeof error === "string" && error.length > 0) {
      return error;
    }
    if (typeof error === "object" && error !== null) {
      for (const nestedError of Object.values(error)) {
        if (typeof nestedError === "string" && nestedError.length > 0) {
          return nestedError;
        }
      }
    }
  }
  return null;
}

/**
 * Clean form data for submission (remove undefined/null values)
 */
export function cleanEventFormData<T extends EventType>(
  data: EventFormData<T>,
): EventFormData<T> {
  const cleanData = { ...data };

  // Remove empty/undefined values
  Object.keys(cleanData).forEach((key) => {
    const value = cleanData[key as keyof EventFormData<T>];
    if (value === undefined || value === null || value === "") {
      delete cleanData[key as keyof EventFormData<T>];
    }
  });

  // Clean environment variables
  cleanData.envVars = cleanData.envVars.filter(
    (envVar) => envVar.key && envVar.key.trim().length > 0,
  );

  return cleanData;
}
