# tRPC API Guide for Next.js 15

This document outlines modern tRPC patterns and best practices specifically for Next.js 15 App Router applications. Updated to reflect Cronium's current modernized tRPC configuration with advanced features and optimizations.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Next.js 15 App Router Integration](#nextjs-15-app-router-integration)
3. [Server Components vs Client Components](#server-components-vs-client-components)
4. [Core Configuration](#core-configuration)
5. [Advanced Features](#advanced-features)
6. [Authentication & Authorization](#authentication--authorization)
7. [Performance Optimization](#performance-optimization)
8. [Type Safety & Utilities](#type-safety--utilities)
9. [Testing & Development](#testing--development)
10. [Best Practices Summary](#best-practices-summary)

## Architecture Overview

### Project Structure for Next.js 15

Current Cronium tRPC structure with advanced features:

```
src/
├── app/                  # Next.js App Router pages
├── server/
│   ├── api/
│   │   ├── trpc.ts      # Enhanced tRPC setup with middleware
│   │   ├── root.ts      # Root router with type exports
│   │   └── routers/     # Feature-specific routers
├── trpc/
│   ├── server.ts        # Server-side caller with testing utilities
│   ├── react.tsx        # Enhanced client provider with DevTools
│   ├── shared.ts        # Type utilities and error helpers
│   ├── hydration.tsx    # SSR optimization utilities
│   └── examples.ts      # Usage patterns and best practices
└── shared/
    └── schema.ts        # Database schema and types
```

### Key Benefits of Cronium's tRPC Configuration

- **End-to-End Type Safety**: Complete type inference with utility helpers
- **Advanced Middleware**: Timing, caching, rate limiting, and transactions
- **Performance Optimization**: Smart caching, retry logic, and hydration
- **Developer Experience**: DevTools, structured logging, and testing utilities
- **Production Ready**: Error handling, monitoring, and security features

## Next.js 15 App Router Integration

### Server-Side Caller Setup

Enhanced server-side caller with caching and testing utilities:

```typescript
// src/trpc/server.ts
import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { createCaller } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";

/**
 * Enhanced context creation with optimizations for App Router.
 * Uses React cache for request deduplication and proper session handling.
 */
const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");

  return createTRPCContext({
    headers: heads,
  });
});

/**
 * Server-side tRPC caller optimized for Next.js 15 App Router.
 * Automatically handles context creation and caching for Server Components.
 */
export const api = createCaller(createContext);

/**
 * Testing utilities for server-side calls
 */
export const createTestCaller = async (overrides?: { userId?: string }) => {
  const context = await createTestContext(overrides);
  return createCaller(async () => context);
};
```

### Client Provider Setup

Enhanced client provider with optimized QueryClient and DevTools:

```typescript
// src/trpc/react.tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { loggerLink, httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useState } from "react";
import SuperJSON from "superjson";
import { type AppRouter } from "@/server/api/root";

export const api = createTRPCReact<AppRouter>();

// Enhanced QueryClient with performance optimizations
const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,              // 1 minute
        gcTime: 5 * 60 * 1000,             // 5 minutes
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
        retry: false,                      // No mutation retries
        gcTime: 2 * 60 * 1000,             // 2 minutes
      },
    },
  });

export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        // Enhanced logging for development
        loggerLink({
          enabled: (op) => {
            const isDev = process.env.NODE_ENV === "development";
            return isDev ? true : (op.direction === "down" && op.result instanceof Error);
          },
        }),
        httpBatchLink({
          transformer: SuperJSON,
          url: getBaseUrl() + "/api/trpc",
          headers: () => {
            const headers = new Headers();
            headers.set("x-trpc-source", "nextjs-react");
            return headers;
          },
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {children}
        {/* Development-only DevTools */}
        {process.env.NODE_ENV === "development" && (
          <ReactQueryDevtools
            initialIsOpen={false}
            position="bottom-right"
          />
        )}
      </api.Provider>
    </QueryClientProvider>
  );
}

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 5001}`; // Updated port
}
```

## Server Components vs Client Components

### Server Components Pattern

Use tRPC directly in Server Components for optimal performance:

```typescript
// src/app/[lang]/dashboard/page.tsx
import { api } from "@/trpc/server";

export default async function DashboardPage() {
  // Direct function calls - no HTTP requests, fully cached
  const [events, workflows, stats] = await Promise.all([
    api.events.getAll({ limit: 20 }),
    api.workflows.getAll({ limit: 10 }),
    api.dashboard.getStats(),
  ]);

  return (
    <div>
      <h1>Dashboard</h1>
      <EventsList events={events} />
      <WorkflowsList workflows={workflows} />
      <StatCards stats={stats} />
    </div>
  );
}
```

### Client Components Pattern

Use React Query hooks with pre-configured options:

```typescript
// src/components/dashboard/EventManager.tsx
"use client";
import { api } from "@/trpc/react";
import { QUERY_OPTIONS } from "@/trpc/shared";

export function EventManager({ userId }: { userId: string }) {
  const { data: events, isLoading } = api.events.getByUser.useQuery(
    { userId },
    QUERY_OPTIONS.dynamic // Pre-configured for user-interactive data
  );

  const updateEvent = api.events.update.useMutation({
    onMutate: async (newData) => {
      // Cancel outgoing refetches
      await utils.events.getByUser.cancel({ userId });

      // Snapshot previous value
      const previousEvents = utils.events.getByUser.getData({ userId });

      // Optimistically update
      utils.events.getByUser.setData({ userId }, (old) =>
        old?.map((event) =>
          event.id === newData.id ? { ...event, ...newData } : event
        )
      );

      return { previousEvents };
    },
    onError: (err, newData, context) => {
      // Rollback on error
      utils.events.getByUser.setData({ userId }, context?.previousEvents);
    },
    onSettled: () => {
      // Always refetch after error or success
      utils.events.getByUser.invalidate({ userId });
    },
  });

  if (isLoading) return <EventsSkeleton />;

  return (
    <div>
      <EventList
        events={events}
        onUpdate={(data) => updateEvent.mutate(data)}
      />
    </div>
  );
}
```

### Hybrid Pattern - Server + Client

Combine both approaches for optimal UX:

```typescript
// src/app/[lang]/events/[id]/page.tsx
import { api } from "@/trpc/server";
import { EventClientWrapper } from "./EventClientWrapper";

export default async function EventPage({ params }: { params: { id: string } }) {
  // Server-side initial data
  const initialEvent = await api.events.getById({ id: params.id });

  if (!initialEvent) {
    notFound();
  }

  return (
    <EventClientWrapper
      initialEvent={initialEvent}
      eventId={params.id}
    />
  );
}

// EventClientWrapper.tsx
"use client";
import { api } from "@/trpc/react";

interface Props {
  initialEvent: RouterOutputs["events"]["getById"];
  eventId: string;
}

export function EventClientWrapper({ initialEvent, eventId }: Props) {
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

## Core Configuration

### Enhanced tRPC Setup with Advanced Features

Current Cronium configuration includes database context, advanced error handling, and middleware:

```typescript
// src/server/api/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/server/db";

// Enhanced context with database and session
export const createTRPCContext = async (
  opts: CreateNextContextOptions | { headers: Headers },
) => {
  const headers = "headers" in opts ? opts.headers : new Headers();
  const session = await getServerSession(authOptions);

  return {
    session,
    db, // Database connection available in all procedures
    headers, // Request headers for tracking
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
      // Generic messages in production for security
      message:
        shape.data.code === "INTERNAL_SERVER_ERROR" && !isDev
          ? "An internal error occurred"
          : shape.message,
    };
  },
});

// Base procedures
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);
export const adminProcedure = protectedProcedure.use(enforceUserIsAdmin);
```

## Advanced Features

### Middleware Suite

Cronium includes powerful middleware for common patterns:

#### 1. Performance Timing

```typescript
import { withTiming } from "@/server/api/trpc";

// Automatically logs slow operations (>1000ms)
export const timedProcedure = publicProcedure.use(withTiming);

// Example output:
// 🐌 Slow QUERY events.getAll: 1250ms
// ⏱️ QUERY events.getById: 150ms
```

#### 2. Caching Middleware

```typescript
import { withCache } from "@/server/api/trpc";

// Cache responses for 5 minutes
export const cachedQuery = publicProcedure
  .use(withCache(300000))
  .query(async ({ ctx }) => {
    // Expensive operation - results cached automatically
    return await ctx.db.select().from(expensiveTable);
  });
```

#### 3. Rate Limiting

```typescript
import { withRateLimit } from "@/server/api/trpc";

// Limit to 100 requests per minute per user/IP
export const rateLimitedProcedure = publicProcedure.use(
  withRateLimit(100, 60000),
);
```

#### 4. Database Transactions

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

### Query Configuration Patterns

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
const { data: roles } = api.admin.getRoles.useQuery(
  undefined,
  QUERY_OPTIONS.stable,
);

// Critical data (always fresh)
const { data: systemStatus } = api.system.getStatus.useQuery(
  undefined,
  ADVANCED_PATTERNS.critical,
);
```

## Type Safety & Utilities

### Comprehensive Type Helpers

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

// Context types for middleware development
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
type AuthenticatedContext = TRPCContext & {
  session: NonNullable<TRPCContext["session"]>;
};
```

### Error Handling Utilities

```typescript
import { isTRPCError, getFieldError, getZodErrors } from "@/trpc/shared";

// Type-safe error handling
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

## Testing & Development

### Server-Side Testing

```typescript
import { createTestCaller } from "@/trpc/server";

describe("Events API", () => {
  it("creates event successfully", async () => {
    const caller = await createTestCaller({ userId: "test-user" });
    const event = await caller.events.create({
      name: "Test Event",
      script: "echo 'test'",
      schedule: "0 0 * * *",
    });

    expect(event.id).toBeDefined();
    expect(event.name).toBe("Test Event");
  });

  it("requires authentication for protected routes", async () => {
    const caller = await createTestCaller(); // No user

    await expect(
      caller.events.create({ name: "Test", script: "echo test" }),
    ).rejects.toThrow("UNAUTHORIZED");
  });
});
```

### Client-Side Testing with MSW

```typescript
import { createTRPCMsw } from "msw-trpc";
import type { AppRouter } from "@/server/api/root";

const trpcMsw = createTRPCMsw<AppRouter>();

// Mock handlers
const handlers = [
  trpcMsw.events.getAll.query(() => [
    { id: "1", name: "Test Event", script: "echo test" },
  ]),
  trpcMsw.events.create.mutation(() => ({
    id: "new-id",
    name: "Created Event",
    script: "echo created",
  })),
];

// Use in tests
beforeEach(() => {
  server.use(...handlers);
});
```

### Development Tools

#### React Query DevTools

Automatically enabled in development for query inspection:

- Query states and cache contents
- Performance monitoring
- Network request tracking
- Cache invalidation debugging

#### Enhanced Logging

Structured console output with timing information:

```
⬆️ QUERY events.getAll
  Input: { limit: 20 }
⬇️ QUERY events.getAll - SUCCESS (245ms)
  Result: [20 events]
```

## Authentication & Authorization

### Current Cronium Authentication Setup

```typescript
// src/server/api/trpc.ts
const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      session: ctx.session,
    },
  });
});

const enforceUserIsAdmin = t.middleware(({ ctx, next }) => {
  if (ctx.session.user.role !== UserRole.ADMIN) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});

export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);
export const adminProcedure = protectedProcedure.use(enforceUserIsAdmin);
```

### Usage in Cronium Routers

```typescript
// src/server/api/routers/events.ts
export const eventsRouter = createTRPCRouter({
  // Public - no authentication required
  getPublic: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(events)
        .where(and(eq(events.id, input.id), eq(events.isPublic, true)));
    }),

  // Protected - requires authentication
  getByUser: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(events)
        .where(eq(events.userId, input.userId));
    }),

  // Admin-only - requires admin role
  getAll: adminProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.select().from(events).limit(input.limit);
    }),
});
```

## Performance Optimization

### Query Configuration Strategy

Choose appropriate configurations based on your data characteristics:

```typescript
import { QUERY_OPTIONS, ADVANCED_PATTERNS } from "@/trpc/shared";

