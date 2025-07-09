# Remaining REST API Endpoints Analysis

## Overview

While the tRPC migration has made significant progress, there are still **59 REST API endpoints** that could potentially be migrated to tRPC for complete type safety and consistency.

## Endpoints by Category

### 1. Authentication Endpoints (11 endpoints)

These use Next-Auth and custom auth logic:

- `/api/auth/[...nextauth]` - ⚠️ Keep as REST (Next-Auth requirement)
- `/api/auth/activate` - ✅ Can migrate to tRPC
- `/api/auth/forgot-password` - ✅ Already migrated (userAuth.forgotPassword)
- `/api/auth/passport/login` - ✅ Can migrate to tRPC
- `/api/auth/register` - ✅ Already migrated (userAuth.register)
- `/api/auth/reset-password` - ✅ Already migrated (userAuth.resetPassword)
- `/api/auth/signup` - ✅ Duplicate of register, can remove
- `/api/auth/user` - ✅ Already migrated (userAuth.getCurrentUser)
- `/api/auth/verify-token` - ✅ Already migrated (userAuth.verifyToken)
- `/api/login` - ✅ Can migrate to tRPC
- `/api/logout` - ✅ Can migrate to tRPC

### 2. Admin Endpoints (16 endpoints)

Full admin functionality not yet migrated:

- `/api/admin/logs` - ✅ Can migrate to tRPC
- `/api/admin/logs/[id]` - ✅ Can migrate to tRPC
- `/api/admin/roles` - ✅ Can migrate to tRPC
- `/api/admin/settings` - ✅ Can migrate to tRPC (extend settings router)
- `/api/admin/terminal` - ⚠️ Keep as REST (WebSocket/streaming)
- `/api/admin/users` - ✅ Partially exists in admin router
- `/api/admin/users/[id]` - ✅ Can extend admin router
- `/api/admin/users/[id]/approve` - ✅ Can migrate to tRPC
- `/api/admin/users/[id]/deny` - ✅ Can migrate to tRPC
- `/api/admin/users/[id]/disable` - ✅ Can migrate to tRPC
- `/api/admin/users/[id]/enable` - ✅ Can migrate to tRPC
- `/api/admin/users/[id]/promote` - ✅ Can migrate to tRPC
- `/api/admin/users/[id]/resend-invitation` - ✅ Can migrate to tRPC
- `/api/admin/users/invite` - ✅ Can migrate to tRPC
- `/api/admin/variables` - ✅ Already migrated (variables router)
- `/api/admin/variables/[id]` - ✅ Already migrated (variables router)

### 3. Events Endpoints (10 endpoints)

Partially migrated:

- `/api/events` - ✅ Already migrated (events router)
- `/api/events/[id]` - ✅ Already migrated (events router)
- `/api/events/[id]/activate` - ✅ Can add to events router
- `/api/events/[id]/execute` - ✅ Already migrated (events.execute)
- `/api/events/[id]/logs` - ✅ Can add to events router
- `/api/events/[id]/reset-counter` - ✅ Can add to events router
- `/api/events/[id]/run` - ✅ Duplicate of execute
- `/api/events/[id]/workflows` - ✅ Can add to events router
- `/api/events/download` - ✅ Can add to events router

### 4. Workflows Endpoints (11 endpoints)

Partially migrated:

- `/api/workflows` - ✅ Already migrated (workflows router)
- `/api/workflows/[id]` - ✅ Already migrated (workflows router)
- `/api/workflows/[id]/archive` - ✅ Can add to workflows router
- `/api/workflows/[id]/execute` - ✅ Already migrated (workflows.execute)
- `/api/workflows/[id]/executions` - ✅ Already migrated (workflows.getExecutions)
- `/api/workflows/[id]/executions/[executionId]` - ✅ Already migrated (workflows.getExecution)
- `/api/workflows/bulk-archive` - ✅ Can migrate (bulkOperation exists)
- `/api/workflows/executions` - ✅ Already migrated
- `/api/workflows/webhook/[key]` - ⚠️ Keep as REST (external webhook endpoint)
- `/api/workflow-events` - ✅ Can migrate to tRPC

