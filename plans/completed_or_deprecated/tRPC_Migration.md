# tRPC Migration Plan

## Executive Summary

This document outlines a comprehensive plan for completing the migration from REST API endpoints to tRPC across the Cronium codebase. Currently, approximately 45% of components have been migrated. This plan provides a phased approach to migrate the remaining components while maintaining system stability and minimizing disruption.

## Current State Analysis

### Migration Progress

- **Completed**: 18 components with `-trpc` versions
- **Pending**: 25+ components still using REST endpoints
- **tRPC Routers Available**: 16 routers already implemented (events, workflows, admin, servers, variables, logs, monitoring, tools, integrations, webhooks, settings, auth, ai, dashboard, system, userAuth)

### Key Findings

1. Several components have `-trpc` versions but the original files still contain fetch calls
2. Two critical hooks (`usePermissions.ts` and `useAuth.ts`) are not in the migration status document but need migration
3. Some admin pages appear to already use tRPC despite being listed as pending

## Migration Phases

### Phase 1: Critical Infrastructure (Week 1-2)

**Goal**: Migrate foundational hooks and authentication components that are used throughout the application

#### 1.1 Core Hooks Migration

- [ ] `src/hooks/usePermissions.ts` → Create tRPC version using `admin.roles` endpoints
- [ ] `src/hooks/useAuth.ts` → Create tRPC version using `userAuth` router
- [ ] Update all components importing these hooks to use new versions

#### 1.2 Authentication Pages

- [ ] `/auth/signin/page.tsx` → Use `auth` router
- [ ] `/auth/activate/page.tsx` → Use `auth` router
- [ ] `/auth/forgot-password/page.tsx` → Use `auth` router
- [ ] `/auth/reset-password/page.tsx` → Use `auth` router

**Rationale**: These hooks are used across the entire application. Migrating them first ensures consistent authentication and permission handling.

### Phase 2: Core Feature Components (Week 3-4)

**Goal**: Migrate critical business logic components that handle events and workflows

#### 2.1 Event Management Components

- [ ] `ConditionalActionsSection.tsx` → Use `events` router
- [ ] `EventDetailsTab.tsx` → Use `events` router
- [ ] `EventEditTab.tsx` → Use `events` router
- [ ] `EditorSettingsModal.tsx` → Use `settings` router
- [ ] `ResetCounterSwitch.tsx` → Use `events` router

#### 2.2 Workflow Management Components

- [ ] `WorkflowDetailsForm.tsx` → Use `workflows` router
- [ ] `WorkflowForm.tsx` → Use `workflows` router (update existing to remove fetch calls)
- [ ] `WorkflowsCard.tsx` → Use `workflows` router

**Rationale**: These components are central to the application's core functionality and handle complex business logic.

### Phase 3: Page-Level Components (Week 5-6)

**Goal**: Migrate dashboard pages that directly use API routes

#### 3.1 Workflow Pages

- [ ] `/dashboard/workflows/[id]/page.tsx` → Use `workflows` router
- [ ] `/dashboard/workflows/[id]/edit/page.tsx` → Use `workflows` router
- [ ] `/dashboard/workflows/new/page.tsx` → Use `workflows` router

#### 3.2 Other Dashboard Pages

- [ ] `/dashboard/servers/[id]/edit/page.tsx` → Use `servers` router
- [ ] `/dashboard/console/page.tsx` → Use `system` router
- [ ] `/dashboard/logs/[id]/page.tsx` → Use `logs` router
- [ ] `/dashboard/settings/page.tsx` → Use `settings` router

**Rationale**: Page-level components are entry points for users and should use consistent data fetching patterns.

### Phase 4: Integration & Tool Components (Week 7)

**Goal**: Complete migration of tool integrations and remaining components

#### 4.1 Tool Plugins

- [ ] `discord-plugin.tsx` → Create `-trpc` version using `tools` router
- [ ] `template-form.tsx` → Use `tools` router
- [ ] Remove fetch calls from existing `-trpc` versions:
  - [ ] `email-plugin.tsx`
  - [ ] `modular-tools-manager.tsx`

#### 4.2 Remaining Components

- [ ] `ApiTokensManager.tsx` → Use `auth` or `settings` router
- [ ] `AIScriptAssistant.tsx` → Use `ai` router
- [ ] `ServerEventsList.tsx` → Use `servers` router
- [ ] `JsonImportModal.tsx` → Use appropriate router
- [ ] `event-edit-modal.tsx` → Use `events` router
- [ ] `ServiceInitializer.tsx` → Use `system` router

