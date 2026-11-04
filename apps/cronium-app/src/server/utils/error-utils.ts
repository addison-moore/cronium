/**
 * Reusable error handling utilities for tRPC routers
 */

import { TRPCError } from "@trpc/server";
import { logError, ErrorSeverity, toTRPCError } from "@/lib/error-handler";
import type { ErrorContext } from "@/lib/error-handler";

/**
 * Standard error messages
 */
export const ErrorMessages = {
  UNAUTHORIZED: "Authentication required",
  FORBIDDEN: "You don't have permission to perform this action",
  NOT_FOUND: (resource: string) => `${resource} not found`,
  CONFLICT: (resource: string) => `${resource} already exists`,
  VALIDATION: (field: string, message: string) => `${field}: ${message}`,
  RATE_LIMIT: "Too many requests. Please try again later.",
  INTERNAL: "An unexpected error occurred",
} as const;

/**
 * Wrap an async operation with error handling
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: ErrorContext & {
    operationName: string;
    resourceType?: string;
  },
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // Log the error with context
    const errorContext: ErrorContext = {
      component: context.component ?? "tRPC Router",
      operation: context.operationName,
    };
    if (context.userId) {
      errorContext.userId = context.userId;
    }
    if (context.metadata || context.resourceType) {
      errorContext.metadata = {
        ...context.metadata,
        ...(context.resourceType ? { resourceType: context.resourceType } : {}),
      };
    }
    logError(error, ErrorSeverity.ERROR, errorContext);

    // Convert to TRPC error
    throw toTRPCError(error);
  }
}

/**
 * Create a standardized validation error
 */
export function validationError(
  field: string,
  message: string,
  value?: unknown,
): TRPCError {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: ErrorMessages.VALIDATION(field, message),
    cause: { field, value },
  });
}

/**
 * Create a standardized not found error
 */
export function notFoundError(
  resourceType: string,
  id?: string | number,
): TRPCError {
  const message = id
    ? `${resourceType} with ID ${id} not found`
    : ErrorMessages.NOT_FOUND(resourceType);

  return new TRPCError({
    code: "NOT_FOUND",
    message,
    cause: { resourceType, id },
  });
}

/**
 * Create a standardized permission error
 */
export function permissionError(
  action: string,
  resourceType?: string,
  resourceId?: string | number,
): TRPCError {
  const message = resourceType
    ? `You don't have permission to ${action} this ${resourceType}`
    : ErrorMessages.FORBIDDEN;

  return new TRPCError({
    code: "FORBIDDEN",
    message,
    cause: { action, resourceType, resourceId },
  });
}

/**
 * Rate limit error factory
 */
export function rateLimitError(retryAfter?: number): TRPCError {
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: ErrorMessages.RATE_LIMIT,
    cause: { retryAfter },
  });
}
