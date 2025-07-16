# tRPC Best Practices for Cronium

This document provides comprehensive guidance on using tRPC in the Cronium project, specifically optimized for Next.js 15 App Router. It consolidates best practices, patterns, and implementation details for developers contributing to the project.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Server Components vs Client Components](#server-components-vs-client-components)
4. [Core Concepts](#core-concepts)
5. [Advanced Features](#advanced-features)
6. [Authentication & Authorization](#authentication--authorization)
7. [Type Safety](#type-safety)
8. [Testing](#testing)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

## Quick Start

### Basic Usage Examples

**Server Component (Recommended for initial data):**

```typescript
// app/dashboard/page.tsx
import { api } from "@/trpc/server";

export default async function DashboardPage() {
  const events = await api.events.getAll({ limit: 20 });
  return <EventsList events={events} />;
}
```

**Client Component (For interactivity):**

```typescript
// components/EventManager.tsx
"use client";
import { api } from "@/trpc/react";

export function EventManager() {
  const { data, isLoading } = api.events.getByUser.useQuery({ userId: "current" });
  const updateEvent = api.events.update.useMutation();

  if (isLoading) return <Skeleton />;
  return <EventList events={data} onUpdate={updateEvent.mutate} />;
}
```

## Architecture Overview

### Project Structure

```
src/
├── server/
│   ├── api/
│   │   ├── trpc.ts          # Core tRPC configuration
│   │   ├── root.ts          # Router composition
│   │   └── routers/         # Feature-specific routers
├── trpc/
│   ├── server.ts            # Server-side caller
│   ├── react.tsx            # Client provider
│   ├── shared.ts            # Type utilities
│   └── hydration.tsx        # SSR optimization
└── shared/
    └── schema.ts            # Database schema
```

### Key Features

- **End-to-End Type Safety**: Complete type inference from database to UI
- **Optimized for Next.js 15**: Server Components, App Router, and React Server Components
- **Advanced Middleware**: Performance monitoring, caching, rate limiting, transactions
- **Developer Experience**: React Query DevTools, structured logging, testing utilities

## Server Components vs Client Components

### When to Use Each

**Server Components** - Use for:

- Initial page data loading
- SEO-critical content
- Static or infrequently changing data
- Direct database queries without HTTP overhead

**Client Components** - Use for:

- User interactions and real-time updates
- Form submissions with optimistic updates
- Data that requires client-side state management
- Features requiring WebSocket connections

### Hybrid Pattern

Combine both for optimal performance:

```typescript
// app/events/[id]/page.tsx - Server Component
import { api } from "@/trpc/server";
import { EventClientWrapper } from "./EventClientWrapper";

export default async function EventPage({ params }: { params: { id: string } }) {
  const initialEvent = await api.events.getById({ id: params.id });

  return (
    <EventClientWrapper
      initialEvent={initialEvent}
      eventId={params.id}
    />
  );
}

// EventClientWrapper.tsx - Client Component
"use client";
export function EventClientWrapper({ initialEvent, eventId }) {
  const { data: event } = api.events.getById.useQuery(
    { id: eventId },
    { initialData: initialEvent, staleTime: 5 * 60 * 1000 }
  );

  return <EventDetails event={event} />;
}
```

## Core Concepts

### Context & Database Access

All procedures have access to the database through context:

```typescript
export const createTRPCContext = async (
  opts: CreateNextContextOptions | { headers: Headers },
) => {
  const session = await getServerSession(authOptions);

  return {
    session,
    db, // Database connection available in all procedures
    headers, // Request headers for tracking
  };
};
```

### Base Procedures

```typescript
// Public access - no authentication required
export const publicProcedure = t.procedure;

// Authenticated users only
export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);

// Admin users only
export const adminProcedure = protectedProcedure.use(enforceUserIsAdmin);
```

### Error Handling

Production-safe error formatting with development debugging:

```typescript
errorFormatter({ shape, error }) {
  const isDev = process.env.NODE_ENV === "development";

  return {
    ...shape,
    data: {
      ...shape.data,
      zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      ...(isDev && { stack: error.stack, cause: error.cause }),
    },
    message:
      shape.data.code === "INTERNAL_SERVER_ERROR" && !isDev
        ? "An internal error occurred"
        : shape.message,
  };
}
```

## Advanced Features

### Middleware Suite

#### Performance Timing

```typescript
import { withTiming } from "@/server/api/trpc";

// Automatically logs slow operations
export const timedProcedure = publicProcedure.use(withTiming);
// Output: 🐌 Slow QUERY events.getAll: 1250ms
```

#### Caching

```typescript
import { withCache } from "@/server/api/trpc";

// Cache responses for 5 minutes
export const cachedQuery = publicProcedure
  .use(withCache(300000))
  .query(async ({ ctx }) => {
    return await ctx.db.select().from(expensiveTable);
  });
```

#### Rate Limiting

```typescript
import { withRateLimit } from "@/server/api/trpc";

// 100 requests per minute per user/IP
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
    // All operations are atomic
    const event = await ctx.db.insert(events).values(input.event);
    const workflow = await ctx.db.insert(workflows).values({
      ...input.workflow,
      eventId: event.id,
    });
    return { event, workflow };
  });
```

### Query Configuration Patterns

Pre-configured options for different data types:

```typescript
import { QUERY_OPTIONS } from "@/trpc/shared";

// Real-time data (monitoring, metrics) - refetches every 30s
api.monitoring.getMetrics.useQuery(undefined, QUERY_OPTIONS.realtime);

// User interactive data (events, workflows) - 1 minute stale time
api.events.getByUser.useQuery({ userId }, QUERY_OPTIONS.dynamic);

// Configuration data (settings) - 10 minute cache
api.settings.getAll.useQuery(undefined, QUERY_OPTIONS.static);

// Reference data (roles, permissions) - 30 minute cache
api.admin.getRoles.useQuery(undefined, QUERY_OPTIONS.stable);
```

### Optimistic Updates

```typescript
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
  onSettled: () => {
    utils.events.getById.invalidate({ id: newData.id });
  },
});
```

## Authentication & Authorization

### Middleware Implementation

```typescript
const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { session: ctx.session },
  });
});

const enforceUserIsAdmin = t.middleware(({ ctx, next }) => {
  if (ctx.session.user.role !== UserRole.ADMIN) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});
```

### Usage in Routers

```typescript
export const eventsRouter = createTRPCRouter({
  // Public endpoint
  getPublic: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(events)
        .where(and(eq(events.id, input.id), eq(events.isPublic, true)));
    }),

  // Protected endpoint
  create: protectedProcedure
    .input(createEventSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.db.insert(events).values({
        ...input,
        userId: ctx.session.user.id,
      });
    }),

  // Admin endpoint
  deleteAny: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.delete(events).where(eq(events.id, input.id));
    }),
});
```

## Type Safety

### Type Utilities

```typescript
import type { RouterInputs, RouterOutputs } from "@/trpc/shared";

// Router-level types
type EventsInput = RouterInputs["events"];
type EventsOutput = RouterOutputs["events"];

// Procedure-level types
type CreateEventInput = RouterInputs["events"]["create"];
type EventOutput = RouterOutputs["events"]["getById"];

// Component props
interface EventFormProps {
  onSubmit: (data: CreateEventInput) => void;
  initialData?: EventOutput;
}
```

### Error Handling Utilities

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
      case "BAD_REQUEST":
        const zodErrors = getZodErrors(error);
        if (zodErrors) {
          Object.entries(zodErrors).forEach(([field, messages]) => {
            setFieldError(field, messages[0]);
          });
        }
        break;
      default:
        setError("An unexpected error occurred");
    }
  }
}
```

## Testing

### Server-Side Testing

```typescript
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

  it("requires authentication", async () => {
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

const trpcMsw = createTRPCMsw<AppRouter>();

const handlers = [
  trpcMsw.events.getAll.query(() => mockEvents),
  trpcMsw.events.create.mutation(() => mockEvent),
];

beforeEach(() => {
  server.use(...handlers);
});
```

## Best Practices

### 1. Choose the Right Data Pattern

- **Real-time**: Live metrics, monitoring → `QUERY_OPTIONS.realtime`
- **Dynamic**: User events, workflows → `QUERY_OPTIONS.dynamic`
- **Static**: Settings, configuration → `QUERY_OPTIONS.static`
- **Stable**: Roles, permissions → `QUERY_OPTIONS.stable`

### 2. Optimize Performance

```typescript
// ✅ Parallel data fetching
const [events, workflows, stats] = await Promise.all([
  api.events.getAll({ limit: 20 }),
  api.workflows.getAll({ limit: 10 }),
  api.dashboard.getStats(),
]);

// ✅ Background prefetching
const handleHover = (id: string) => {
  utils.events.getById.prefetch({ id }, { staleTime: 5 * 60 * 1000 });
};

// ✅ Batch queries for related data
const batchQueries = api.useQueries([
  {
    queryKey: ["events", userId],
    queryFn: () => api.events.getByUser.query({ userId }),
  },
  {
    queryKey: ["workflows", userId],
    queryFn: () => api.workflows.getByUser.query({ userId }),
  },
]);
```

### 3. Security Best Practices

- Always validate inputs with Zod schemas
- Use appropriate authorization middleware
- Sanitize error messages in production
- Implement rate limiting for public endpoints
- Never expose sensitive data in error messages

### 4. Development Workflow

1. Define your router with proper input validation
2. Choose appropriate base procedure (public/protected/admin)
3. Apply relevant middleware (timing, caching, rate limiting)
4. Implement the business logic using `ctx.db`
5. Add proper error handling
6. Write tests for both server and client code
7. Use appropriate query options on the client

## Troubleshooting

### Common Issues

**Type errors with RouterInputs/RouterOutputs**

```typescript
// Ensure proper imports
import type { RouterInputs } from "@/trpc/shared";
// Check that the router and procedure exist
```

**Hydration mismatches**

```typescript
// Use proper initial data handling
const { data } = api.events.getById.useQuery(
  { id },
  { initialData: serverData, staleTime: 0 },
);
```

**Cache invalidation not working**

```typescript
// Proper invalidation patterns
const updateEvent = api.events.update.useMutation({
  onSuccess: (data) => {
    utils.events.getById.invalidate({ id: data.id });
    utils.events.getAll.invalidate();
  },
});
```

**Slow queries**

- Check timing middleware logs (>1000ms operations)
- Use caching middleware for expensive operations
- Optimize database queries and add indexes

### Debug Tools

1. **React Query DevTools**: Automatically enabled in development
2. **Enhanced Logging**: Check console for timing and error information
3. **Server Timing**: Use `withTiming` middleware to identify bottlenecks

## Migration from Legacy Patterns

If updating existing code:

1. Update imports: `@/lib/trpc` → `@/trpc/react` or `@/trpc/server`
2. Replace custom query options with `QUERY_OPTIONS` patterns
3. Update procedures to use `ctx.db` instead of importing database
4. Apply appropriate middleware to procedures
5. Update error handling to use type-safe utilities

## References

- [tRPC Documentation](https://trpc.io/docs)
- [React Query Documentation](https://tanstack.com/query/latest)
- [Next.js App Router](https://nextjs.org/docs/app)

---

This configuration provides a robust, scalable foundation for building type-safe APIs with excellent performance and developer experience in Cronium.
