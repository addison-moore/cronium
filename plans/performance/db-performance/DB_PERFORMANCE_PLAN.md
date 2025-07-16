# Database Performance Improvement Plan

## Overview

This plan addresses all database-related performance issues identified in the Brainstorm document, with a focus on eliminating N+1 queries, implementing efficient caching with Valkey, and optimizing database schema with proper indexes. The plan is organized into phases that can be executed sequentially to minimize risk and maximize impact.

## Goals

1. Eliminate N+1 query patterns throughout the application
2. Implement comprehensive Valkey caching with proper invalidation
3. Add strategic database indexes for common query patterns
4. Optimize database connection pooling and query performance
5. Implement query performance monitoring and alerting

## Phase 1: N+1 Query Elimination (Critical Priority)

### Objective

Replace all N+1 query patterns with efficient single queries using Drizzle ORM's relational queries or SQL joins.

### Implementation Checklist

#### 1.1 Audit and Document N+1 Queries

- [x] Search for all instances of `getEventWithRelations()` function
- [x] Identify all functions that make multiple sequential queries for related data
- [x] Document all N+1 patterns found in storage.ts and other files
- [x] Create a list of affected API endpoints and pages
- [x] Estimate performance impact of each N+1 pattern

#### 1.2 Rewrite Core Query Functions

- [x] Rewrite `getEventWithRelations()` to use Drizzle's `with` clause (CRITICAL - 8-10 queries per event)
- [x] Update `getAllEvents()` to avoid calling getEventWithRelations in loop (CRITICAL - multiplies N+1 problem)
- [x] Fix `getWorkflowWithRelations()` to include all nodes/connections in single query (HIGH - 4+N queries)
- [x] Optimize workflow execution aggregation in workflows router (MEDIUM - N+1 for stats)
- [x] Update `getEventsByServerId()` to include relations in single query
- [x] Fix `deleteUser()` to use batch operations instead of loops (LOW - admin only)
- [x] Update `getLogsForEvent()` to use proper joins (already optimized - no N+1 issues found)
- [x] Rewrite user dashboard queries to fetch all data efficiently (completed in Phase 1.3)
- [x] Update webhook-related queries to include all relations

#### 1.3 Update API Endpoints

- [x] Update critical endpoints first:
  - [x] Dashboard stats (`dashboard.getStats`) - First page users see
  - [x] Events list (`events.getAll`) - Primary navigation page
  - [x] Scheduler initialization - Affects server startup
  - [x] Event execution (`events.execute`) - Called frequently
- [x] Update high-impact endpoints:
  - [x] Bulk downloads (`events.download`, `workflows.download`) - Risk of timeouts
  - [x] Single event/workflow views (`events.getById`, `workflows.getById`)
- [x] Update all remaining tRPC procedures that use old query functions
- [x] Ensure no new N+1 patterns are introduced
- [ ] Add query logging in development to catch future N+1 issues
- [x] Update TypeScript types to match new query return structures

#### 1.4 Testing and Verification (skipping for now)

- [ ] Create unit tests for all rewritten query functions
- [ ] Add performance benchmarks to compare before/after
- [ ] Test all affected pages for correct data display
- [ ] Verify no data is missing after query optimization
- [ ] Check for any breaking changes in API responses

### Human Intervention Required

- [ ] None expected for this phase

## Phase 2: Valkey Cache Implementation

### Objective

Implement comprehensive caching using Valkey (already running in Docker) to reduce database load and improve response times.

### Implementation Checklist

#### 2.1 Valkey Client Setup

- [x] Install Redis/Valkey client package (`ioredis` recommended)
- [x] Create cache service module with proper error handling
- [x] Set up connection pooling and retry logic
- [x] Configure cache key prefixes and namespacing
- [x] Implement cache serialization/deserialization helpers

#### 2.2 Cache Strategy Design

- [x] Define cache TTL policies for different data types:
  - [x] Events: 5 minutes
  - [x] User data: 10 minutes
  - [x] Server configurations: 15 minutes
  - [x] Logs: 2 minutes (frequently updated)
  - [x] Workflows: 5 minutes
- [x] Design cache key patterns for consistency
- [x] Document cache invalidation triggers
- [ ] Plan for cache warming strategies

#### 2.3 Implement Caching Layer

- [x] Create cache wrapper functions for tRPC procedures (middleware limitations)
- [x] Add caching to frequently accessed queries:
  - [x] User dashboard data
  - [x] Event lists and details
  - [ ] Server configurations
  - [x] Workflow definitions
  - [ ] Recent logs
- [x] Implement cache-aside pattern for all cacheable data
- [x] Add cache hit/miss metrics logging

#### 2.4 Cache Invalidation

