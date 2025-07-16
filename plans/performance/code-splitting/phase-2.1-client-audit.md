# Phase 2.1: Client Component Audit Results

## Overview

Found extensive "use client" usage across the codebase:

- **22 pages** with "use client" directives
- **157+ components** with "use client" directives

## Pages Analysis

### Dashboard Pages (All using "use client")

1. **Main Dashboard Pages**
   - `/dashboard/page.tsx` - Main dashboard with stats
   - `/dashboard/events/page.tsx` - Events list
   - `/dashboard/workflows/page.tsx` - Workflows list
   - `/dashboard/servers/page.tsx` - Servers list
   - `/dashboard/logs/page.tsx` - Logs list
   - `/dashboard/settings/page.tsx` - Settings
   - `/dashboard/monitoring/page.tsx` - Monitoring
   - `/dashboard/console/page.tsx` - Terminal console

2. **Detail Pages**
   - `/dashboard/events/[id]/page.tsx` - Event details
   - `/dashboard/workflows/[id]/page.tsx` - Workflow details
   - `/dashboard/servers/[id]/page.tsx` - Server details
   - `/dashboard/logs/[id]/page.tsx` - Log details

3. **Form Pages**
   - `/dashboard/events/new/page.tsx` - New event form
   - `/dashboard/events/[id]/edit/page.tsx` - Edit event form
   - `/dashboard/workflows/new/page.tsx` - New workflow form
   - `/dashboard/workflows/[id]/edit/page.tsx` - Edit workflow form
   - `/dashboard/servers/new/page.tsx` - New server form
   - `/dashboard/servers/[id]/edit/page.tsx` - Edit server form

4. **Admin Pages**
   - `/dashboard/admin/page.tsx` - Admin dashboard
   - `/dashboard/admin/users/[id]/page.tsx` - User details

5. **Tools Pages**
   - `/dashboard/tools/page.tsx` - Tools management

## Component Categories

### 1. Heavy Interactive Components (Should remain client)

- Terminal components
- Monaco Editor components
- Workflow Canvas (XyFlow/ReactFlow)
- Action Builder
- AI Script Assistant
- Form components with complex state

### 2. Data Display Components (Server component candidates)

- Tables (EventsList, JobsTable, WorkflowList)
- Status badges
- Detail views
- Stats displays
- Lists and grids

### 3. UI Library Components (Must remain client)

- All Radix UI components
- Form components
- Interactive UI elements
- Modals and dialogs

### 4. Provider Components (Must remain client)

- ThemeProvider
- LanguageProvider
- NextIntlProvider
- TRPC Provider

## Data Fetching Patterns

### Current Pattern (Client-side)

Most pages use client-side tRPC queries:

```typescript
const { data, isLoading } = api.events.list.useQuery();
```

### Server Component Pattern (Target)

Should migrate to server-side data fetching:

```typescript
const data = await api.events.list.fetch();
```

## Migration Opportunities

### High Priority (Simple pages, big impact)

1. **List Pages** - Can be server components with client tables
   - Events list
   - Workflows list
   - Servers list
   - Logs list

2. **Detail Pages** - Can be server components with client interactions
   - Event details (except edit forms)
   - Workflow details (except canvas)
   - Server details
   - Log details

### Medium Priority (Mixed content)

1. **Dashboard Page** - Stats can be server, charts client
2. **Settings Page** - Forms remain client, display server
3. **Admin Pages** - User management tables can be server

### Low Priority (Heavy interaction)

1. **Console Page** - Terminal must remain client
2. **Tools Page** - Complex interactions
3. **Form Pages** - All forms need client-side validation

## Key Findings

### Benefits of Migration

1. **Reduced Bundle Size**: ~500KB+ of React/tRPC code can be removed from client
2. **Faster Initial Load**: Server components render immediately
3. **Better SEO**: Server-rendered content is crawlable
4. **Reduced Hydration**: Less JavaScript to execute on client

### Challenges

1. **Authentication**: Need to handle auth in server components
2. **Real-time Updates**: WebSocket connections for live data
3. **Interactive Features**: Need careful extraction to client components
4. **Type Safety**: Maintaining types across server/client boundary

## Migration Strategy

### Phase 1: Simple List Pages

Start with read-only list pages that have minimal interaction:

1. Events list → Server component with client-side table
2. Workflows list → Server component with client-side list
3. Servers list → Server component with client-side grid
4. Logs list → Server component with client-side table

### Phase 2: Detail Pages

Migrate detail pages while keeping interactive parts client:

1. Event details → Server with client tabs
2. Workflow details → Server with client canvas
3. Server details → Server with client actions
4. Log details → Server with client terminal output

### Phase 3: Dashboard & Admin

1. Main dashboard → Server stats, client charts
2. Admin pages → Server tables, client actions
3. Settings → Server display, client forms

### Phase 4: Complex Pages

These remain mostly client due to heavy interaction:

1. Console (Terminal)
2. Tools management
3. All form pages

## Next Steps

1. Create server component wrappers for list pages
2. Extract interactive parts into focused client components
3. Convert data fetching from client to server
4. Test authentication flow with server components