function DashboardComponents() {
  // Real-time monitoring data
  const { data: systemMetrics } = api.monitoring.getSystemMetrics.useQuery(
    undefined,
    QUERY_OPTIONS.realtime // Refetches every 30 seconds
  );

  // User settings (changes infrequently)
  const { data: userSettings } = api.settings.getByUser.useQuery(
    { userId },
    QUERY_OPTIONS.static // Cached for 10 minutes
  );

  // Critical system status
  const { data: systemStatus } = api.system.getStatus.useQuery(
    undefined,
    ADVANCED_PATTERNS.critical // Always fresh, high priority
  );

  return (
    <Dashboard
      metrics={systemMetrics}
      settings={userSettings}
      status={systemStatus}
    />
  );
}
```

### Optimistic Updates Pattern

```typescript
function EventForm() {
  const utils = api.useUtils();

  const updateEvent = api.events.update.useMutation({
    onMutate: async (newData) => {
      // Cancel outgoing refetches
      await utils.events.getById.cancel({ id: newData.id });

      // Snapshot the previous value
      const previousEvent = utils.events.getById.getData({ id: newData.id });

      // Optimistically update to the new value
      utils.events.getById.setData({ id: newData.id }, newData);

      // Return a context object with the snapshotted value
      return { previousEvent };
    },
    onError: (err, newData, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      utils.events.getById.setData({ id: newData.id }, context?.previousEvent);
    },
    onSettled: () => {
      // Always refetch after error or success
      utils.events.getById.invalidate({ id: newData.id });
    },
  });
}
```

### Background Prefetching

```typescript
function EventsList({ events }: { events: Event[] }) {
  const utils = api.useUtils();

  // Prefetch event details on hover
  const handleEventHover = (eventId: string) => {
    utils.events.getById.prefetch(
      { id: eventId },
      { staleTime: 5 * 60 * 1000 } // Cache for 5 minutes
    );
  };

  return (
    <div>
      {events.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          onMouseEnter={() => handleEventHover(event.id)}
        />
      ))}
    </div>
  );
}
```

## Best Practices Summary

### 1. Data Classification & Query Optimization

**Choose the right query pattern for your data:**

- **Real-time data** (monitoring, live metrics): `QUERY_OPTIONS.realtime`
- **User interactive data** (events, workflows): `QUERY_OPTIONS.dynamic`
- **Configuration data** (settings, servers): `QUERY_OPTIONS.static`
- **Reference data** (roles, permissions): `QUERY_OPTIONS.stable`
- **Critical data** (system status): `ADVANCED_PATTERNS.critical`

### 2. Performance Best Practices

```typescript
// ✅ Good: Parallel data fetching
const [events, workflows, stats] = await Promise.all([
  api.events.getAll({ limit: 20 }),
  api.workflows.getAll({ limit: 10 }),
  api.dashboard.getStats(),
]);