- [x] Implement cache invalidation on data mutations:
  - [x] Event create/update/delete
  - [ ] Workflow modifications
  - [ ] Server configuration changes
  - [ ] User permission updates
- [x] Create helper functions for targeted cache clearing
- [x] Implement cache tags for group invalidation
- [ ] Add cache versioning for backward compatibility

#### 2.5 Session and Real-time Data

- [ ] Move session storage to Valkey
- [ ] Implement WebSocket connection state in Valkey
- [ ] Cache real-time metrics and counters
- [ ] Set up pub/sub for cache invalidation across instances

### Human Intervention Required

- [x] Verify VALKEY_URL environment variable is correctly set (added to env.mjs)

## Phase 3: Database Index Optimization

### Objective

Add strategic indexes to improve query performance for common access patterns.

### Implementation Checklist

#### 3.1 Index Analysis

- [ ] Analyze slow query logs (if available)
- [ ] Review all WHERE clauses in the application
- [ ] Identify columns used in JOIN operations
- [ ] Find columns used in ORDER BY clauses
- [ ] Document current indexes from schema

#### 3.2 Create Core Indexes

- [ ] Add indexes for foreign key relationships:
  - [ ] `CREATE INDEX idx_events_user_id ON events(user_id);`
  - [ ] `CREATE INDEX idx_events_server_id ON events(server_id);`
  - [ ] `CREATE INDEX idx_logs_event_id ON logs(event_id);`
  - [ ] `CREATE INDEX idx_logs_job_id ON logs(job_id);`
  - [ ] `CREATE INDEX idx_workflows_user_id ON workflows(user_id);`
  - [ ] `CREATE INDEX idx_workflow_events_workflow_id ON workflow_events(workflow_id);`
  - [ ] `CREATE INDEX idx_workflow_events_event_id ON workflow_events(event_id);`
  - [ ] `CREATE INDEX idx_event_servers_event_id ON event_servers(event_id);`
  - [ ] `CREATE INDEX idx_event_servers_server_id ON event_servers(server_id);`
  - [ ] `CREATE INDEX idx_workflow_nodes_workflow_id ON workflow_nodes(workflow_id);`
  - [ ] `CREATE INDEX idx_workflow_connections_workflow_id ON workflow_connections(workflow_id);`

#### 3.3 Create Performance Indexes

- [ ] Add composite indexes for common queries:
  - [ ] `CREATE INDEX idx_events_user_active ON events(user_id, is_active);`
  - [ ] `CREATE INDEX idx_logs_created_desc ON logs(created_at DESC);`
  - [ ] `CREATE INDEX idx_events_next_run ON events(next_run_at) WHERE is_active = true;`
  - [ ] `CREATE INDEX idx_jobs_status_created ON jobs(status, created_at);`

#### 3.4 Create Search Indexes

- [ ] Add indexes for text search:
  - [ ] `CREATE INDEX idx_events_name_gin ON events USING gin(to_tsvector('english', name));`
  - [ ] `CREATE INDEX idx_logs_output_gin ON logs USING gin(to_tsvector('english', output));`

#### 3.5 Index Maintenance

- [ ] Create migration scripts for all new indexes
- [ ] Document index purpose and usage
- [ ] Set up index usage monitoring
- [ ] Plan for periodic index maintenance

### Human Intervention Required

- [ ] Review and approve index creation SQL before execution
- [ ] Monitor database performance during index creation
- [ ] Schedule index creation during low-traffic period if needed

## Phase 4: Query Optimization and Connection Pooling

### Objective

Optimize database queries and connection management for better resource utilization.

### Implementation Checklist

#### 4.1 Connection Pool Optimization

- [ ] Configure Drizzle/PostgreSQL connection pooling:
  - [ ] Set optimal pool size based on expected load
  - [ ] Configure connection timeout values
  - [ ] Set up connection retry logic
  - [ ] Implement connection health checks
- [ ] Add connection pool monitoring
- [ ] Implement graceful shutdown for connections

#### 4.2 Query Optimization

- [ ] Review and optimize complex queries:
  - [ ] Use EXPLAIN ANALYZE for slow queries
  - [ ] Optimize JOIN orders
  - [ ] Add query hints where beneficial
  - [ ] Limit result sets appropriately
- [ ] Implement query result pagination
- [ ] Add query timeout configurations
- [ ] Use prepared statements for repeated queries

#### 4.3 Batch Operations

- [ ] Implement batch insert for bulk operations
- [ ] Create batch update functions
- [ ] Use PostgreSQL COPY for large data imports
- [ ] Implement transaction batching for related operations

#### 4.4 Database-Specific Optimizations

- [ ] Enable PostgreSQL query planning optimizations
- [ ] Configure appropriate work_mem settings
- [ ] Set up connection statement timeout
- [ ] Enable pg_stat_statements extension for monitoring

