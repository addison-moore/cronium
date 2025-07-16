# Performance Improvement Brainstorm

## Executive Summary

This document outlines potential performance improvements for the Cronium application based on analysis of the current codebase. The improvements are organized by impact level and implementation complexity to help prioritize efforts for maximum benefit with minimal complexity.

## Critical Performance Issues Identified

### 1. **N+1 Database Query Problem** 🚨

- **Impact**: VERY HIGH
- **Complexity**: LOW-MEDIUM
- **Location**: `src/server/storage.ts` - `getEventWithRelations()`
- **Issue**: Makes 8-10 sequential queries per event when 1-2 would suffice
- **Solution**: Rewrite using SQL joins or batch queries

### 2. **Large JavaScript Bundles**

- **Impact**: HIGH
- **Complexity**: LOW
- **Issue**: Heavy components loaded on every page (Monaco Editor, XTerm.js, XyFlow)
- **Solution**: Implement code splitting with dynamic imports

### 3. **Excessive Client-Side Rendering**

- **Impact**: MEDIUM-HIGH
- **Complexity**: MEDIUM
- **Issue**: Most dashboard pages use "use client" unnecessarily
- **Solution**: Convert to Server Components where possible

## Performance Improvement Strategies

### 1. Database Optimization (Highest Priority)

#### A. Fix N+1 Query Patterns

```typescript
// Current approach (BAD):
const event = await getEvent(id);
const servers = await getServersByEventId(id);
const workflows = await getWorkflowsByEventId(id);
// ... 6 more queries

// Optimized approach (GOOD):
const eventWithRelations = await db.query.events.findFirst({
  where: eq(events.id, id),
  with: {
    servers: true,
    workflows: true,
    variables: true,
    // ... all relations in one query
  },
});
```

**Benefits**:

- Reduce database round trips by 80-90%
- Faster page loads (especially on list pages)
- Lower database load

#### B. Add Database Indexes

```sql
CREATE INDEX idx_logs_event_id ON logs(event_id);
CREATE INDEX idx_logs_created_at ON logs(created_at DESC);
CREATE INDEX idx_events_user_id ON events(user_id);
```

### 2. Caching Strategy

#### A. Implement Valkey (Redis Alternative)

```typescript
// Add to docker-compose.yml
services:
  valkey:
    image: valkey/valkey:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - valkey_data:/data

// Cache implementation
const cache = new Valkey({
  url: process.env.VALKEY_URL
});

// In tRPC procedures
const cachedData = await cache.get(key);
if (cachedData) return cachedData;

const data = await expensive_operation();
await cache.set(key, data, { ex: 300 }); // 5 min TTL
```

**Benefits**:

- Persistent cache across restarts
- Distributed caching for multiple instances
- Cache invalidation strategies

#### B. Next.js Data Cache

```typescript
import { unstable_cache } from "next/cache";

const getCachedEvents = unstable_cache(
  async (userId: string) => {
    return await db.query.events.findMany({
      where: eq(events.userId, userId),
    });
  },
  ["events"],
  {
    revalidate: 60, // seconds
    tags: ["events"],
  },
);
```

### 3. Code Splitting & Lazy Loading

#### A. Heavy Component Splitting

```typescript
// Instead of direct imports
import dynamic from 'next/dynamic';

const MonacoEditor = dynamic(
  () => import('@monaco-editor/react'),
  {
    loading: () => <Skeleton className="h-96" />,
    ssr: false
  }
);

const Terminal = dynamic(
  () => import('@/components/terminal/Terminal'),
  {
    loading: () => <LoadingState text="Loading terminal..." />,
    ssr: false
  }
);

const WorkflowBuilder = dynamic(
  () => import('@/components/workflow/WorkflowBuilder'),
  {
    loading: () => <Skeleton className="h-96" />,
    ssr: false
  }
);
```

**Benefits**:

- Reduce initial bundle size by 50-70%
- Faster page loads
- Load components only when needed

### 4. Server Components & Streaming

#### A. Convert Dashboard Pages to Server Components

```typescript
// Current (Client Component)
'use client';
export default function EventsPage() {
  const { data, isLoading } = api.events.list.useQuery();
  if (isLoading) return <Spinner />;
  return <EventsList events={data} />;
}

// Optimized (Server Component)
export default async function EventsPage() {
  const events = await api.events.list();
  return <EventsList events={events} />;
}
```

#### B. Implement Streaming with Suspense

```typescript
// app/dashboard/layout.tsx
export default function DashboardLayout({ children }) {
  return (
    <div>
      <Suspense fallback={<HeaderSkeleton />}>
        <DashboardHeader />
      </Suspense>
      <Suspense fallback={<ContentSkeleton />}>
        {children}
      </Suspense>
    </div>
  );
}
```

### 5. Partial Prerendering (PPR)

#### Enable PPR for Mixed Content Pages

