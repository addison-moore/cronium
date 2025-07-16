# Phase 2.1: Server Components Migration Plan

## Migration Order (Simplest to Most Complex)

### Tier 1: Static/Low Interaction Pages (Start Here)

These pages have minimal real-time requirements and simple interactions.

#### 1. **Servers List Page** ✅ Best Starting Point

- **Current**: Client component with `api.servers.getAll.useQuery()`
- **Migration**: Server component with server-side data fetch
- **Client Parts**: Health check button, delete actions
- **Complexity**: LOW
- **Real-time**: Minimal (occasional health checks)

#### 2. **Settings Page**

- **Current**: Client component with forms
- **Migration**: Server component for display, client forms
- **Client Parts**: All form components
- **Complexity**: LOW
- **Real-time**: None

### Tier 2: List Pages with Moderate Interaction

#### 3. **Events List Page**

- **Current**: Client component with multiple queries and mutations
- **Migration**: Server component wrapper, client EventsList table
- **Client Parts**: Table with actions, filters, bulk operations
- **Complexity**: MEDIUM
- **Real-time**: Moderate (user-triggered updates)

#### 4. **Workflows List Page**

- **Current**: Client component with WorkflowList
- **Migration**: Server component wrapper, client list
- **Client Parts**: List component with actions
- **Complexity**: MEDIUM
- **Real-time**: Moderate (similar to events)

### Tier 3: Detail Pages

#### 5. **Event Details Page**

- **Current**: Client component with tabs
- **Migration**: Server component for layout, client tabs
- **Client Parts**: Tabs, edit functionality, execution
- **Complexity**: MEDIUM
- **Real-time**: Execution status updates

#### 6. **Server Details Page**

- **Current**: Client component
- **Migration**: Server component with client actions
- **Client Parts**: Health monitoring, SSH testing
- **Complexity**: MEDIUM
- **Real-time**: Health status

#### 7. **Workflow Details Page**

- **Current**: Client component with canvas
- **Migration**: Server wrapper, client canvas
- **Client Parts**: WorkflowCanvas (ReactFlow)
- **Complexity**: HIGH (due to canvas)
- **Real-time**: Execution tracking

### Tier 4: High Real-time Requirements

#### 8. **Logs Page**

- **Current**: Direct tRPC queries, real-time updates
- **Migration**: Hybrid approach with streaming
- **Client Parts**: Log viewer, filters, real-time updates
- **Complexity**: HIGH
- **Real-time**: Critical (live log streaming)

#### 9. **Dashboard Page**

- **Current**: Client with 30-second polling
- **Migration**: Server stats, client charts
- **Client Parts**: DashboardStats component
- **Complexity**: MEDIUM
- **Real-time**: Stats updates every 30s

#### 10. **Monitoring Page**

- **Current**: Client with real-time metrics
- **Migration**: Initial server render, client updates
- **Client Parts**: Charts, metrics displays
- **Complexity**: HIGH
- **Real-time**: Critical

### Tier 5: Keep as Client Components

These pages have heavy interaction and should remain client components:

1. **Console Page** - Terminal requires client-side execution
2. **All Form Pages** - Complex validation and state management
3. **Tools Page** - Complex plugin system
4. **Admin Pages** - Complex user management

## Component Extraction Strategy

### Pattern 1: List Page Migration

```typescript
// Before (Client Component)
"use client";
export default function EventsPage() {
  const { data } = api.events.getAll.useQuery();
  return <EventsList events={data} />;
}

// After (Server Component)
export default async function EventsPage() {
  const events = await api.events.getAll.fetch();
  return <EventsList initialEvents={events} />;
}
```

### Pattern 2: Detail Page Migration

```typescript
// Server Component (page.tsx)
export default async function EventDetailsPage({ params }) {
  const event = await api.events.getById.fetch({ id: params.id });
  return <EventDetailsClient initialEvent={event} />;
}

// Client Component (EventDetailsClient.tsx)
"use client";
export function EventDetailsClient({ initialEvent }) {
  // Interactive parts here
}
```

### Pattern 3: Mixed Content Migration

```typescript
// Server Component
export default async function DashboardPage() {
  const stats = await api.dashboard.getStats.fetch();
  return (
    <>
      <ServerRenderedStats stats={stats} />
      <ClientSideCharts />
    </>
  );
}
```

## Implementation Steps for Each Page

### Step 1: Remove "use client" directive

### Step 2: Convert data fetching to server-side

### Step 3: Extract interactive parts to client components

### Step 4: Pass initial data as props

### Step 5: Implement real-time updates in client components

### Step 6: Add proper error boundaries

### Step 7: Test authentication flow

## Authentication Handling

### Current Pattern

```typescript
const session = useSession();
if (!session) redirect("/auth/signin");
```

### Server Component Pattern

```typescript
import { getServerSession } from "next-auth";
const session = await getServerSession(authOptions);
if (!session) redirect("/auth/signin");
```

## Real-time Update Strategies

### 1. **Polling in Client Components**

For moderate real-time needs (events, workflows)

### 2. **WebSocket Subscriptions**

For critical real-time data (logs, monitoring)

### 3. **Server-Sent Events**

For one-way updates (job status, notifications)

### 4. **Optimistic Updates**

Continue using for user actions

## Success Metrics

1. **Bundle Size Reduction**: Target 40% reduction in JS
2. **Initial Load Time**: Target 50% faster
3. **Time to Interactive**: Maintain current performance
4. **SEO Improvement**: Server-rendered content
5. **No Feature Regression**: All functionality preserved
