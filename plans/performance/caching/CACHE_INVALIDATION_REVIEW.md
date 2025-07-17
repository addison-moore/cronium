# Cache Invalidation Review - Cronium Codebase

## Executive Summary

After an exhaustive review of all 21 routers in the codebase, I've identified significant gaps in cache invalidation across the system. While there is a well-designed cache infrastructure (`cacheService` and `cacheInvalidation` helpers), it is severely underutilized, with only 2 out of 21 routers implementing any cache invalidation.

## Cache Infrastructure Overview

### Cache Service (`src/lib/cache/cache-service.ts`)

- Uses Redis/Valkey for caching
- Supports TTL-based expiration
- Provides tag-based invalidation
- Has proper error handling and fallback behavior

### Cache Middleware (`src/server/api/middleware/cache.ts`)

- Provides `cacheInvalidation` helpers for common scenarios
- Pre-configured cache queries for common patterns
- Support for entity-based invalidation

### Cache Prefixes and TTLs

```typescript
CACHE_PREFIXES = {
  EVENT: "event:",
  EVENT_LIST: "event_list:",
  USER: "user:",
  SERVER: "server:",
  WORKFLOW: "workflow:",
  LOG: "log:",
  DASHBOARD: "dashboard:",
  WEBHOOK: "webhook:",
};

CACHE_TTL = {
  EVENT: 300, // 5 minutes
  EVENT_LIST: 300, // 5 minutes
  USER: 600, // 10 minutes
  SERVER: 900, // 15 minutes
  WORKFLOW: 300, // 5 minutes
  LOG: 120, // 2 minutes
  DASHBOARD: 60, // 1 minute
  WEBHOOK: 300, // 5 minutes
};
```

## Router Analysis

### ✅ Routers WITH Cache Invalidation

#### 1. **Events Router** (`src/server/api/routers/events.ts`)

- ✅ Uses `cachedQueries.eventList` for getAll
- ✅ Uses `cachedQueries.eventById` for getById
- ✅ Invalidates on create: `cacheInvalidation.invalidateEvent()`
- ✅ Invalidates on update: `cacheInvalidation.invalidateEvent()`
- ✅ Invalidates on delete: `cacheInvalidation.invalidateEvent()`
- ❌ Missing invalidation on: activate, deactivate, execute, resetCounter

#### 2. **Workflows Router** (`src/server/api/routers/workflows.ts`)

- ✅ Uses `cachedQueries.workflowList` for getAll
- ✅ Uses `cachedQueries.workflowById` for getById
- ❌ NO invalidation on: create, update, delete, archive, execute, bulkOperation

### ❌ Routers WITHOUT ANY Cache Invalidation

#### 3. **Servers Router** (`src/server/api/routers/servers.ts`)

- ❌ No caching implemented
- Missing invalidation on: create, update, delete, checkHealth, bulkOperation
- Impact: Server list/details could be cached but aren't

#### 4. **Logs Router** (`src/server/api/routers/logs.ts`)

- ❌ No caching implemented
- Missing invalidation on: create, update, delete
- Impact: Log queries could benefit from caching

#### 5. **Dashboard Router** (`src/server/api/routers/dashboard.ts`)

- ✅ Uses `cachedQueries.dashboardStats` for getStats
- ❌ No invalidation when underlying data changes
- Impact: Dashboard shows stale data for up to 1 minute

#### 6. **Jobs Router** (`src/server/api/routers/jobs.ts`)

- ✅ Uses `withCache` middleware (5-10 second TTL)
- ❌ No invalidation on: cancel
- Impact: Job status changes not immediately reflected

#### 7. **Monitoring Router** (`src/server/api/routers/monitoring.ts`)

- ✅ Uses `withCache` middleware (10 second TTL)
- ❌ No invalidation needed (mostly real-time data)
- ⚠️ Health checks should NOT be cached or have very short TTL

#### 8. **Admin Router** (`src/server/api/routers/admin.ts`)

- ❌ No caching implemented
- Missing invalidation on: inviteUser, updateUser, deleteUser, toggleUserStatus
- Impact: User changes affect permissions but aren't invalidated

#### 9. **Variables Router**

- ❌ No caching implemented
- Missing invalidation on: create, update, delete

#### 10. **Tools Router** (`src/server/api/routers/tools.ts`)

- ❌ No caching implemented
- Missing invalidation on: install, uninstall, configure

#### 11. **Webhooks Router** (`src/server/api/routers/webhooks.ts`)

