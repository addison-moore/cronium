# Advanced tRPC Configuration

This directory contains the modernized tRPC configuration for Cronium, optimized for Next.js 15 App Router with advanced performance and developer experience features.

## Files Overview

### Core Configuration

- **`server.ts`** - Server-side caller with optimizations for App Router
- **`react.tsx`** - Client-side provider with enhanced QueryClient and DevTools
- **`shared.ts`** - Type utilities, error helpers, and query configurations

### Advanced Features

- **`hydration.tsx`** - Advanced hydration utilities for SSR optimization
- **`examples.ts`** - Usage patterns and best practices examples

## Key Features

### 🚀 Performance Optimizations

1. **Smart Caching Strategies**

   ```typescript
   import { QUERY_OPTIONS } from "@/trpc/shared";

   // Use pre-configured options for different data types
   const { data } = api.events.getAll.useQuery(input, QUERY_OPTIONS.dynamic);
   ```

2. **Request Deduplication**
   - Server-side context uses React cache for automatic deduplication
   - Client-side QueryClient configured with optimal garbage collection

3. **Advanced Error Handling**
   - Production vs development error formatting
   - Structured error responses with ZodError flattening
   - Type-safe error utilities

### 🛠️ Developer Experience

1. **Type Safety Enhancements**

   ```typescript
   import type { RouterInputs, RouterOutputs } from "@/trpc/shared";

   type CreateEventInput = RouterInputs["events"]["create"];
   type EventOutput = RouterOutputs["events"]["getById"];
   ```

2. **React Query DevTools**
   - Automatically enabled in development
   - Performance monitoring and query inspection

3. **Enhanced Logging**
   - Structured console output with timing information
   - Color-coded request/response tracking
   - Production-safe error logging

### 🔧 Advanced Middleware

1. **Performance Timing**

   ```typescript
   import { withTiming } from "@/server/api/trpc";

   export const timedProcedure = publicProcedure.use(withTiming);
   ```

2. **Caching Middleware** (Removed)

   ```
   // withCache middleware has been removed as part of caching simplification
   // All CRUD operations now return fresh data directly from the database
   ```

3. **Rate Limiting**

   ```typescript
   import { withRateLimit } from "@/server/api/trpc";

   // Limit to 100 requests per minute
   export const rateLimitedProcedure = publicProcedure.use(
     withRateLimit(100, 60000),
   );
   ```

4. **Database Transactions**

   ```typescript
   import { withTransaction } from "@/server/api/trpc";

   export const transactionalMutation = protectedProcedure
     .use(withTransaction)
     .mutation(async ({ ctx, input }) => {
       // ctx.db is now a transaction
     });
   ```

### 📱 App Router Integration

1. **Server Components**

   ```typescript
   // app/dashboard/page.tsx
   import { api } from '@/trpc/server';

   export default async function DashboardPage() {
     const events = await api.events.getAll({ limit: 10 });
     return <EventsList events={events} />;
   }
   ```

2. **Client Components**

   ```typescript
   "use client";
   import { api } from "@/trpc/react";

   export function EventForm() {
     const createEvent = api.events.create.useMutation();
     // ... component logic
   }
   ```

3. **Advanced Hydration**

   ```typescript
   import { HydrationWrapper } from '@/trpc/hydration';

   export function OptimizedPage({ initialData, children }) {
     return (
       <HydrationWrapper initialData={initialData}>
         {children}
       </HydrationWrapper>
     );
   }
   ```

## Query Configuration Patterns

### Data Type Classifications

1. **Real-time Data** (monitoring, live metrics)

   ```typescript
   const { data } = api.monitoring.getMetrics.useQuery(
     input,
     QUERY_OPTIONS.realtime,
   );
   ```

2. **Dynamic Data** (user interactions, events)

   ```typescript
   const { data } = api.events.getByUser.useQuery(
     { userId },
     QUERY_OPTIONS.dynamic,
   );
   ```

3. **Static Data** (configuration, settings)

   ```typescript
   const { data } = api.settings.getAll.useQuery(
     undefined,
     QUERY_OPTIONS.static,
   );
   ```

