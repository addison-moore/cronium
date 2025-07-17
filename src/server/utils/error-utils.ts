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
 * Batch error handler for multiple operations
 */
export async function batchWithErrorHandling<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  context: ErrorContext & { operationName: string },
): Promise<
  Array<{ success: true; result: R } | { success: false; error: TRPCError }>
> {
  return Promise.all(
    items.map(async (item) => {
      try {
        const result = await operation(item);
        return { success: true as const, result };
      } catch (error) {
        logError(error, ErrorSeverity.WARNING, {
          ...context,
          metadata: {
            ...context.metadata,
            item,
          },
        });

        return {
          success: false as const,
          error: toTRPCError(error),
        };
      }
    }),
  );
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
 * Wrap a mutation with transaction and error handling
 */
export async function withTransactionErrorHandling<T>(
  db: { transaction: (callback: (trx: unknown) => Promise<T>) => Promise<T> },
  operation: (trx: unknown) => Promise<T>,
  context: ErrorContext & { operationName: string },
): Promise<T> {
  try {
    return await db.transaction(async (trx: unknown) => {
      try {
        return await operation(trx);
      } catch (error) {
        // Log transaction error
        logError(error, ErrorSeverity.ERROR, {
          ...context,
          metadata: {
            ...context.metadata,
            inTransaction: true,
          },
        });
        throw error;
      }
    });
  } catch (error) {
    // Transaction already rolled back, just convert to TRPC error
    throw toTRPCError(error);
  }
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

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof TRPCError) {
    return [
      "TIMEOUT",
      "INTERNAL_SERVER_ERROR",
      "BAD_GATEWAY",
      "SERVICE_UNAVAILABLE",
    ].includes(error.code);
  }

  if (error instanceof Error) {
    return (
      error.message.toLowerCase().includes("timeout") ||
      error.message.toLowerCase().includes("connection")
    );
  }

  return false;
}

/**
 * Retry an operation with exponential backoff
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    context?: ErrorContext;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 100,
    maxDelay = 5000,
    context,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === maxRetries - 1) {
        throw error;
      }

      const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

      if (context) {
        logError(error, ErrorSeverity.WARNING, {
          ...context,
          metadata: {
            ...context.metadata,
            attempt: attempt + 1,
            retryDelay: delay,
          },
        });
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
