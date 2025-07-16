# Query Optimization Guide

## Overview

This guide explains how to apply and verify the getEventWithRelations query optimization that fixes database timeout issues.

## Steps to Apply Optimization

### 1. Run Database Migration for Indexes

Apply the database indexes using one of these methods:

**Option A: Using standalone script (recommended)**

```bash
# Set DATABASE_URL if not in .env.local
export DATABASE_URL="your-database-url"

# Run the standalone migration
pnpm tsx src/scripts/migrations/add-event-relations-indexes-standalone.ts
```

**Option B: Using shell script**

```bash
# Automatically loads DATABASE_URL from .env.local
./src/scripts/migrations/run-index-migration.sh
```

**Option C: Manual SQL execution**

```bash
# Copy the SQL from drizzle/add-event-indexes.sql
# Execute directly in your database client or via psql:
psql $DATABASE_URL < drizzle/add-event-indexes.sql
```

**Option D: Via Docker (if using docker-compose)**

```bash
# Execute inside the app container
docker exec -it cronium-app-dev bash -c "DATABASE_URL=\$DATABASE_URL pnpm tsx src/scripts/migrations/add-event-relations-indexes-standalone.ts"
```

This creates indexes on:

- `conditional_actions` foreign keys
- `event_servers` foreign keys
- `env_vars.event_id`
- Composite indexes for common query patterns

### 2. Verify the Optimization

Run the benchmark script to compare performance:

```bash
pnpm tsx src/scripts/test-event-query-optimization.ts
```

This will show:

- Simple version timing (baseline)
- Optimized version timing
- Cached version timing (miss and hit)
- Performance improvement percentages
- Index verification

### 3. Monitor in Production

The optimized implementation includes:

1. **Multi-query approach**: Replaces single complex query with parallel queries
2. **Caching layer**: 5-minute cache for complete event objects
3. **Fallback mechanism**: Falls back to simple version on errors

## Architecture

The optimized implementation is now consolidated within `storage.ts`:

```
getEventWithRelations()
    ↓
withCache() middleware (caching layer)
    ↓ (cache miss)
getEventWithRelationsOptimized() (private method - parallel queries)
    ↓ (on error)
getEventWithRelationsSimple() (private method - fallback)
```

## Cache Management

The cache is automatically invalidated when:

- Events are updated
- Conditional actions are modified
- Event servers are changed

Manual cache clearing:

```typescript
await cacheService.invalidateTags([`event:${eventId}`]);
```

## Performance Expectations

- **Query time**: 80-90% reduction
- **Cache hit rate**: 70-80% for active events
- **Database load**: Significantly reduced
- **Timeout errors**: Eliminated

## Troubleshooting

If you still experience timeouts:

1. Check indexes exist:

   ```sql
   SELECT indexname FROM pg_indexes
   WHERE tablename IN ('conditional_actions', 'event_servers', 'env_vars');
   ```

2. Monitor query performance:

   ```bash
   tail -f logs/docker.log | grep "getEventWithRelations"
   ```

3. Check cache status:
   ```bash
   docker exec -it cronium-valkey-dev redis-cli
   > INFO stats
   ```

## Rollback

To rollback to the simple version:

1. Edit `src/server/storage.ts`
2. Change import from `storage-cached` to `storage-simple`
3. Restart the application
