/**
 * Standardized error response formats for consistent API error handling
 */

import { NextResponse } from "next/server";

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
    requestId?: string;
  };
}

export enum ErrorCode {
  // Client errors
  BAD_REQUEST = "BAD_REQUEST",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED",
  CONFLICT = "CONFLICT",
  UNPROCESSABLE_ENTITY = "UNPROCESSABLE_ENTITY",
  TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS",

  // Server errors
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
  BAD_GATEWAY = "BAD_GATEWAY",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  GATEWAY_TIMEOUT = "GATEWAY_TIMEOUT",

  // Custom errors
  VALIDATION_ERROR = "VALIDATION_ERROR",
  AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR",
  PERMISSION_ERROR = "PERMISSION_ERROR",
  RATE_LIMIT_ERROR = "RATE_LIMIT_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
}

const ERROR_STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.METHOD_NOT_ALLOWED]: 405,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.UNPROCESSABLE_ENTITY]: 422,
  [ErrorCode.TOO_MANY_REQUESTS]: 429,
  [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [ErrorCode.NOT_IMPLEMENTED]: 501,
  [ErrorCode.BAD_GATEWAY]: 502,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.GATEWAY_TIMEOUT]: 504,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.AUTHENTICATION_ERROR]: 401,
  [ErrorCode.PERMISSION_ERROR]: 403,
  [ErrorCode.RATE_LIMIT_ERROR]: 429,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
};

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get statusCode(): number {
    return ERROR_STATUS_MAP[this.code] || 500;
  }

  toResponse(requestId?: string): NextResponse<ErrorResponse> {
    return NextResponse.json(
      {
        error: {
          code: this.code,
          message: this.message,
          details: this.details,
          timestamp: new Date().toISOString(),
          requestId: requestId ?? "",
        },
      },
      { status: this.statusCode },
    );
  }
}

/**
 * Create a standardized error response
 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: unknown,
  requestId?: string,
): NextResponse<ErrorResponse> {
  const error = new ApiError(code, message, details);
  return error.toResponse(requestId);
}

/**
 * Handle unknown errors and convert to standardized format
 */
export function handleApiError(
  error: unknown,
  requestId?: string,
): NextResponse<ErrorResponse> {
  // Handle known ApiError instances
  if (error instanceof ApiError) {
    return error.toResponse(requestId);
  }

  // Handle standard errors
  if (error instanceof Error) {
    // Map common error patterns
    if (error.message.includes("not found")) {
      return errorResponse(
        ErrorCode.NOT_FOUND,
        error.message,
        undefined,
        requestId,
      );
    }
    if (
      error.message.includes("unauthorized") ||
      error.message.includes("authentication")
    ) {
      return errorResponse(
        ErrorCode.UNAUTHORIZED,
        error.message,
        undefined,
        requestId,
      );
    }
    if (
      error.message.includes("forbidden") ||
      error.message.includes("permission")
    ) {
      return errorResponse(
        ErrorCode.FORBIDDEN,
        error.message,
        undefined,
        requestId,
      );
    }
    if (
      error.message.includes("invalid") ||
      error.message.includes("validation")
    ) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        error.message,
        undefined,
        requestId,
      );
    }
    if (error.message.includes("rate limit")) {
      return errorResponse(
        ErrorCode.RATE_LIMIT_ERROR,
        error.message,
        undefined,
        requestId,
      );
    }

    // Log unexpected errors
    console.error("Unhandled error in API:", error);
    return errorResponse(
      ErrorCode.INTERNAL_SERVER_ERROR,
      "An unexpected error occurred",
      undefined,
      requestId,
    );
  }

  // Handle non-Error objects
  console.error("Unknown error type in API:", error);
  return errorResponse(
    ErrorCode.INTERNAL_SERVER_ERROR,
    "An unexpected error occurred",
    undefined,
    requestId,
  );
}

/**
 * Common error factories
 */
export const ApiErrors = {
  badRequest: (message: string, details?: unknown) =>
    new ApiError(ErrorCode.BAD_REQUEST, message, details),

  unauthorized: (message = "Authentication required") =>
    new ApiError(ErrorCode.UNAUTHORIZED, message),

  forbidden: (message = "Insufficient permissions") =>
    new ApiError(ErrorCode.FORBIDDEN, message),

  notFound: (resource: string) =>
    new ApiError(ErrorCode.NOT_FOUND, `${resource} not found`),

  validation: (field: string, message: string) =>
    new ApiError(ErrorCode.VALIDATION_ERROR, message, { field }),

  rateLimit: (retryAfter?: number) =>
    new ApiError(ErrorCode.RATE_LIMIT_ERROR, "Rate limit exceeded", {
      retryAfter,
    }),

  internal: (message = "Internal server error") =>
    new ApiError(ErrorCode.INTERNAL_SERVER_ERROR, message),
};
