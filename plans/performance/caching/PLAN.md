# Caching Strategy Simplification Plan

## Overview

This plan outlines the simplification of Cronium's caching strategy. Given that Cronium is primarily a CRUD-heavy application with real-time monitoring requirements, the current broad caching approach creates more problems than it solves. This plan focuses on removing unnecessary caching while keeping it only where it provides clear value.

## Goals

1. **Simplify the codebase** by removing complex cache invalidation logic
2. **Ensure data freshness** for better user experience
3. **Maintain caching only where beneficial** (static resources, session data, rate limiting)
4. **Reduce bugs** related to cache inconsistency

## Current State Analysis

### Problems with Current Implementation

- Only 2 out of 21 routers implement cache invalidation
- 95% of mutations don't invalidate cache
- Complex invalidation logic is error-prone
- Users see stale data after CRUD operations
- Real-time monitoring data can be cached incorrectly

### What Should Be Kept

- Redis/Valkey infrastructure for rate limiting
- Session caching for authentication
- Static resource caching (templates, configurations)
- Cache service for future selective use

## Phase 1: Remove Caching from CRUD Operations

### Checklist: Events Router

- [x] Remove caching from `getAll` query
- [x] Remove caching from `getById` query
- [x] Remove all cache invalidation calls from mutations
- [x] Remove cached query wrappers
- [x] Ensure direct storage calls for all operations

### Checklist: Workflows Router

- [x] Remove caching from `list` query
- [x] Remove caching from `getById` query
- [x] Remove caching from `getByIdWithDetails` query (Note: this method was named `getAll` in the code)
- [x] Remove all cache invalidation logic (Note: no invalidation was implemented in this router)
- [x] Update to use direct storage calls

### Checklist: Other Routers

- [x] Audit all remaining routers for cached queries
- [x] Remove any found caching implementations
- [x] Ensure all data fetching is direct from storage

## Phase 2: Remove Caching from Real-time Data

### Checklist: Monitoring & Stats

- [x] Remove caching from dashboard stats endpoints
- [x] Remove caching from health check endpoints
- [x] Remove caching from system metrics
- [x] Ensure all monitoring data is fetched fresh

### Checklist: Logs & Execution Data

- [x] Remove any log caching implementations (none found)
- [x] Remove execution history caching (none found)
- [x] Remove job status caching
- [x] Ensure real-time data accuracy

## Phase 3: Clean Up Cache Infrastructure

### Checklist: Cache Middleware

- [x] Remove `withCache` wrapper from tRPC procedures
- [x] Remove `cachedQueries` object
- [x] Remove `cacheInvalidation` helpers for removed entities
- [x] Keep only essential cache utilities

### Checklist: Storage Layer

- [x] Remove cache wrapping from `getEventWithRelations`
- [x] Remove all cache-related imports from storage.ts
- [x] Ensure all storage methods return fresh data
- [x] Remove any cache-aside pattern implementations

## Phase 4: Implement Selective Caching

### Checklist: Static Resources

- [x] Identify truly static data (script templates, tool configs)
- [x] Implement simple caching for template fetching
- [x] Set appropriate long TTLs (30-60 minutes)
- [x] Document which resources are cached

### Checklist: Session Management

- [x] Keep session caching for authentication
- [x] Implement proper session invalidation on logout
- [x] Ensure permission changes invalidate session cache
- [x] Set reasonable TTLs (5-15 minutes)

### Checklist: Rate Limiting

- [x] Maintain Redis/Valkey for rate limiting
- [x] Keep rate limit tracking implementation
- [x] Ensure rate limit data doesn't interfere with removed caches
- [x] Document rate limiting strategy

## Phase 5: Update Cache Service

### Checklist: Simplify Cache Service

- [x] Remove unused cache prefixes
- [x] Remove entity-specific cache helpers (kept only invalidateUserCache for session data)
- [x] Keep only generic get/set/delete operations
- [x] Update cache statistics to reflect new usage

### Checklist: Update Configuration

- [x] Remove unused cache TTL constants
- [ ] Update environment variable documentation
- [x] Ensure cache service gracefully handles unavailability
- [ ] Update any cache-related configuration

## Phase 6: Code Cleanup

### Checklist: Remove Unused Code

- [x] Delete unused cache invalidation functions
- [x] Remove cache-related imports from routers
- [x] Clean up any cache-related types/interfaces
- [x] Remove cache complexity from middleware

### Checklist: Update Documentation

- [x] Update CACHE_INVALIDATION_ANALYSIS.md to reflect new strategy
- [x] Document where caching is still used
- [x] Update environment variable documentation
- [x] Add comments explaining why caching was removed

## Implementation Order

1. **Start with Events Router** (most complex, good test case)
2. **Move to Workflows Router** (second most used)
3. **Clean remaining routers** (systematic removal)
4. **Update storage layer** (remove cache wrapping)
5. **Implement selective caching** (add back only where needed)
6. **Final cleanup** (remove dead code, update docs)

## Success Criteria

- [ ] All CRUD operations return fresh data
- [ ] Real-time logs and stats are always current
- [ ] No cache invalidation bugs
- [ ] Simplified codebase with less complexity
- [ ] Clear documentation on where caching is used
- [ ] Better user experience with consistent data

## Risks and Mitigation

### Performance Concerns

- **Risk**: Increased database load
- **Mitigation**: Already implemented query optimization and indexes

### Redis/Valkey Dependency

- **Risk**: Removing too much might break rate limiting
- **Mitigation**: Carefully preserve rate limiting functionality

### Migration Issues

- **Risk**: Breaking existing functionality during removal
- **Mitigation**: Systematic approach, one router at a time

## Post-Implementation

After completing this plan:

1. Monitor application performance
2. Gather user feedback on responsiveness
3. Consider selective re-introduction only if proven necessary
4. Write comprehensive tests for remaining cache usage
5. Document lessons learned

## Notes

- This plan focuses on simplification, not adding features
- Testing will be addressed in a separate plan
- Each phase should be completed before moving to the next
- Regular commits after each major section
- Update changelog after each phase completion