4. **Stable Data** (reference data, rarely changes)
   ```typescript
   const { data } = api.users.getRoles.useQuery(
     undefined,
     QUERY_OPTIONS.stable,
   );
   ```

### Advanced Patterns

1. **Infinite Queries**

   ```typescript
   const { data, fetchNextPage, hasNextPage } =
     api.events.getInfinite.useInfiniteQuery(
       { limit: 20 },
       ADVANCED_PATTERNS.infinite,
     );
   ```

2. **Optimistic Updates**

   ```typescript
   const updateEvent = api.events.update.useMutation({
     ...ADVANCED_PATTERNS.optimistic,
     onMutate: async (newData) => {
       // Optimistic update logic
     },
   });
   ```

3. **Critical Data**
   ```typescript
   const { data } = api.system.getStatus.useQuery(
     undefined,
     ADVANCED_PATTERNS.critical,
   );
   ```

## Error Handling

### Type-Safe Error Handling

```typescript
import { isTRPCError, getFieldError } from "@/trpc/shared";

try {
  await createEvent.mutateAsync(input);
} catch (error) {
  if (isTRPCError(error)) {
    const nameError = getFieldError(error, "name");
    if (nameError) {
      setFieldError("name", nameError);
    }
  }
}
```

### Global Error Boundaries

```typescript
function GlobalErrorBoundary({ error }) {
  if (isTRPCError(error)) {
    switch (error.data?.code) {
      case 'UNAUTHORIZED':
        return <LoginForm />;
      case 'FORBIDDEN':
        return <AccessDenied />;
      default:
        return <ErrorFallback error={error} />;
    }
  }
  return <UnexpectedError />;
}
```

## Testing Utilities

### Server-Side Testing

```typescript
import { createTestCaller } from "@/trpc/server";

test("events creation", async () => {
  const caller = await createTestCaller({ userId: "test-user" });
  const event = await caller.events.create(testInput);
  expect(event.id).toBeDefined();
});
```

### Client-Side Testing

```typescript
import { createTRPCMsw } from "msw-trpc";
import { AppRouter } from "@/server/api/root";

const trpcMsw = createTRPCMsw<AppRouter>();

// Mock tRPC calls in tests
const handlers = [trpcMsw.events.getAll.query(() => mockEvents)];
```

## Performance Monitoring

### Cache Management

```typescript
import { useCacheManagement } from "@/trpc/hydration";

function AdminDashboard() {
  const { getCacheStats, invalidatePattern } = useCacheManagement();

  const stats = getCacheStats();
  console.log(`Total queries: ${stats.total}, Stale: ${stats.stale}`);

  // Invalidate all event-related queries
  const handleRefresh = () => {
    invalidatePattern("events");
  };
}
```

### Request Timing

The `withTiming` middleware automatically logs:

- Operations taking >1000ms (slow queries)
- All operations >100ms in development
- Failed operations with timing info

## Migration from Legacy Setup

1. **Update imports:**

   ```typescript
   // Old
   import { api } from "@/lib/trpc";

   // New
   import { api } from "@/trpc/react"; // Client
   import { api } from "@/trpc/server"; // Server
   ```

2. **Use new query options:**

   ```typescript
   // Old
   const { data } = api.events.getAll.useQuery(input, {
     staleTime: 60000,
   });

   // New
   const { data } = api.events.getAll.useQuery(input, QUERY_OPTIONS.dynamic);
   ```

3. **Apply middleware to procedures:**
   ```typescript
   // Add timing to expensive operations
   export const expensiveQuery = publicProcedure
     .use(withTiming)
     .query(async ({ ctx, input }) => {
       // Expensive operation
     });
   ```

## Best Practices

1. **Choose appropriate query options** based on data characteristics
2. **Use middleware combinations** for common patterns
3. **Implement proper error boundaries** with type-safe error handling
4. **Monitor performance** using timing middleware and DevTools
5. **Test with realistic data** using the testing utilities
6. **Cache management** for optimal memory usage
7. **Rate limiting** for public endpoints to prevent abuse

This configuration provides a solid foundation for building scalable, performant tRPC applications with excellent developer experience.