```typescript
// next.config.mjs
export default {
  experimental: {
    ppr: true
  }
};

// In page components
export const experimental_ppr = true;

// Static shell with dynamic content
export default async function DashboardPage() {
  return (
    <>
      {/* Static parts render immediately */}
      <DashboardLayout>
        {/* Dynamic parts stream in */}
        <Suspense fallback={<StatsSkeleton />}>
          <DashboardStats />
        </Suspense>
      </DashboardLayout>
    </>
  );
}
```

### 6. Loading State Standardization

#### A. Create Consistent Loading Components

```typescript
// Create a unified loading system
export const LoadingBoundary = ({ children, fallback }) => {
  return (
    <Suspense fallback={fallback || <DefaultLoader />}>
      {children}
    </Suspense>
  );
};

// Use loading.tsx files
// app/dashboard/events/loading.tsx
export default function Loading() {
  return <EventsListSkeleton />;
}
```

#### B. Table and List Skeletons

```typescript
export function TableSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
```

### 7. Client-Side Optimizations

#### A. Implement State Management with Zustand

```typescript
// Replace prop drilling and reduce re-renders
import { create } from "zustand";

const useAppStore = create((set) => ({
  user: null,
  notifications: [],
  setUser: (user) => set({ user }),
  addNotification: (notification) =>
    set((state) => ({
      notifications: [...state.notifications, notification],
    })),
}));
```

#### B. Optimize Re-renders

```typescript
// Use memo for expensive components
export const EventCard = memo(({ event }) => {
  return <div>...</div>;
}, (prevProps, nextProps) => {
  return prevProps.event.id === nextProps.event.id;
});

// Use useMemo for expensive calculations
const processedData = useMemo(() => {
  return expensiveCalculation(data);
}, [data]);
```

### 8. Image and Asset Optimization

#### A. Use Next.js Image Component

```typescript
import Image from 'next/image';

<Image
  src="/logo.png"
  alt="Logo"
  width={200}
  height={50}
  priority // for above-fold images
  placeholder="blur"
  blurDataURL={shimmer}
/>
```

#### B. Font Optimization

```typescript
// Use next/font for optimal loading
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  preload: true,
});
```

### 9. API and Network Optimizations

#### A. Implement Request Deduplication

```typescript
// In tRPC context
const requestCache = new Map();

export const dedupe = (key: string, fn: () => Promise<any>) => {
  if (requestCache.has(key)) {
    return requestCache.get(key);
  }

  const promise = fn().finally(() => {
    requestCache.delete(key);
  });

  requestCache.set(key, promise);
  return promise;
};
```

#### B. Batch API Requests

```typescript
// Use tRPC batching
export const api = createTRPCNext<AppRouter>({
  config() {
    return {
      links: [
        httpBatchLink({
          url: "/api/trpc",
          maxURLLength: 2083,
        }),
      ],
    };
  },
});
```

### 10. Monitoring and Profiling

#### A. Add Performance Monitoring

```typescript
// Use Web Vitals
import { onCLS, onFID, onFCP, onLCP, onTTFB } from "web-vitals";

export function reportWebVitals(metric) {
  console.log(metric);
  // Send to analytics
}
```

#### B. React DevTools Profiler

- Use React DevTools Profiler to identify slow components
- Look for components that re-render frequently
- Identify expensive render operations

## Implementation Priority Matrix

### Quick Wins (High Impact, Low Effort)

1. **Fix N+1 Queries** - 1-2 days, massive performance gain
2. **Code Split Heavy Components** - 1 day, 50-70% bundle reduction
3. **Add Database Indexes** - Few hours, faster queries
4. **Implement loading.tsx files** - 1 day, better UX

### Medium Term (High Impact, Medium Effort)

1. **Implement Valkey Caching** - 3-4 days, significant performance boost
2. **Convert to Server Components** - 1 week, reduced bundle size
3. **Standardize Loading States** - 3-4 days, better UX
4. **Enable PPR** - 3-4 days, faster perceived performance

### Long Term (Medium Impact, Higher Effort)

1. **State Management with Zustand** - 1-2 weeks, better performance
2. **Complete Performance Monitoring** - 1 week, ongoing optimization
3. **API Optimization** - 1-2 weeks, better network performance

## Metrics to Track

1. **Core Web Vitals**
   - LCP (Largest Contentful Paint) < 2.5s
   - FID (First Input Delay) < 100ms
   - CLS (Cumulative Layout Shift) < 0.1

2. **Application Metrics**
   - Time to Interactive (TTI)
   - Total Bundle Size
   - API Response Times
   - Database Query Times

3. **User Experience Metrics**
   - Page Load Times
   - Form Submission Times
   - Search Response Times

## Conclusion

The most impactful improvements with minimal complexity are:

1. **Fix N+1 database queries** (could improve performance by 80%+ on some pages)
2. **Implement code splitting** for heavy components (reduce bundle by 50-70%)
3. **Add Valkey caching** (reduce database load, faster responses)
4. **Convert dashboard to Server Components** (smaller bundles, faster loads)

Starting with these four improvements would provide the most significant performance gains while keeping implementation complexity manageable. The N+1 query fix alone could dramatically improve the application's responsiveness, especially for users with many events or complex workflows.