### Human Intervention Required

- [ ] None expected for this phase

## Phase 5: Monitoring and Performance Tracking

### Objective

Implement comprehensive monitoring to track database performance improvements and catch regressions.

### Implementation Checklist

#### 5.1 Query Performance Monitoring

- [ ] Add query execution time logging
- [ ] Implement slow query alerts (> 100ms)
- [ ] Track query frequency and patterns
- [ ] Monitor N+1 query detection in development
- [ ] Set up query performance dashboards

#### 5.2 Cache Performance Monitoring

- [ ] Track cache hit/miss ratios
- [ ] Monitor cache memory usage
- [ ] Log cache operation latencies
- [ ] Alert on cache connection failures
- [ ] Track cache invalidation patterns

#### 5.3 Database Health Monitoring

- [ ] Monitor connection pool usage
- [ ] Track database CPU and memory usage
- [ ] Monitor table sizes and growth
- [ ] Track index usage statistics
- [ ] Alert on connection exhaustion

#### 5.4 Application Performance Metrics

- [ ] Track API endpoint response times
- [ ] Monitor page load times
- [ ] Measure time-to-interactive metrics
- [ ] Track database query contribution to response time
- [ ] Set up performance regression alerts

### Human Intervention Required

- [ ] Configure monitoring dashboard access
- [ ] Set up alert notification channels

## Success Metrics

### Performance Targets

- Reduce average API response time by 70% (95%+ for dashboard/lists)
- Achieve 80%+ cache hit ratio for common queries
- Eliminate all N+1 query patterns
- Reduce database CPU usage by 60-80% (currently mostly from redundant queries)
- Improve page load times:
  - Dashboard: 2-5s → 50-100ms (95% improvement)
  - Event List: 5-10s → 50-150ms (98% improvement)
  - Single Event: 0.5-1s → 20-50ms (90% improvement)
- Reduce database queries per minute (QPM) by 95%+

### Monitoring KPIs

- Average query execution time: < 50ms
- P95 API response time: < 200ms
- Cache hit ratio: > 80%
- Database connection pool utilization: < 70% (prevent exhaustion)
- Zero N+1 queries in production
- Dashboard load time: < 100ms
- Event list load time: < 150ms
- Server startup time: < 5 seconds (from 30-60s)

## Rollback Strategy

Each phase includes rollback capabilities:

1. **N+1 Query Fix**: Keep old functions temporarily with deprecated markers
2. **Cache Implementation**: Feature flag to disable caching
3. **Index Creation**: Migration scripts include DROP INDEX statements
4. **Connection Pooling**: Configuration can be reverted via environment variables
5. **Monitoring**: Can be disabled without affecting core functionality

## Timeline Estimate

- **Phase 1**: 2-3 days (Critical - Start immediately)
- **Phase 2**: 3-4 days (High priority)
- **Phase 3**: 1 day (Medium priority)
- **Phase 4**: 2 days (Medium priority)
- **Phase 5**: 2 days (Ongoing)

**Total**: 10-12 days for complete implementation

## Additional Recommendations from N+1 Audit

Based on the detailed audit findings, the following additional optimizations are recommended:

### Immediate Actions

1. **Focus on Dashboard First**: The dashboard stats endpoint is the first thing users see and currently makes 200+ queries
2. **Implement Query Logging**: Add development-only query logging to catch new N+1 patterns early
3. **Create Performance Benchmarks**: Measure current query counts and response times before optimization

### Query Pattern Improvements

1. **Event Relations Pattern**: Create a standardized function for fetching events with all relations
2. **Batch Loading**: For cases where joins aren't practical, implement batch loading (e.g., load all servers for multiple events in one query)
3. **Selective Loading**: Add options to load only needed relations (e.g., `getEvent(id, { include: ['servers', 'variables'] })`)

### Scheduler Optimization

1. **Lazy Loading**: Don't load all event relations during scheduler initialization
2. **Caching**: Cache active events in memory/Valkey to avoid repeated database queries
3. **Batch Operations**: Process multiple events in single database transactions

### Database Connection Management

1. **Connection Pool Sizing**: With current N+1 patterns causing connection exhaustion, increase pool size temporarily
2. **Query Timeouts**: Set aggressive timeouts to catch slow N+1 patterns in production
3. **Connection Monitoring**: Alert on high connection usage as an indicator of N+1 problems

## Next Steps

1. Begin with Phase 1 immediately - N+1 query elimination will provide the most immediate impact
2. Prioritize `getEventWithRelations()` and dashboard stats as they have the highest user impact
3. Set up development environment query logging to identify all N+1 patterns
4. Create performance benchmarks before starting to measure improvements
5. Implement changes incrementally with thorough testing between phases
6. Consider a feature flag to quickly rollback if issues arise
