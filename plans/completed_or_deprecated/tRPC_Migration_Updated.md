# tRPC Migration Plan - Updated for Current Configuration

Last Updated: 2025-07-06

## Executive Summary

Based on a comprehensive review of the current tRPC configuration and progress, this updated plan provides a realistic assessment of remaining migration tasks. Cronium has a sophisticated tRPC setup with 17 routers and advanced features including middleware, optimized QueryClient configuration, and comprehensive type utilities. The migration is now **85-90% complete**.

## Current State Analysis (Post-Review)

### Migration Progress

- **Completed Components**: Most critical components already migrated (75%+ completion)
- **Available tRPC Routers**: 17 routers fully implemented with comprehensive coverage
- **Advanced Features**: Production-ready configuration with middleware, caching, and performance optimization
- **Type Safety**: Complete end-to-end type safety with utility helpers

### Key Findings from Review

1. **Configuration is Production-Ready**: The tRPC setup follows Next.js 15 App Router best practices with:
   - Enhanced QueryClient with smart retry logic
   - Server-side caller with React cache optimization
   - Development-only DevTools integration
   - Comprehensive error handling and logging

2. **Most Components Already Migrated**: During our Phase 4 work, we discovered:
   - `ApiTokensManager.tsx` - Already fully migrated to tRPC
   - `AIScriptAssistant.tsx` - Already fully migrated to tRPC
   - Several other components had partial or complete migrations

3. **Router Coverage is Comprehensive**: Available routers cover all business domains:
   - `events`, `workflows`, `servers`, `admin`, `monitoring`
   - `tools`, `integrations`, `webhooks`, `settings`
   - `auth`, `userAuth`, `ai`, `dashboard`, `system`
   - `variables`, `logs`

## Remaining Migration Tasks

### Phase 4 Completion: Final Component Migrations

Based on thorough examination of the codebase (January 2025):

#### 4.1 Completed Core Components

- [x] ~~`ApiTokensManager.tsx`~~ → **ALREADY MIGRATED** - Fully uses tRPC
- [x] ~~`AIScriptAssistant.tsx`~~ → **ALREADY MIGRATED** - Fully uses tRPC
- [x] ~~`ConditionalActionsSection.tsx`~~ → **ALREADY MIGRATED** - Fully uses tRPC
- [x] ~~`WorkflowForm.tsx`~~ → **ALREADY MIGRATED** - Fully uses tRPC
- [x] ~~`EventEditTab.tsx`~~ → **ALREADY MIGRATED** - Fully uses tRPC
- [x] ~~`EventDetailsTab.tsx`~~ → **ALREADY MIGRATED** - Fully uses tRPC
- [x] ~~`WorkflowDetailsForm.tsx`~~ → **ALREADY MIGRATED** - Fully uses tRPC
- [x] ~~`ServerEventsList.tsx`~~ → **ALREADY MIGRATED** - Fully uses tRPC
- [x] ~~`modular-tools-manager.tsx`~~ → **ALREADY MIGRATED** - Fully uses tRPC
- [x] ~~`discord-plugin.tsx`~~ → **NO MIGRATION NEEDED** - UI component only, sending via tRPC in IntegrationTestPanel

#### 4.2 Remaining Components to Migrate (10% of total)

- [ ] `WebhookDashboard.tsx` → Use `webhooks` router
- [ ] `WebhookForm.tsx` → Use `webhooks` router mutations
- [ ] `WebhookMonitor.tsx` → Use `webhooks` router queries
- [ ] `Terminal.tsx` → May not need migration (uses WebSocket directly)

### Phase 5: Migration Cleanup & Optimization

#### 5.1 Code Consolidation

- [ ] Replace original files with `-trpc` versions (rename and remove suffixes)
- [ ] Update all import statements across the codebase
- [ ] Remove deprecated API route files
- [ ] Update component exports in index files

#### 5.2 Configuration Optimization

- [ ] Implement pre-configured query options from `@/trpc/shared`:
  ```typescript
  // Replace custom query options with standardized patterns
  QUERY_OPTIONS.realtime; // Live data (30s refresh)
  QUERY_OPTIONS.dynamic; // User interactive (1min stale)
  QUERY_OPTIONS.static; // Settings (10min stale)
  QUERY_OPTIONS.stable; // Reference data (1hr stale)
  ```

#### 5.3 Advanced Features Implementation

- [ ] Add middleware to procedures where beneficial:

  ```typescript
  // Performance monitoring
  export const timedProcedure = publicProcedure.use(withTiming);

  // Caching for expensive operations
  export const cachedProcedure = publicProcedure.use(withCache(300000));

  // Rate limiting for public endpoints
  export const rateLimitedProcedure = publicProcedure.use(withRateLimit(100));
  ```

#### 5.4 Testing & Documentation

- [ ] Add server-side tests using `createTestCaller`
- [ ] Implement client-side mocking with MSW
- [ ] Update documentation to reflect current patterns
- [ ] Create migration examples for future development

