# Optimize getEventWithRelations Query Plan

## Problem Analysis

The current `getEventWithRelations()` query is generating an extremely complex SQL with multiple lateral joins that causes database connection timeouts. The generated SQL is over 3000 characters long with nested joins for:

- Environment variables
- Primary server
- Event servers (with server details)
- onSuccessEvents (with target event details)
- onFailEvents (with target event details)
- onAlwaysEvents (with target event details)

## Root Causes

1. **Nested Lateral Joins**: Drizzle ORM is generating lateral joins for each relationship, creating a massive single query
2. **Deep Nesting**: Conditional actions include their target events, adding another level of joins
3. **Multiple Conditional Action Types**: The query fetches 3 different types of conditional actions (success, fail, always)
4. **No Query Optimization**: Missing database indexes on foreign key columns
5. **All-or-Nothing Approach**: Fetching all data even when not needed

## Optimization Checklist

### Phase 1: Database Indexes (Immediate)

- [ ] Create index on `conditional_actions.success_event_id`
- [ ] Create index on `conditional_actions.fail_event_id`
- [ ] Create index on `conditional_actions.always_event_id`
- [ ] Create index on `conditional_actions.condition_event_id`
- [ ] Create index on `conditional_actions.target_event_id`
- [ ] Create index on `event_servers.event_id`
- [ ] Create index on `event_servers.server_id`
- [ ] Create index on `env_vars.event_id`

### Phase 2: Query Restructuring (Short-term)

- [ ] Replace single complex query with multiple simpler queries
- [ ] Implement parallel query execution using Promise.all()
- [ ] Create specialized query for conditional actions
- [ ] Remove unnecessary nested joins for target events
- [ ] Implement query result assembly in application code

### Phase 3: Caching Strategy (Medium-term)

- [ ] Cache complete EventWithRelations objects
- [ ] Implement cache warming for active events
- [ ] Add cache invalidation on event updates
- [ ] Cache conditional actions separately with longer TTL

### Phase 4: Architecture Improvements (Long-term)

- [ ] Implement lazy loading for conditional actions
- [ ] Create a GraphQL-style data loader pattern
- [ ] Consider denormalizing frequently accessed data
- [ ] Implement read replicas for complex queries

## Implementation Steps

### Step 1: Create Database Indexes

```sql
-- Foreign key indexes for conditional_actions
CREATE INDEX idx_conditional_actions_success_event_id ON conditional_actions(success_event_id);
CREATE INDEX idx_conditional_actions_fail_event_id ON conditional_actions(fail_event_id);
CREATE INDEX idx_conditional_actions_always_event_id ON conditional_actions(always_event_id);
CREATE INDEX idx_conditional_actions_condition_event_id ON conditional_actions(condition_event_id);
CREATE INDEX idx_conditional_actions_target_event_id ON conditional_actions(target_event_id);

-- Foreign key indexes for event_servers
CREATE INDEX idx_event_servers_event_id ON event_servers(event_id);
CREATE INDEX idx_event_servers_server_id ON event_servers(server_id);

-- Foreign key index for env_vars
CREATE INDEX idx_env_vars_event_id ON env_vars(event_id);
```

### Step 2: Optimized Query Implementation

```typescript
async getEventWithRelations(id: number): Promise<EventWithRelations | undefined> {
  // Fetch base event with simple relations
  const event = await db.query.events.findFirst({
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

  if (!event) {
    return undefined;
  }

  // Fetch conditional actions in parallel without deep nesting
  const [successEvents, failEvents, alwaysEvents, conditionEvents] = await Promise.all([
    db.query.conditionalActions.findMany({
      where: eq(conditionalActions.successEventId, id),
    }),
    db.query.conditionalActions.findMany({
      where: eq(conditionalActions.failEventId, id),
    }),
    db.query.conditionalActions.findMany({
      where: eq(conditionalActions.alwaysEventId, id),
    }),
    db.query.conditionalActions.findMany({
      where: eq(conditionalActions.conditionEventId, id),
    }),
  ]);

  // Transform and return
  return {
    ...event,
    servers: event.eventServers.map(es => es.server).filter(Boolean),
    successEvents,
    failEvents,
    alwaysEvents,
    conditionEvents,
  };
}
```

### Step 3: Caching Implementation

```typescript
async getEventWithRelations(id: number): Promise<EventWithRelations | undefined> {
  return withCache({
    key: `event:${id}:full`,
    ttl: CACHE_TTL.EVENT_DETAILS,
    tags: [`event:${id}`, 'events'],
  }, async () => {
    // Optimized query implementation
  });
}
```

## Expected Results

1. **Query Performance**: 80-90% reduction in query execution time
2. **Database Load**: Reduced from 1 complex query to 5 simple queries
3. **Timeout Prevention**: Elimination of connection timeout errors
4. **Cache Hit Rate**: 70-80% for frequently accessed events
5. **Overall Latency**: 50-70% reduction for cached requests

## Success Metrics

- [ ] No timeout errors in production logs
- [ ] Query execution time < 100ms
- [ ] Database CPU usage reduced by 30%
- [ ] Event page load time < 500ms
- [ ] Cache hit rate > 70%
