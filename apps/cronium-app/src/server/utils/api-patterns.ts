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
 * Standard file download response headers
 */
export interface ApiDownloadHeaders {
  "Content-Type": string;
  "Content-Disposition": string;
  "Content-Length"?: string;
  "Cache-Control"?: string;
}
