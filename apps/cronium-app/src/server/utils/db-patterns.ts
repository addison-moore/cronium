/**
 * Reusable database patterns and utilities to reduce code duplication
 */

import { or, eq, ilike } from "drizzle-orm";
import type { SQL, AnyColumn } from "drizzle-orm";

/**
 * Standardized pagination input
 */
export interface PaginationInput {
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
}

/**
 * Standardized pagination result
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Convert various pagination inputs to standard offset/limit
 */
export function normalizePagination(input: PaginationInput): {
  limit: number;
  offset: number;
} {
  const limit = input.limit ?? input.pageSize ?? 50;
  const offset = input.offset ?? ((input.page ?? 1) - 1) * limit;

  // Enforce reasonable limits
  const safeLimit = Math.min(Math.max(1, limit), 1000);
  const safeOffset = Math.max(0, offset);

  return { limit: safeLimit, offset: safeOffset };
}

/**
 * Create a paginated result object
 */
export function createPaginatedResult<T>(
  items: T[],
  total: number,
  pagination: { limit: number; offset: number },
): PaginatedResult<T> {
  return {
    items,
    total,
    limit: pagination.limit,
    offset: pagination.offset,
    hasMore: pagination.offset + items.length < total,
  };
}

/**
 * Build search conditions for common text fields
 */
export function buildSearchConditions(
  search: string | undefined,
  fields: Array<AnyColumn | SQL | undefined>,
): SQL | undefined {
  if (!search || search.trim().length === 0) {
    return undefined;
  }

  const searchPattern = `%${search.trim()}%`;
  const conditions = fields
    .filter((field): field is AnyColumn | SQL => field !== undefined)
    .map((field) => ilike(field, searchPattern));

  if (conditions.length === 0) {
    return undefined;
  }

  return conditions.length === 1 ? conditions[0] : or(...conditions);
}

/**
 * Build user access conditions (owned or shared)
 */
export function buildUserAccessConditions(
  userId: string,
  userIdField: AnyColumn,
  sharedField?: AnyColumn,
): SQL {
  if (sharedField) {
    return or(eq(userIdField, userId), eq(sharedField, true))!;
  }
  return eq(userIdField, userId);
}

/**
 * Sort direction type
 */
export type SortDirection = "asc" | "desc";