### Phase 5: Cleanup & Optimization (Week 8)

**Goal**: Remove deprecated code and optimize the migration

#### 5.1 Code Cleanup

- [ ] Remove original versions of successfully migrated components
- [ ] Update imports throughout the codebase
- [ ] Remove `-trpc` suffix from migrated components (rename to original names)
- [ ] Delete unused API route files in `/app/api/`

#### 5.2 Testing & Documentation

- [ ] Comprehensive testing of all migrated components
- [ ] Update documentation to reflect new patterns
- [ ] Create migration guide for future components

## Migration Guidelines

### Standard Migration Process

1. **Create New File**: Create `ComponentName-trpc.tsx` alongside the original
2. **Identify API Calls**: Find all fetch calls to `/api/` endpoints
3. **Map to tRPC Router**: Determine which tRPC router provides equivalent functionality
4. **Replace Fetch with Hooks**:

   ```typescript
   // Before
   const response = await fetch("/api/events", { method: "GET" });
   const data = await response.json();

   // After
   const { data, isLoading, error } = api.events.getAll.useQuery();
   ```

5. **Handle Loading & Error States**: Use tRPC's built-in states
6. **Test Thoroughly**: Ensure feature parity with original
7. **Update Imports**: In parent components, import the `-trpc` version
8. **Verify & Clean**: Once stable, remove the original file

### Special Considerations

#### Authentication Components

- Use `protectedProcedure` for authenticated endpoints
- Leverage tRPC's context for session management
- Ensure proper error handling for auth failures

#### Real-time Features

- Components using WebSockets may need special handling
- Consider using tRPC subscriptions where applicable
- Maintain existing Socket.IO connections for features like terminal

#### Form Handling

- Continue migration to React Hook Form + Zod
- Utilize tRPC's input validation with Zod schemas
- Share schemas between client and server

## Success Metrics

1. **Zero REST Endpoints**: All `/api/` routes replaced with tRPC
2. **Type Safety**: Full end-to-end type safety across all data fetching
3. **Performance**: No degradation in application performance
4. **Developer Experience**: Simplified data fetching patterns
5. **Test Coverage**: All migrated components have appropriate tests

## Risk Mitigation

1. **Gradual Migration**: Use `-trpc` suffix to allow rollback
2. **Feature Flags**: Consider using feature flags for critical components
3. **Monitoring**: Track errors and performance during migration
4. **Communication**: Keep team informed of migration progress
5. **Backup Plan**: Maintain ability to quickly revert if issues arise

## Timeline Summary

- **Week 1-2**: Critical Infrastructure (Hooks & Auth)
- **Week 3-4**: Core Features (Events & Workflows)
- **Week 5-6**: Dashboard Pages
- **Week 7**: Tools & Integrations
- **Week 8**: Cleanup & Documentation

Total estimated time: 8 weeks for complete migration

## Next Steps

1. Review and approve this migration plan
2. Assign developers to each phase
3. Set up tracking for migration progress
4. Begin Phase 1 with the critical hooks migration
5. Schedule regular check-ins to monitor progress

## Appendix: Component Mapping

### Components to tRPC Router Mapping

| Component                     | Current API              | Target tRPC Router |
| ----------------------------- | ------------------------ | ------------------ |
| usePermissions.ts             | /api/admin/roles         | admin.roles        |
| useAuth.ts                    | /api/auth/user           | userAuth           |
| ConditionalActionsSection.tsx | /api/events              | events             |
| WorkflowForm.tsx              | /api/workflows           | workflows          |
| ApiTokensManager.tsx          | /api/auth/tokens         | auth.tokens        |
| AIScriptAssistant.tsx         | /api/ai                  | ai                 |
| discord-plugin.tsx            | /api/tools/discord       | tools.discord      |
| ServerEventsList.tsx          | /api/servers/[id]/events | servers.getEvents  |

### API Routes to Deprecate

Once migration is complete, the following API routes can be removed:

- `/app/api/events/*`
- `/app/api/workflows/*`
- `/app/api/servers/*`
- `/app/api/auth/*` (except NextAuth routes)
- `/app/api/admin/*`
- `/app/api/tools/*`
