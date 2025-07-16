# Caching Strategy

## Overview

Cronium uses a selective caching strategy focused on performance optimization for specific use cases while ensuring all CRUD operations return fresh data. This document outlines what is cached, why, and how to work with the caching system.

## What is Cached

### 1. Static Resources (1 hour TTL)

- **Script Templates**: Default templates for Node.js, Python, and Bash scripts
- **Tool Action Templates**: Pre-configured templates for Discord, Slack, Email integrations
- **System Constants**: Supported event types, language configurations, execution limits

**Why**: These resources rarely change and are frequently accessed during event creation.

**Access via**: `api.staticResources.*` endpoints

### 2. Session Data (10 minutes TTL)

- **User Sessions**: Authentication data, user profile, role, and status
- **Permissions**: User role-based permissions (cached with session)

**Why**: Reduces database lookups for every authenticated request while maintaining security through proper invalidation.

**Invalidated on**:

- User logout
- Permission changes
- User profile updates
- User status changes (disabled, etc.)

### 3. Rate Limiting (1 minute TTL)

- **Request Counts**: Per-user or per-IP request tracking
- **API Limits**: Endpoint-specific rate limiting

**Why**: Provides distributed rate limiting across all server instances using Redis/Valkey.

## What is NOT Cached

### CRUD Operations (Always Fresh)

- Events (create, read, update, delete)
- Workflows and their configurations
- Servers and connection details
- Logs and execution history
- User management operations
- Variables and environment settings

### Real-time Data (Always Fresh)

- Dashboard statistics
- System health checks
- Monitoring metrics
- Job status updates
- Active execution logs

## Cache Infrastructure

### Redis/Valkey Backend

- **Connection**: Configured via `VALKEY_URL` or `REDIS_URL` environment variable
- **Failover**: System operates normally if cache is unavailable (fail-open)
- **Monitoring**: Cache statistics available via `cacheService.getStats()`

### Cache Prefixes

```typescript
CACHE_PREFIXES = {
  USER: "user:", // Session and auth data
  RATE_LIMIT: "rate_limit:", // Rate limiting
  STATIC: "static:", // Static resources
};
```

### TTL Values

```typescript
CACHE_TTL = {
  USER: 600, // 10 minutes for sessions
  RATE_LIMIT: 60, // 1 minute for rate limits
  STATIC: 3600, // 1 hour for static resources
};
```

## Implementation Examples

### Caching Static Resources

```typescript
// In static-resources.ts router
return withCache(
  {
    key: `script-template:${input.type}`,
    keyPrefix: "static:",
    ttl: CACHE_TTL.STATIC, // 1 hour
  },
  async () => {
    return getDefaultScriptContent(input.type);
  },
);
```

### Session Caching

```typescript
// Automatic session caching
const session = await SessionCache.getOrFetchSession(userId);

// Manual invalidation on permission change
await SessionCache.invalidateSession(userId);
```

### Rate Limiting

```typescript
// Applied via middleware
export const rateLimitedProcedure = publicProcedure.use(
  withRateLimit(100, 60000),
); // 100 requests per minute
```

## Cache Management

### Manual Cache Operations

```typescript
// Clear specific cache entry
await cacheService.delete("static:script-template:nodejs");

// Clear by pattern
await cacheService.deleteByPattern("user:session:*");

// Get cache statistics
const stats = await cacheService.getStats();
```

### Monitoring Cache Performance

- Check hit/miss rates via `cacheService.getStats()`
- Monitor Redis memory usage
- Track cache-related errors in logs

## Best Practices

1. **Don't Cache CRUD Operations**: All create, read, update, delete operations should return fresh data
2. **Cache Only Static Data**: Templates, configurations, and rarely-changing resources
3. **Invalidate on Changes**: Always invalidate session cache when user data changes
4. **Monitor Performance**: Regular check cache hit rates and adjust TTLs accordingly
5. **Handle Cache Failures**: System should work without cache (fail-open pattern)

## Security Considerations

1. **Session Security**: Sessions are invalidated on:
   - Logout
   - Permission changes
   - Account status changes
2. **Rate Limiting**: Prevents abuse even if cache is unavailable (in-memory fallback)

3. **No Sensitive Data**: Never cache unencrypted sensitive information

## Future Considerations

As the application grows, consider caching:

- Computed analytics (with short TTLs)
- Expensive report generations
- Third-party API responses
- Large static file metadata

Always ensure that caching decisions align with Cronium's real-time monitoring requirements.