#### 4.3 Remaining Dashboard Pages

- [ ] `/dashboard/admin/users/[id]/page.tsx`
- [ ] `/dashboard/console/page.tsx`
- [ ] `/dashboard/logs/[id]/page.tsx`
- [ ] `/dashboard/settings/page.tsx`
- [ ] `/dashboard/workflows/[id]/edit/page.tsx`
- [ ] `/dashboard/workflows/[id]/page.tsx`
- [ ] `/dashboard/workflows/new/page.tsx`

## Updated Migration Guidelines

### Current Best Practices (2025)

#### 1. Use Proper Import Patterns

```typescript
// Client components
import { api } from "@/trpc/react";
import { QUERY_OPTIONS } from "@/trpc/shared";

// Server components
import { api } from "@/trpc/server";

// Type imports
import type { RouterInputs, RouterOutputs } from "@/trpc/shared";
```

#### 2. Apply Appropriate Query Options

```typescript
// Real-time monitoring data
const { data } = api.monitoring.getMetrics.useQuery(
  undefined,
  QUERY_OPTIONS.realtime,
);

// User interactive data
const { data } = api.events.getByUser.useQuery(
  { userId },
  QUERY_OPTIONS.dynamic,
);

// Configuration data
const { data } = api.settings.getAll.useQuery(undefined, QUERY_OPTIONS.static);
```

#### 3. Implement Proper Error Handling

```typescript
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
        const fieldError = getFieldError(error, "fieldName");
        if (fieldError) setFieldError("fieldName", fieldError);
        break;
    }
  }
}
```

#### 4. Use Optimistic Updates Pattern

```typescript
const updateMutation = api.events.update.useMutation({
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

## Router Mapping Reference

### Available Routers and Their Coverage

| Router         | Purpose               | Key Endpoints                                                                  |
| -------------- | --------------------- | ------------------------------------------------------------------------------ |
| `events`       | Event management      | `getAll`, `getById`, `create`, `update`, `delete`, `run`, `duplicate`          |
| `workflows`    | Workflow operations   | `getAll`, `getById`, `create`, `update`, `delete`, `execute`                   |
| `servers`      | Server management     | `getAll`, `getById`, `getServerEvents`, `create`, `update`, `delete`           |
| `admin`        | Administration        | `getUsers`, `getRoles`, `updateUser`, `systemSettings`                         |
| `auth`         | Authentication        | `getApiTokens`, `createApiToken`, `revokeApiToken`, `deleteApiToken`           |
| `userAuth`     | User authentication   | User session and profile management                                            |
| `tools`        | Tool integrations     | `getAll`, `create`, `update`, `delete`, `getStats`                             |
| `integrations` | Integration templates | `templates.getAll`, `templates.create`, `templates.update`, `templates.delete` |
| `settings`     | Application settings  | `getAll`, `update`, `getEditorSettings`, `getAIStatus`                         |
| `ai`           | AI services           | `generateScript`                                                               |
| `system`       | System operations     | System status and initialization                                               |
| `monitoring`   | Monitoring data       | Metrics and performance data                                                   |
| `logs`         | Log management        | `getAll`, `getById`                                                            |
| `webhooks`     | Webhook operations    | Webhook management                                                             |
| `variables`    | Variable management   | Global and user variables                                                      |
| `dashboard`    | Dashboard data        | Statistics and overview data                                                   |

## Success Metrics (Updated January 2025)

1. **Migration Completion**: ~5% remaining (webhook components and some dashboard pages)
2. **Code Consolidation**: Remove phantom `-trpc` files and deprecated API routes
3. **Type Safety**: Full utilization of type utilities and helpers
4. **Performance**: Implement optimized query patterns and middleware
5. **Testing**: Comprehensive test coverage using provided utilities
6. **Documentation**: Updated guides reflecting current best practices

## Timeline (Updated January 2025)

- **Week 1**:
  - Migrate webhook components (WebhookDashboard, WebhookForm, WebhookMonitor)
  - Migrate remaining dashboard pages
  - Remove deprecated API routes
- **Week 2**:
  - Code consolidation and optimization
  - Implement standardized query patterns
  - Testing and documentation updates

**Total estimated time**: 1-2 weeks (significantly reduced from original 8-week estimate)

## Conclusion

The tRPC migration is **85-90% complete**, much further along than initially documented. The current configuration is production-ready with advanced features that exceed standard tRPC setups. The remaining work focuses on:

1. **Webhook Components**: WebhookDashboard, WebhookForm, and WebhookMonitor
2. **Dashboard Pages**: 7 pages still using API routes
3. **Cleanup**: Remove deprecated API routes and phantom git files
4. **Polish**: Testing and documentation updates

This represents a minimal scope, allowing for completion within 1-2 weeks rather than the originally estimated 8 weeks.
