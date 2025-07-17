/**
 * Centralized error handling utilities for consistent error logging and reporting
 */

import { TRPCError } from "@trpc/server";

export enum ErrorSeverity {
  DEBUG = "debug",
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}

export interface ErrorContext {
  component?: string;
  operation?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export class ErrorHandler {
  private static instance: ErrorHandler;

  private constructor() {
    // Private constructor for singleton pattern
  }

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * Log an error with context
   */
  logError(
    error: unknown,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    context?: ErrorContext,
  ): void {
    const errorMessage = this.formatError(error);
    const timestamp = new Date().toISOString();

    const logEntry = {
      timestamp,
      severity,
      message: errorMessage,
      ...context,
      stack: error instanceof Error ? error.stack : undefined,
    };

    // Log to console based on severity
    switch (severity) {
      case ErrorSeverity.DEBUG:
        console.debug(logEntry);
        break;
      case ErrorSeverity.INFO:
        console.info(logEntry);
        break;
      case ErrorSeverity.WARNING:
        console.warn(logEntry);
        break;
      case ErrorSeverity.ERROR:
        console.error(logEntry);
        break;
      case ErrorSeverity.CRITICAL:
        console.error("🚨 CRITICAL ERROR:", logEntry);
        break;
    }

    // TODO: Send to monitoring service (e.g., Sentry, LogRocket) in production
  }

  /**
   * Log an error that can be safely ignored
   */
  logIgnoredError(
    error: unknown,
    reason: string,
    context?: ErrorContext,
  ): void {
    this.logError(error, ErrorSeverity.DEBUG, {
      ...context,
      metadata: {
        ...context?.metadata,
        ignoredReason: reason,
      },
    });
  }

  /**
   * Convert various error types to a consistent string format
   */
  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    if (error && typeof error === "object" && "message" in error) {
      return String(error.message);
    }
    return "Unknown error";
  }

  /**
   * Determine if an error is a known safe error that can be ignored
   */
  isSafeError(error: unknown): boolean {
    if (error instanceof Error) {
      // Common safe errors
      const safePatterns = [
        /connection.*closed/i,
        /operation.*cancelled/i,
        /cleanup.*failed/i,
        /already.*disposed/i,
      ];

      return safePatterns.some((pattern) => pattern.test(error.message));
    }
    return false;
  }

  /**
   * Convert errors to TRPC errors for API responses
   */
  toTRPCError(
    error: unknown,
    fallbackCode: TRPCError["code"] = "INTERNAL_SERVER_ERROR",
  ): TRPCError {
    if (error instanceof TRPCError) {
      return error;
    }

    const message = this.formatError(error);

    // Map common errors to appropriate TRPC codes
    if (message.includes("not found")) {
      return new TRPCError({ code: "NOT_FOUND", message });
    }
    if (
      message.includes("unauthorized") ||
      message.includes("authentication")
    ) {
      return new TRPCError({ code: "UNAUTHORIZED", message });
    }
    if (message.includes("forbidden") || message.includes("permission")) {
      return new TRPCError({ code: "FORBIDDEN", message });
    }
    if (message.includes("invalid") || message.includes("validation")) {
      return new TRPCError({ code: "BAD_REQUEST", message });
    }
    if (message.includes("timeout")) {
      return new TRPCError({ code: "TIMEOUT", message });
    }
    if (message.includes("conflict") || message.includes("already exists")) {
      return new TRPCError({ code: "CONFLICT", message });
    }

    return new TRPCError({ code: fallbackCode, message });
  }
}

// Export singleton instance
export const errorHandler = ErrorHandler.getInstance();

// Export convenience functions
export function logError(
  error: unknown,
  severity: ErrorSeverity = ErrorSeverity.ERROR,
  context?: ErrorContext,
): void {
  errorHandler.logError(error, severity, context);
}

export function logIgnoredError(
  error: unknown,
  reason: string,
  context?: ErrorContext,
): void {
  errorHandler.logIgnoredError(error, reason, context);
}

export function isSafeError(error: unknown): boolean {
  return errorHandler.isSafeError(error);
}

export function toTRPCError(
  error: unknown,
  fallbackCode?: TRPCError["code"],
): TRPCError {
  return errorHandler.toTRPCError(error, fallbackCode);
}
