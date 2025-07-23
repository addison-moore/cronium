/**
 * Standardized API response patterns for consistent data formats
 */

import type { PaginatedResult } from "./db-patterns";

/**
 * Standard success response
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  metadata?: Record<string, unknown>;
}

/**
 * Standard error response (handled by tRPC error formatter)
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Standard list response
 */
export interface ApiListResponse<T> extends PaginatedResult<T> {
  filters?: {
    search?: string;
    status?: string;
    type?: string;
    [key: string]: unknown;
  };
}

/**
 * Standard mutation response
 */
export interface ApiMutationResponse<T> {
  success: true;
  data: T;
  message?: string;
}

/**
 * Standard bulk operation response
 */
export interface ApiBulkResponse<T> {
  success: true;
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    id: string | number;
    success: boolean;
    data?: T;
    error?: string;
  }>;
}

/**
 * Create a standard success response
 */
export function successResponse<T>(
  data: T,
  metadata?: Record<string, unknown>,
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    ...(metadata && { metadata }),
  };
}

/**
 * Create a standard list response
 */
export function listResponse<T>(
  result: PaginatedResult<T>,
  filters?: ApiListResponse<T>["filters"],
): ApiListResponse<T> {
  const response: ApiListResponse<T> = {
    ...result,
  };
  if (filters) {
    response.filters = filters;
  }
  return response;
}

/**
 * Create a standard mutation response
 */
export function mutationResponse<T>(
  data: T,
  message?: string,
): ApiMutationResponse<T> {
  return {
    success: true,
    data,
    ...(message && { message }),
  };
}

/**
 * Create a bulk operation response
 */
export function bulkResponse<T>(
  results: ApiBulkResponse<T>["results"],
): ApiBulkResponse<T> {
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    success: true,
    total: results.length,
    succeeded,
    failed,
    results,
  };
}

/**
 * Standard resource response with relationships
 */
export interface ApiResourceResponse<T> {
  data: T;
  relationships?: Record<string, unknown>;
  metadata?: {
    createdAt?: string;
    updatedAt?: string;
    version?: number;
  } & Record<string, unknown>;
}

/**
 * Create a resource response with relationships
 */
export function resourceResponse<T>(
  data: T,
  relationships?: ApiResourceResponse<T>["relationships"],
  metadata?: ApiResourceResponse<T>["metadata"],
): ApiResourceResponse<T> {
  return {
    data,
    ...(relationships && { relationships }),
    ...(metadata && { metadata }),
  };
}

/**
 * Standard health check response
 */
export interface ApiHealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  timestamp: string;
  services?: Record<
    string,
    {
      status: "up" | "down";
      latency?: number;
      error?: string;
    }
  >;
}

/**
 * Create a health check response
 */
export function healthResponse(
  status: ApiHealthResponse["status"],
  services?: ApiHealthResponse["services"],
): ApiHealthResponse {
  const response: ApiHealthResponse = {
    status,
    version: process.env.npm_package_version ?? "unknown",
    timestamp: new Date().toISOString(),
  };
  if (services) {
    response.services = services;
  }
  return response;
}

/**
 * Standard stats/metrics response
 */
export interface ApiStatsResponse {
  period: {
    start: string;
    end: string;
  };
  metrics: Record<string, number | string>;
  breakdown?: Record<
    string,
    Array<{
      label: string;
      value: number;
    }>
  >;
}

/**
 * Create a stats response
 */
export function statsResponse(
  period: ApiStatsResponse["period"],
  metrics: ApiStatsResponse["metrics"],
  breakdown?: ApiStatsResponse["breakdown"],
): ApiStatsResponse {
  const response: ApiStatsResponse = {
    period,
    metrics,
  };
  if (breakdown) {
    response.breakdown = breakdown;
  }
  return response;
}

/**
 * Transform raw database records to API format
 */
export function transformDates<T extends Record<string, unknown>>(
  record: T,
  dateFields: Array<keyof T> = ["createdAt", "updatedAt"],
): T {
  const transformed = { ...record };

  for (const field of dateFields) {
    if (transformed[field] instanceof Date) {
      // TypeScript needs help understanding this mutation is safe
      (transformed as Record<string, unknown>)[field as string] = (
        transformed[field] as Date
      ).toISOString();
    }
  }

  return transformed;
}

/**
 * Remove sensitive fields from responses
 */
export function sanitizeResponse<T extends Record<string, unknown>>(
  record: T,
  sensitiveFields: Array<keyof T> = ["password", "sshKey", "apiKey"],
): Omit<T, keyof (typeof sensitiveFields)[number]> {
  const sanitized = { ...record };

  for (const field of sensitiveFields) {
    delete sanitized[field];
  }

  return sanitized;
}

/**
 * Standard file download response headers
 */
export interface ApiDownloadHeaders {
  "Content-Type": string;
  "Content-Disposition": string;
  "Content-Length"?: string;
  "Cache-Control"?: string;
}

/**
 * Create download headers
 */
export function downloadHeaders(
  filename: string,
  contentType: string,
  size?: number,
): ApiDownloadHeaders {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    ...(size && { "Content-Length": size.toString() }),
    "Cache-Control": "no-cache",
  };
}
