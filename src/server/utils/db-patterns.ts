/**
 * Reusable database patterns and utilities to reduce code duplication
 */

import { or, eq, ilike, desc, asc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

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
  const offset = input.offset ?? ((input.page ?? 1) - 1) * limit ?? 0;

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
  fields: Array<SQL | undefined>,
): SQL | undefined {
  if (!search || search.trim().length === 0) {
    return undefined;
  }

  const searchPattern = `%${search.trim()}%`;
  const conditions = fields
    .filter((field): field is SQL => field !== undefined)
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
  userIdField: SQL,
  sharedField?: SQL,
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

/**
 * Build order by clause
 */
export function buildOrderBy(
  field: SQL,
  direction: SortDirection = "desc",
): SQL {
  return direction === "asc" ? asc(field) : desc(field);
}

/**
 * Common permission check that throws if unauthorized
 */
export async function checkResourceAccess<
  T extends { userId: string; shared?: boolean },
>(resource: T | undefined, userId: string, resourceType: string): Promise<T> {
  if (!resource) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${resourceType} not found`,
    });
  }

  if (resource.userId !== userId && !resource.shared) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You don't have permission to access this ${resourceType}`,
    });
  }

  return resource;
}

/**
 * Batch permission check for multiple resources
 */
export function filterAccessibleResources<
  T extends { userId: string; shared?: boolean },
>(resources: T[], userId: string): T[] {
  return resources.filter(
    (resource) => resource.userId === userId || resource.shared === true,
  );
}

/**
 * Build a count query for pagination
 */
export function buildCountQuery(baseQuery: SQL, table: string): SQL<number> {
  return sql<number>`SELECT COUNT(*) FROM ${sql.identifier(table)} WHERE ${baseQuery}`;
}

/**
 * Common error handling for database operations
 */
export function handleDatabaseError(error: unknown, operation: string): never {
  console.error(`Database error during ${operation}:`, error);

  if (error instanceof TRPCError) {
    throw error;
  }

  // Check for common database errors
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("unique constraint") || message.includes("duplicate")) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A record with this value already exists",
    });
  }

  if (message.includes("foreign key") || message.includes("constraint")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Operation would violate data integrity",
    });
  }

  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `Failed to ${operation}`,
  });
}

/**
 * Create a batch loader for related data
 */
export function createBatchLoader<K, V>(
  loadFn: (keys: K[]) => Promise<Map<K, V>>,
): (keys: K[]) => Promise<V[]> {
  return async (keys: K[]) => {
    const resultMap = await loadFn(keys);
    return keys.map((key) => resultMap.get(key)!);
  };
}

/**
 * Optimize IN queries by chunking large arrays
 */
export function chunkArray<T>(array: T[], chunkSize = 1000): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Build efficient batch IN conditions
 */
export async function batchQuery<T>(
  ids: string[],
  queryFn: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length === 0) {
    return [];
  }

  const chunks = chunkArray(ids);
  const results = await Promise.all(chunks.map(queryFn));
  return results.flat();
}
