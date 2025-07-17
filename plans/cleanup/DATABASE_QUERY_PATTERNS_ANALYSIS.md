# Database Query Patterns Analysis

## Executive Summary

After analyzing the routers and storage layer, I've identified several common database query patterns, inefficiencies, and opportunities for optimization. The codebase shows good awareness of performance issues (noting removal of caching in favor of fresh data), but there are still several areas where query patterns could be improved.

## 1. Duplicated Query Patterns

### 1.1 Permission Check Pattern

**Issue**: Permission checks are duplicated across multiple routers with similar patterns.

**Examples**:

```typescript
// In events.ts (lines 109-116)
const canView = await storage.canViewEvent(input.id, userId);
if (!canView) {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Event not found",
  });
}

// In servers.ts (lines 132-139)
const canAccess = await storage.canUserAccessServer(input.id, ctx.userId);
if (!canAccess) {
  throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
}

// In workflows.ts (lines 154-159)
if (workflow.userId !== ctx.userId && !workflow.shared) {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Access denied",
  });
}
```

**Recommendation**: Create a unified permission middleware that can be reused across routers:

```typescript
const withPermissionCheck = (resourceType: "event" | "server" | "workflow") => {
  return async ({ ctx, input, next }) => {
    const hasAccess = await checkResourceAccess(
      resourceType,
      input.id,
      ctx.userId,
    );
    if (!hasAccess) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
    }
    return next();
  };
};
```

### 1.2 Pagination Pattern

**Issue**: Pagination logic is repeated in every router with similar filtering and slicing patterns.

**Examples**:

```typescript
// Events router (lines 85-94)
const paginatedEvents = filteredEvents.slice(
  input.offset,
  input.offset + input.limit,
);
return {
  events: paginatedEvents,
  total: filteredEvents.length,
  hasMore: input.offset + input.limit < filteredEvents.length,
};

// Servers router (lines 100-109) - Identical pattern
// Workflows router (lines 120-129) - Identical pattern
// Admin router (lines 130-139) - Identical pattern
```

**Recommendation**: Create a generic pagination utility:

```typescript
function paginateResults<T>(items: T[], offset: number, limit: number) {
  const paginated = items.slice(offset, offset + limit);
  return {
    items: paginated,
    total: items.length,
    hasMore: offset + limit < items.length,
  };
}
```

### 1.3 Search/Filter Pattern

**Issue**: Every router implements its own search filtering with similar lowercase comparison logic.

**Examples**:

```typescript
// Events router (lines 58-65)
if (input.search) {
  const searchLower = input.search.toLowerCase();
  filteredEvents = filteredEvents.filter(
    (event) =>
      (event.name?.toLowerCase().includes(searchLower) ?? false) ||
      (event.description?.toLowerCase().includes(searchLower) ?? false),
  );
}

// Similar patterns in servers.ts, workflows.ts, admin.ts
```

**Recommendation**: Create a generic search utility that can handle multiple fields.

## 2. N+1 Query Problems

### 2.1 Event Permissions in Logs

**Issue**: In `logs.ts`, when fetching logs, each log requires a separate event lookup for permission checking.

**Example** (logs.ts lines 138-152):

```typescript
// Check if user has access to this event
const event = await storage.getEvent(input.eventId);
if (!event) {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Event not found",
  });
}
if (event.userId !== ctx.userId) {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Unauthorized access to event",
  });
}
```

**Recommendation**: Join events table when fetching logs to get permissions in a single query.

### 2.2 Workflow Executions

**Issue**: In `workflows.ts` getExecutions method, it fetches all workflows first, then executions separately.

**Example** (workflows.ts lines 431-451):

```typescript
// Get all workflows for the user first
const userWorkflows = await storage.getAllWorkflows(ctx.userId);

if (userWorkflows.length === 0) {
  return {
    executions: { executions: [], total: 0 },
    hasMore: false,
  };
}

// Use optimized method to get all user workflow executions in a single query
const userExecutions = await storage.getUserWorkflowExecutions(
  ctx.userId,
  input.limit,
  input.offset,
);
```

**Note**: The code mentions using an "optimized method" but still requires fetching workflows first to check if any exist.

### 2.3 Bulk Operations

**Issue**: Bulk operations iterate through items and perform individual queries.

**Example** (servers.ts lines 454-502):

```typescript
for (const serverId of input.serverIds) {
  try {
    // Check if user owns the server
    const server = await storage.getServer(serverId);
    if (!server || server.userId !== ctx.userId) {
      results.push({
        id: serverId,
        success: false,
        error: "Access denied",
      });
      continue;
    }
    // ... perform operation
  }
}
```

**Recommendation**: Fetch all servers in one query, filter in memory, then perform batch operations.

## 3. Inefficient Joins or Data Fetching

### 3.1 EventWithRelations Pattern

**Issue**: The `getEventWithRelations` method in storage.ts performs multiple parallel queries but could be optimized further.