### 5. Server Management (4 endpoints)

Not yet migrated:

- `/api/servers` - ✅ Already migrated (servers router)
- `/api/servers/[id]` - ✅ Already migrated (servers router)
- `/api/servers/[id]/check-status` - ✅ Can add to servers router
- `/api/servers/[id]/events` - ✅ Can add to servers router

### 6. Logs Endpoints (3 endpoints)

- `/api/logs` - ✅ Already migrated (logs router)
- `/api/logs/[id]` - ✅ Already migrated (logs router)
- `/api/logs/workflows` - ✅ Can add to logs router

### 7. Settings Endpoints (2 endpoints)

- `/api/settings` - ✅ Already migrated (settings router)
- `/api/settings/ai-status` - ✅ Already migrated (settings.getAIStatus)

### 8. System Endpoints (4 endpoints)

- `/api/health` - ⚠️ Keep as REST (health checks)
- `/api/cron` - ⚠️ Keep as REST (cron handler)
- `/api/callback` - ⚠️ Keep as REST (OAuth callback)
- `/api/[...notfound]` - ⚠️ Keep as REST (404 handler)

## Migration Priority

### High Priority (Quick Wins)

1. **Events Operations** - Add missing operations to events router:
   - activate
   - resetCounter
   - getLogs
   - getWorkflows
   - download

2. **Admin User Operations** - Extend admin router:
   - approveUser
   - denyUser
   - enableUser
   - disableUser
   - promoteUser
   - resendInvitation
   - inviteUser

3. **Server Operations** - Add to servers router:
   - checkStatus
   - getEvents

### Medium Priority

1. **Authentication** - Migrate custom auth endpoints:
   - activate
   - passport login
   - custom login/logout

2. **Admin Settings** - Extend admin router:
   - roles management
   - admin-specific settings
   - logs management

3. **Workflow Operations** - Add remaining operations:
   - archive
   - bulk operations
   - workflow events

### Low Priority / Keep as REST

1. **System Endpoints** - Keep for compatibility:
   - `/api/health` - Standard health check
   - `/api/cron` - External cron triggers
   - `/api/callback` - OAuth callbacks
   - `/api/[...notfound]` - 404 handling

2. **Special Endpoints** - Technical requirements:
   - `/api/auth/[...nextauth]` - Next-Auth requirement
   - `/api/workflows/webhook/[key]` - External webhooks
   - `/api/admin/terminal` - WebSocket terminal

## Recommended Actions

### 1. Immediate Actions

```typescript
// Add to events router
eventActivate: protectedProcedure
  .input(z.object({ id: z.number() }))
  .mutation(async ({ ctx, input }) => {
    // Activate event logic
  }),

eventResetCounter: protectedProcedure
  .input(z.object({ id: z.number() }))
  .mutation(async ({ ctx, input }) => {
    // Reset counter logic
  }),
```

### 2. Extend Admin Router

```typescript
// Add user management operations
approveUser: adminProcedure
  .input(z.object({ userId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    // Approve user logic
  }),
```

### 3. Clean Up Duplicates

- Remove `/api/auth/signup` (duplicate of register)
- Remove `/api/events/[id]/run` (duplicate of execute)
- Remove various already-migrated endpoints

## Benefits of Full Migration

1. **Complete Type Safety** - All API calls type-safe
2. **Consistency** - Single API pattern throughout
3. **Better DX** - Auto-completion everywhere
4. **Reduced Bundle** - Remove REST API code
5. **Unified Error Handling** - Consistent errors

## Estimated Effort

- **High Priority**: 2-3 days
- **Medium Priority**: 3-4 days
- **Total Full Migration**: 5-7 days

## Conclusion

While the current 98% migration is functional, completing the remaining endpoints would provide:

- Complete type safety across the entire application
- Removal of ~40 REST endpoint files
- Consistent API patterns
- Better maintainability

The remaining work is mostly adding procedures to existing routers rather than creating new infrastructure.