// ✅ Good: Optimistic updates with rollback
const updateEvent = api.events.update.useMutation({
  onMutate: async (newData) => {
    await utils.events.getById.cancel({ id: newData.id });
    const previous = utils.events.getById.getData({ id: newData.id });
    utils.events.getById.setData({ id: newData.id }, newData);
    return { previous };
  },
  onError: (err, newData, context) => {
    utils.events.getById.setData({ id: newData.id }, context?.previous);
  },
});

// ✅ Good: Background prefetching
const handleHover = (id: string) => {
  utils.events.getById.prefetch({ id }, { staleTime: 5 * 60 * 1000 });
};
```

### 3. Error Handling Strategy

```typescript
// ✅ Good: Type-safe error handling
import { isTRPCError, getFieldError } from "@/trpc/shared";

try {
  await mutation.mutateAsync(data);
} catch (error) {
  if (isTRPCError(error)) {
    switch (error.data?.code) {
      case "UNAUTHORIZED":
        router.push("/login");
        break;
      case "BAD_REQUEST":
        const nameError = getFieldError(error, "name");
        if (nameError) setFieldError("name", nameError);
        break;
    }
  }
}
```

### 4. Middleware Usage Patterns

```typescript
// ✅ Good: Combine middleware for common patterns
export const monitoredProcedure = publicProcedure
  .use(withTiming) // Performance monitoring
  .use(withRateLimit(100)) // Rate limiting
  .use(withCache(60000)); // Caching