- ❌ No caching implemented
- Missing invalidation on: create, update, delete, execute

#### 12. **Settings Router**

- ❌ No caching implemented
- Missing invalidation on: update settings

#### 13-21. **Other Routers** (integrations, auth, ai, system, userAuth, webhookSystem, quotaManagement, toolActionLogs, toolActionTemplates)

- ❌ No caching or invalidation implemented

## Critical Missing Invalidations

### 1. **Cross-Entity Dependencies**

- ❌ Deleting a user should invalidate:
  - All events by that user
  - All workflows by that user
  - Dashboard stats
  - User lists
- ❌ Deleting a server should invalidate:
  - Events using that server
  - Server lists
- ❌ Event status changes should invalidate:
  - Dashboard stats
  - Event lists

### 2. **Indirect Cache Dependencies**

- ❌ Log creation should invalidate:
  - Dashboard stats (execution counts)
  - Event stats
- ❌ Workflow execution should invalidate:
  - Dashboard stats
  - Workflow stats

### 3. **Real-time Data Issues**

- ⚠️ Health checks are cached (should be real-time)
- ⚠️ Job status cached for 5 seconds (may be too long for UI)
- ⚠️ Monitoring data cached for 10 seconds

## Recommendations

### Immediate Actions Required

1. **Add Missing Invalidations in Events Router**

```typescript
// In activate/deactivate/execute/resetCounter mutations:
await cacheInvalidation.invalidateEvent(input.id, eventCtx.userId);
```

2. **Add All Missing Invalidations in Workflows Router**

```typescript
// In create/update/delete/archive mutations:
await cacheInvalidation.invalidateWorkflow(workflow.id, ctx.userId);
```

3. **Implement Cross-Entity Invalidation**

```typescript
// In admin router when deleting user:
await cacheInvalidation.invalidateUser(userId);
// This should cascade to invalidate all user's entities
```

4. **Add Dashboard Invalidation on Data Changes**

```typescript
// In logs.create, events.execute, workflows.execute:
await cacheInvalidation.invalidateEntity("DASHBOARD", userId);
```

5. **Remove or Reduce Cache on Real-time Endpoints**

```typescript
// In monitoring.getHealthCheck - remove caching entirely
// In jobs router - reduce cache to 1-2 seconds max
```

### Long-term Improvements

1. **Implement Cascading Invalidation**
   - Create a dependency graph for entities
   - Automatically invalidate dependent caches

2. **Add Cache Warming**
   - Pre-populate caches for frequently accessed data
   - Refresh caches before expiration

3. **Implement Cache Metrics**
   - Track cache hit/miss rates
   - Monitor invalidation frequency
   - Alert on cache anomalies

4. **Add Selective Invalidation**
   - Instead of invalidating entire lists, update specific items
   - Use more granular cache keys

5. **Consider Event-Driven Invalidation**
   - Use pub/sub for cache invalidation events
   - Ensure consistency across multiple app instances

## Code Examples for Implementation

### Example 1: Complete Events Router Invalidation

```typescript
// In events router
activate: async () => {
  // ... activation logic
  await cacheInvalidation.invalidateEvent(input.id, eventCtx.userId);
  await cacheInvalidation.invalidateEntity("DASHBOARD", eventCtx.userId);
};
```

### Example 2: Cross-Entity Invalidation

```typescript
// In cacheInvalidation helpers
async invalidateUser(userId: string): Promise<void> {
  // Invalidate user cache
  await cacheHelpers.invalidateEntity("USER", userId);

  // Invalidate all user's events
  await cacheService.deleteByPattern(`${CACHE_PREFIXES.EVENT_LIST}${userId}*`);

  // Invalidate dashboard
  await cacheHelpers.invalidateEntity("DASHBOARD", userId);

  // Invalidate user's workflows
  await cacheService.deleteByPattern(`${CACHE_PREFIXES.WORKFLOW}*${userId}*`);
}
```

### Example 3: Monitoring Without Cache

```typescript
// In monitoring router
getHealthCheck: adminProcedure // Remove withCache middleware
  .input(healthCheckSchema)
  .query(async ({ input }) => {
    // Real-time health check logic
  });
```

## Conclusion

The caching infrastructure is well-designed but severely underutilized. Only 9.5% of routers (2/21) implement proper cache invalidation. This leads to:

- Stale data being served to users
- Inconsistent state across the application
- Poor user experience when data changes aren't reflected immediately

Implementing the recommended invalidation strategies would significantly improve data consistency and user experience while maintaining the performance benefits of caching.