**Example** (storage.ts lines 608-686):

```typescript
// Step 1: Fetch base event with simple relations
const eventPromise = db.query.events.findFirst({
  where: eq(events.id, id),
  with: {
    envVars: true,
    server: true,
    eventServers: {
      with: {
        server: true,
      },
    },
  },
});

// Step 2: Fetch conditional actions in parallel (without deep nesting)
const conditionalActionsPromises = Promise.all([
  // Success events
  db.query.conditionalActions.findMany({
    where: eq(conditionalActions.successEventId, id),
  }),
  // ... more queries
]);
```

**Note**: While this uses parallel queries, it could potentially use a single query with proper joins.

### 3.2 Dashboard Service Optimization

**Good Example**: The dashboard service (dashboard-service.ts) shows proper optimization with parallel queries:

```typescript
const [
  userEvents,
  userWorkflows,
  userServers,
  totalActivityCount,
  recentLogs,
  executionStats,
] = await Promise.all([
  // Multiple optimized queries executed in parallel
]);
```

This is a good pattern that should be replicated elsewhere.

## 4. Common Pagination Patterns

### 4.1 Inconsistent Pagination APIs

**Issue**: Some endpoints use `page/pageSize`, others use `offset/limit`, and some support both.

**Examples**:

- logs.ts supports both patterns (lines 165-167)
- events.ts uses only offset/limit
- workflows.ts converts offset to page internally

**Recommendation**: Standardize on one pagination pattern across all endpoints.

### 4.2 Missing Database-Level Pagination

**Issue**: Many queries fetch all records then paginate in memory, which is inefficient for large datasets.

**Example** (events.ts lines 52-94):

```typescript
// Fetches ALL events
const events = await storage.getAllEvents(userId);

// Then filters in memory
let filteredEvents = events;
// ... filtering logic ...

// Then paginates in memory
const paginatedEvents = filteredEvents.slice(
  input.offset,
  input.offset + input.limit,
);
```

**Recommendation**: Push filtering and pagination to the database level.

## 5. Permission Checking Patterns

### 5.1 Redundant Permission Checks

**Issue**: Permission checks are performed multiple times for the same resource.

**Example**: In events.ts update method:

1. First checks `canEditEvent` (line 251)
2. Then fetches the event again to update it

### 5.2 Missing Batch Permission Checks

**Issue**: No batch permission checking for bulk operations.

**Recommendation**: Implement batch permission checking methods:

```typescript
async canEditEvents(eventIds: number[], userId: string): Promise<Map<number, boolean>>
```

## 6. Specific Recommendations

### 6.1 Create Query Builder Utilities

Implement common query builders for:

- Filtering by user access (owned + shared)
- Pagination with database-level limits
- Search across multiple fields
- Batch permission checks

### 6.2 Implement Query Result Caching

While the code mentions removing caching for freshness, consider implementing:

- Short-lived caches (5-10 seconds) for read-heavy operations
- Cache invalidation on writes
- User-specific cache keys

### 6.3 Database Indexes

Ensure indexes exist for common query patterns:

- `events.userId` + `events.shared` (compound index)
- `logs.userId` + `logs.startTime` (compound index)
- `workflows.userId` + `workflows.status`

### 6.4 Consolidate Storage Methods

Create higher-level storage methods that combine common operations:

```typescript
// Instead of separate permission check + fetch
async getEventIfAccessible(eventId: number, userId: string): Promise<Event | null>

// Batch operations
async getEventsWithPermissions(eventIds: number[], userId: string): Promise<Map<number, Event>>
```

### 6.5 Optimize Conditional Actions Loading

The current implementation loads conditional actions in separate queries. Consider:

- Using a single query with UNION ALL
- Or restructuring the schema to use a single table with a type discriminator

## 7. Performance Impact Estimates

Based on the patterns identified:

1. **N+1 Queries**: Can result in 10-100x more database calls for list operations
2. **In-Memory Pagination**: Loading 1000+ records to return 20 can use 50x more memory
3. **Missing Indexes**: Can turn O(log n) operations into O(n) table scans
4. **Redundant Permission Checks**: Doubles database calls for write operations

## 8. Priority Recommendations

1. **High Priority**:
   - Implement database-level pagination
   - Add batch permission checking
   - Create compound indexes for common queries

2. **Medium Priority**:
   - Consolidate permission checking patterns
   - Create reusable query utilities
   - Optimize bulk operations

3. **Low Priority**:
   - Standardize pagination API
   - Implement short-lived caching
   - Refactor conditional actions schema

## Conclusion

The codebase shows awareness of performance concerns (removing caching, using parallel queries in dashboard service) but still has significant opportunities for optimization. The main issues are:

1. Fetching all data then filtering/paginating in memory
2. N+1 query patterns in permission checks and bulk operations
3. Duplicated query logic across routers
4. Inconsistent pagination patterns

Implementing the recommended changes could reduce database load by 50-80% and improve response times significantly, especially as data grows.