// ✅ Good: Transaction middleware for data consistency
export const createComplexData = protectedProcedure
  .use(withTransaction)
  .mutation(async ({ ctx, input }) => {
    // All operations are atomic within the transaction
    const parent = await ctx.db.insert(parents).values(input.parent);
    const children = await ctx.db
      .insert(children)
      .values(
        input.children.map((child) => ({ ...child, parentId: parent.id })),
      );
    return { parent, children };
  });
```

### 5. Testing Recommendations

```typescript
// ✅ Good: Server-side testing
import { createTestCaller } from "@/trpc/server";

test("events creation", async () => {
  const caller = await createTestCaller({ userId: "test-user" });
  const event = await caller.events.create(validInput);
  expect(event.id).toBeDefined();
});

// ✅ Good: Client-side mocking
import { createTRPCMsw } from "msw-trpc";

const handlers = [trpcMsw.events.getAll.query(() => mockEvents)];
```

### 6. Type Safety Guidelines

```typescript
// ✅ Good: Use proper type imports
import type { RouterInputs, RouterOutputs } from "@/trpc/shared";

// ✅ Good: Type component props properly
interface EventFormProps {
  onSubmit: (data: RouterInputs["events"]["create"]) => void;
  initialData?: RouterOutputs["events"]["getById"];
}

