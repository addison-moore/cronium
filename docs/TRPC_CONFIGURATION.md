# tRPC Configuration Documentation

## Overview

This document provides comprehensive guidance on Cronium's modernized tRPC configuration, which has been optimized for Next.js 15 App Router with advanced performance features, type safety, and developer experience enhancements.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Configuration Structure](#configuration-structure)
3. [Usage Patterns](#usage-patterns)
4. [Advanced Features](#advanced-features)
5. [Best Practices](#best-practices)
6. [Migration Guide](#migration-guide)
7. [Troubleshooting](#troubleshooting)

## Architecture Overview

Our tRPC configuration follows a modern, three-layer architecture optimized for Next.js 15:

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Layer                             │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐│
│  │ React Components│  │     Hydration Utilities            ││
│  │ - useQuery      │  │ - Server/Client sync                ││
│  │ - useMutation   │  │ - Cache management                  ││
│  │ - DevTools      │  │ - Performance optimization          ││
│  └─────────────────┘  └─────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                 Transport Layer                             │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐│
│  │ HTTP Batch Link │  │     Enhanced Logging                ││
│  │ - Stable API    │  │ - Request/Response timing           ││
│  │ - Error retry   │  │ - Structured output                 ││
│  │ - Optimization  │  │ - Production safety                 ││
│  └─────────────────┘  └─────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                   Server Layer                              │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐│
│  │ Context & Auth  │  │     Advanced Middleware             ││
│  │ - Session mgmt  │  │ - Performance timing                ││
│  │ - Database      │  │ - Caching strategies                ││
│  │ - Type safety   │  │ - Rate limiting                     ││
│  └─────────────────┘  └─────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Configuration Structure

### Core Files

```
src/
├── server/api/
│   ├── trpc.ts              # Core tRPC configuration
│   └── root.ts              # Router composition
├── trpc/
│   ├── server.ts            # Server-side caller
│   ├── react.tsx            # Client provider
│   ├── shared.ts            # Utilities & types
│   ├── hydration.tsx        # SSR optimization
│   └── examples.ts          # Usage patterns
└── shared/
    └── schema.ts            # Database schema
```

### 1. Core tRPC Configuration (`src/server/api/trpc.ts`)

The foundation of our tRPC setup with enhanced context and middleware:

```typescript
// Enhanced context with database and session
export const createTRPCContext = async (
  opts: CreateNextContextOptions | { headers: Headers },
) => {
  const headers = "headers" in opts ? opts.headers : new Headers();
  const session = await getServerSession(authOptions);

  return {
    session,
    db, // Database connection in context
    headers, // Request headers
  };
};

// Production-safe error formatting
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const isDev = process.env.NODE_ENV === "development";

    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
        // Development-only debugging info
        ...(isDev && { stack: error.stack, cause: error.cause }),
      },
      // Generic messages in production
      message:
        shape.data.code === "INTERNAL_SERVER_ERROR" && !isDev
          ? "An internal error occurred"
          : shape.message,
    };
  },
});
```

### 2. Server-Side Caller (`src/trpc/server.ts`)

Optimized for App Router with React cache deduplication:

```typescript
import "server-only";

// Enhanced context creation with caching
const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");

  return createTRPCContext({ headers: heads });
});

// Server-side caller for Server Components
export const api = createCaller(createContext);

// Testing utilities
export const createTestCaller = async (overrides?: { userId?: string }) => {
  const context = await createTestContext(overrides);
  return createCaller(async () => context);
};
```

### 3. Client Provider (`src/trpc/react.tsx`)

Enhanced QueryClient with DevTools and optimized configuration:

```typescript
const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,                    // 1 minute
      gcTime: 5 * 60 * 1000,                   // 5 minutes
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
      retry: (failureCount, error) => {
        // Smart retry logic for tRPC errors
        if (error?.data?.httpStatus >= 400 && error?.data?.httpStatus < 500) {
          return false; // Don't retry client errors
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: false,                            // No mutation retries
      gcTime: 2 * 60 * 1000,                   // 2 minutes
    },
  },
});

export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {children}
        {/* Development-only DevTools */}
        {process.env.NODE_ENV === "development" && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </api.Provider>
    </QueryClientProvider>
  );
}
```

## Usage Patterns

### Server Components (App Router)

Use the server-side caller for initial data loading:

```typescript
// app/dashboard/page.tsx
import { api } from "@/trpc/server";

export default async function DashboardPage() {
  // Direct function calls - no HTTP requests
  const [events, workflows, stats] = await Promise.all([
    api.events.getAll({ limit: 20 }),
    api.workflows.getAll({ limit: 10 }),
    api.dashboard.getStats(),
  ]);

  return (
    <div>
      <EventsList events={events} />
      <WorkflowsList workflows={workflows} />
      <StatCards stats={stats} />
    </div>
  );
}
```

### Client Components

Use React Query hooks for interactive features:

```typescript
"use client";
import { api } from "@/trpc/react";
import { QUERY_OPTIONS } from "@/trpc/shared";

export function EventManager() {
  // Query with optimized options
  const { data: events, isLoading } = api.events.getByUser.useQuery(
    { userId: "current" },
    QUERY_OPTIONS.dynamic // Pre-configured for user data
  );

  // Mutation with optimistic updates
  const updateEvent = api.events.update.useMutation({
    onMutate: async (newData) => {
      await utils.events.getByUser.cancel({ userId: "current" });
      const previousEvents = utils.events.getByUser.getData({ userId: "current" });

      // Optimistic update
      utils.events.getByUser.setData({ userId: "current" }, (old) =>
        old?.map((event) =>
          event.id === newData.id ? { ...event, ...newData } : event
        )
      );

      return { previousEvents };
    },
    onError: (err, newData, context) => {
      // Rollback on error
      utils.events.getByUser.setData({ userId: "current" }, context?.previousEvents);
    },
    onSettled: () => {
      // Refetch to ensure consistency
      utils.events.getByUser.invalidate({ userId: "current" });
    },
  });

  return (
    <div>
      {isLoading ? <Skeleton /> : <EventList events={events} />}
      <EventForm onSubmit={(data) => updateEvent.mutate(data)} />
    </div>
  );
}
```

### Hybrid Approach (Server + Client)

Combine both for optimal performance:

```typescript
// app/events/[id]/page.tsx
import { api } from "@/trpc/server";
import { EventClientWrapper } from "./EventClientWrapper";

export default async function EventPage({ params }: { params: { id: string } }) {
  // Server-side initial data
  const initialEvent = await api.events.getById({ id: params.id });

  return (
    <EventClientWrapper
      initialEvent={initialEvent}
      eventId={params.id}
    />
  );
}

// EventClientWrapper.tsx
"use client";
export function EventClientWrapper({ initialEvent, eventId }) {
  // Client takes over with server data as initial state
  const { data: event } = api.events.getById.useQuery(
    { id: eventId },
    {
      initialData: initialEvent,
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  );

  return <EventDetails event={event} />;
}
```

## Advanced Features

### 1. Middleware Suite

Our configuration includes powerful middleware for common needs:

#### Performance Timing

```typescript
import { withTiming } from "@/server/api/trpc";

export const timedProcedure = publicProcedure.use(withTiming);

// Automatically logs:
// 🐌 Slow QUERY events.getAll: 1250ms (operations >1000ms)
// ⏱️ QUERY events.getAll: 150ms (development, operations >100ms)
```

#### Caching Middleware

```typescript
import { withCache } from "@/server/api/trpc";

// Cache responses for 5 minutes
export const cachedQuery = publicProcedure
  .use(withCache(300000))
  .query(async ({ ctx, input }) => {
    // Expensive operation - results cached automatically
    return await ctx.db.select().from(expensiveTable);
  });
```

#### Rate Limiting

```typescript
import { withRateLimit } from "@/server/api/trpc";

// Limit to 100 requests per minute per user
export const rateLimitedProcedure = publicProcedure.use(
  withRateLimit(100, 60000),
);
```

#### Database Transactions

```typescript
import { withTransaction } from "@/server/api/trpc";

export const createEventWorkflow = protectedProcedure
  .use(withTransaction)
  .mutation(async ({ ctx, input }) => {
    // ctx.db is now a transaction - all operations are atomic
    const event = await ctx.db.insert(events).values(input.event);
    const workflow = await ctx.db.insert(workflows).values({
      ...input.workflow,
      eventId: event.id,
    });

    return { event, workflow };
  });
```

### 2. Query Configuration Patterns

Pre-configured options for different data characteristics:

```typescript
import { QUERY_OPTIONS, ADVANCED_PATTERNS } from "@/trpc/shared";

// Real-time data (monitoring, live metrics)
const { data: metrics } = api.monitoring.getMetrics.useQuery(
  undefined,
  QUERY_OPTIONS.realtime,
);

// User interactive data (events, workflows)
const { data: events } = api.events.getByUser.useQuery(
  { userId },
  QUERY_OPTIONS.dynamic,
);

// Configuration data (settings, servers)
const { data: settings } = api.settings.getAll.useQuery(
  undefined,
  QUERY_OPTIONS.static,
);

// Reference data (rarely changes)
const { data: roles } = api.users.getRoles.useQuery(
  undefined,
  QUERY_OPTIONS.stable,
);

// Infinite queries
const { data, fetchNextPage, hasNextPage } =
  api.events.getInfinite.useInfiniteQuery(
    { limit: 20 },
    ADVANCED_PATTERNS.infinite,
  );

// Critical data (always fresh)
const { data: systemStatus } = api.system.getStatus.useQuery(
  undefined,
  ADVANCED_PATTERNS.critical,
);
```

### 3. Type Utilities

Comprehensive type helpers for better development experience:

```typescript
import type {
  RouterInputs,
  RouterOutputs,
  NestedRouterInputs,
  NestedRouterOutputs,
} from "@/trpc/shared";

// Router-level types
type EventsInput = RouterInputs["events"];
type EventsOutput = RouterOutputs["events"];

// Procedure-level types
type CreateEventInput = NestedRouterInputs<"events", "create">;
type EventOutput = NestedRouterOutputs<"events", "getById">;

// Usage in components
interface EventFormProps {
  onSubmit: (data: CreateEventInput) => void;
  initialData?: EventOutput;
}
```

### 4. Error Handling

Type-safe error handling with utilities:

```typescript
import { isTRPCError, getFieldError, getZodErrors } from "@/trpc/shared";

try {
  await createEvent.mutateAsync(formData);
} catch (error) {
  if (isTRPCError(error)) {
    switch (error.data?.code) {
      case "UNAUTHORIZED":
        router.push("/login");
        break;
      case "FORBIDDEN":
        setError("You don't have permission to create events");
        break;
      case "BAD_REQUEST":
        // Handle validation errors
        const zodErrors = getZodErrors(error);
        if (zodErrors) {
          Object.entries(zodErrors).forEach(([field, messages]) => {
            setFieldError(field, messages[0]);
          });
        }

        // Or get specific field errors
        const nameError = getFieldError(error, "name");
        if (nameError) setFieldError("name", nameError);
        break;
      default:
        setError("An unexpected error occurred");
    }
  } else {
    setError("Network error - please try again");
  }
}
```

### 5. SSR Optimization

Advanced hydration for optimal performance:

```typescript
import { HydrationWrapper, useServerHydration } from "@/trpc/hydration";

// Page-level optimization
export default function OptimizedPage({ initialData, children }) {
  return (
    <HydrationWrapper
      initialData={initialData}
      prefetch={[
        {
          queryKey: ["events", "getAll"],
          queryFn: () => api.events.getAll.query({ limit: 20 }),
          staleTime: 5 * 60 * 1000,
        },
      ]}
    >
      {children}
    </HydrationWrapper>
  );
}

// Component-level hydration
function EventDashboard() {
  const { hydrateQuery, prefetchQuery } = useServerHydration();

  // Hydrate server data
  useEffect(() => {
    hydrateQuery(["events", "recent"], serverData.recentEvents);
  }, []);

  // Prefetch related data
  const handleUserHover = (userId: string) => {
    prefetchQuery(
      ["users", "getById", userId],
      () => api.users.getById.query({ id: userId })
    );
  };
}
```

## Best Practices

### 1. Data Classification

Choose appropriate query options based on data characteristics:

- **Realtime**: Live metrics, monitoring data, chat messages
- **Dynamic**: User events, workflows, interactive data
- **Static**: Settings, configuration, server lists
- **Stable**: User roles, permissions, reference data
- **Background**: Prefetched data, low-priority information

### 2. Error Handling Strategy

```typescript
// Global error boundary
function TRPCErrorBoundary({ error, children }) {
  if (isTRPCError(error)) {
    switch (error.data?.code) {
      case "UNAUTHORIZED":
        return <LoginPrompt />;
      case "FORBIDDEN":
        return <AccessDenied />;
      case "TOO_MANY_REQUESTS":
        return <RateLimitMessage />;
      default:
        return <ErrorFallback error={error} />;
    }
  }

  return children;
}

// Component-level error handling
function useErrorHandler() {
  return useCallback((error: unknown) => {
    if (isTRPCError(error)) {
      // Log to monitoring service
      console.error("tRPC Error:", {
        code: error.data?.code,
        message: error.message,
        path: window.location.pathname,
      });

      // Handle specific cases
      if (error.data?.code === "UNAUTHORIZED") {
        // Redirect to login
      }
    }
  }, []);
}
```

### 3. Performance Optimization

```typescript
// Batch queries for related data
const batchQueries = api.useQueries([
  {
    queryKey: ["events", userId],
    queryFn: () => api.events.getByUser.query({ userId }),
    ...QUERY_OPTIONS.dynamic,
  },
  {
    queryKey: ["workflows", userId],
    queryFn: () => api.workflows.getByUser.query({ userId }),
    ...QUERY_OPTIONS.dynamic,
  },
]);

// Prefetch on interaction
const handleEventHover = (eventId: string) => {
  utils.events.getById.prefetch({ id: eventId });
};

// Background prefetching
useEffect(() => {
  // Prefetch likely next pages
  utils.events.getAll.prefetch({ page: currentPage + 1 }, { staleTime: 30000 });
}, [currentPage]);
```

### 4. Testing Patterns

```typescript
// Server-side testing
import { createTestCaller } from "@/trpc/server";

describe("Events API", () => {
  it("creates event successfully", async () => {
    const caller = await createTestCaller({ userId: "test-user" });
    const event = await caller.events.create({
      name: "Test Event",
      script: "echo 'test'",
    });

    expect(event.id).toBeDefined();
    expect(event.name).toBe("Test Event");
  });
});

// Client-side testing with MSW
import { createTRPCMsw } from "msw-trpc";

const trpcMsw = createTRPCMsw<AppRouter>();

const handlers = [
  trpcMsw.events.getAll.query(() => mockEvents),
  trpcMsw.events.create.mutation(() => mockEvent),
];
```

## Migration Guide

### From Legacy tRPC Setup

1. **Update imports:**

   ```typescript
   // Old
   import { api } from "@/lib/trpc";

   // New - Client components
   import { api } from "@/trpc/react";

   // New - Server components
   import { api } from "@/trpc/server";
   ```

2. **Replace query options:**

   ```typescript
   // Old
   const { data } = api.events.getAll.useQuery(input, {
     staleTime: 60000,
     refetchOnWindowFocus: true,
   });

   // New
   import { QUERY_OPTIONS } from "@/trpc/shared";
   const { data } = api.events.getAll.useQuery(input, QUERY_OPTIONS.dynamic);
   ```

3. **Update error handling:**

   ```typescript
   // Old
   catch (error) {
     if (error.data?.code === "UNAUTHORIZED") {
       // Handle error
     }
   }

   // New
   import { isTRPCError } from "@/trpc/shared";
   catch (error) {
     if (isTRPCError(error) && error.data?.code === "UNAUTHORIZED") {
       // Handle error
     }
   }
   ```

4. **Apply middleware to procedures:**

   ```typescript
   // Add performance monitoring
   export const monitoredProcedure = publicProcedure.use(withTiming);

   // Add caching for expensive operations
   export const cachedProcedure = publicProcedure.use(withCache(300000));

   // Add rate limiting for public endpoints
   export const rateLimitedProcedure = publicProcedure.use(withRateLimit(100));
   ```

### Database Context Migration

Update procedures to use `ctx.db` instead of importing database directly:

```typescript
// Old
import { db } from "@/server/db";

export const getEvents = publicProcedure.query(async () => {
  return db.select().from(events);
});

// New
export const getEvents = publicProcedure.query(async ({ ctx }) => {
  return ctx.db.select().from(events);
});
```

## Troubleshooting

### Common Issues

1. **Type errors with RouterInputs/RouterOutputs**

   ```typescript
   // Issue: Type not found
   type Input = RouterInputs["events"]["create"];

   // Solution: Check import and router structure
   import type { RouterInputs } from "@/trpc/shared";
   // Ensure the router and procedure exist in your root router
   ```

2. **Server/Client hydration mismatches**

   ```typescript
   // Issue: Hydration errors with different data

   // Solution: Use proper initial data handling
   const { data } = api.events.getById.useQuery(
     { id },
     {
       initialData: serverData, // Pass server data
       staleTime: 0, // Refetch immediately if needed
     },
   );
   ```

3. **Cache invalidation not working**

   ```typescript
   // Issue: Data not updating after mutation

   // Solution: Proper invalidation patterns
   const updateEvent = api.events.update.useMutation({
     onSuccess: (data) => {
       // Invalidate specific queries
       utils.events.getById.invalidate({ id: data.id });
       utils.events.getAll.invalidate();

       // Or use pattern invalidation
       utils.events.invalidate(); // Invalidates all events queries
     },
   });
   ```

4. **Middleware not applying correctly**

   ```typescript
   // Issue: Middleware not executing

   // Solution: Check middleware order and syntax
   export const enhancedProcedure = publicProcedure
     .use(withTiming) // Applied first
     .use(withRateLimit(100)) // Applied second
     .use(withCache(60000)); // Applied last
   ```

5. **DevTools not showing**

   ```typescript
   // Issue: React Query DevTools not visible

   // Solution: Check environment and placement
   // DevTools only show in development
   {process.env.NODE_ENV === "development" && (
     <ReactQueryDevtools initialIsOpen={false} />
   )}
   ```

### Performance Issues

1. **Slow queries**
   - Check timing middleware logs for slow operations (>1000ms)
   - Use caching middleware for expensive operations
   - Optimize database queries and indexes

2. **Memory leaks**
   - Use appropriate `gcTime` settings
   - Implement proper cleanup in components
   - Monitor cache size with DevTools

3. **Too many requests**
   - Implement rate limiting middleware
   - Use proper batching for related queries
   - Configure appropriate stale times

### Debug Strategies

1. **Enable enhanced logging:**

   ```typescript
   // The logging middleware provides detailed request information
   // Check console for timing and error information
   ```

2. **Use React Query DevTools:**

   ```typescript
   // Inspect query states, cache contents, and performance
   // Available in development mode automatically
   ```

3. **Server-side debugging:**
   ```typescript
   // Use timing middleware to identify bottlenecks
   // Check database query performance
   // Monitor error rates and types
   ```

## Conclusion

This tRPC configuration provides a robust, scalable foundation for building type-safe APIs with excellent performance and developer experience. The modular design allows you to adopt features incrementally while maintaining backward compatibility.

For questions or issues not covered in this documentation, refer to:

- [tRPC Official Documentation](https://trpc.io/docs)
- [React Query Documentation](https://tanstack.com/query/latest)
- [Next.js App Router Guide](https://nextjs.org/docs/app)

The configuration is designed to grow with your application while maintaining performance and type safety at scale.