// ✅ Good: Use context types for middleware
function customMiddleware() {
  return t.middleware<AuthenticatedContext>(({ ctx, next }) => {
    // ctx.session.user is guaranteed to exist
    return next();
  });
}
```

### 7. Security Considerations

- **Always validate inputs** with Zod schemas
- **Use proper authorization** middleware (protectedProcedure, adminProcedure)
- **Sanitize error messages** in production (handled automatically)
- **Implement rate limiting** for public endpoints
- **Use HTTPS** in production environments

### 8. Development Workflow

1. **Start with Server Components** for initial data loading
2. **Add Client Components** for user interactions
3. **Apply appropriate middleware** based on requirements
4. **Choose optimal query options** for data characteristics
5. **Implement proper error handling** with type safety
6. **Add tests** for both server and client code
7. **Monitor performance** using timing middleware and DevTools

### 9. Migration Strategy

When updating existing tRPC usage:

1. **Update imports** to use new paths (`@/trpc/react`, `@/trpc/server`)
2. **Replace custom query options** with pre-configured patterns
3. **Add middleware** to existing procedures as needed
4. **Update error handling** to use type-safe utilities
5. **Add testing utilities** for new development

### 10. When to Choose Different Patterns

**Server Components:**

- Initial page data loading
- SEO-critical content
- Data that doesn't need real-time updates

**Client Components:**

- User interactions and form submissions
- Real-time data that updates frequently
- Data that requires optimistic updates

**Hybrid Approach:**

- Complex pages with both static and dynamic content
- Progressive enhancement patterns
- Optimal performance with good UX

This comprehensive tRPC setup provides a solid foundation for building scalable, type-safe applications with excellent performance and developer experience. The configuration is production-ready and follows all 2025 best practices for Next.js 15 App Router applications.
