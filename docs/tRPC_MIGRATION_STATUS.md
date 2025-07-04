# tRPC Migration Status

## Overview

This document tracks the status of migrating components from Next.js API routes to tRPC.

## 1. Components Already Migrated (Have -trpc versions)

These components have been successfully migrated and their -trpc versions should be used:

### Pages

- `/dashboard/admin/page-trpc.tsx`
- `/dashboard/logs/page-trpc.tsx`
- `/dashboard/monitoring/page-trpc.tsx`
- `/dashboard/servers/page-trpc.tsx`
- `/dashboard/servers/[id]/page-trpc.tsx`

### Components

- `EventDetails-trpc.tsx`
- `EventForm-trpc.tsx`
- `EventsList-trpc.tsx`
- `DashboardStats-trpc.tsx`
- `UserVariablesManager-trpc.tsx`
- `WorkflowList-trpc.tsx`
- `VariablesTab-trpc.tsx`
- `modular-tools-manager-trpc.tsx`
- `email-plugin-trpc.tsx`
- `slack-plugin-trpc.tsx`
- `ServerForm-trpc.tsx`
- `WorkflowExecutionGraph-trpc.tsx`
- `WorkflowExecutionHistory-trpc.tsx`

## 2. Components Still Needing Migration

### High Priority (Core Functionality)

These components are central to the application's core features and should be migrated first:

1. **Event Management**
   - `ConditionalActionsSection.tsx` - Critical for event conditions
   - `EditorSettingsModal.tsx` - Important for code editor configuration
   - `EventDetailsTab.tsx` - Core event information display
   - `EventEditTab.tsx` - Essential for event editing
   - `ResetCounterSwitch.tsx` - Important for event counter management

2. **Workflow Management**
   - `WorkflowDetailsForm.tsx` - Critical for workflow configuration
   - `WorkflowForm.tsx` - Essential for workflow creation/editing
   - `WorkflowsCard.tsx` - Shows workflow relationships

3. **API & Authentication**
   - `ApiTokensManager.tsx` - Security-critical component
   - `AIScriptAssistant.tsx` - AI integration feature

### Medium Priority (Important Features)

These components provide important functionality but are not critical path:

1. **Server Management**
   - `ServerEventsList.tsx` - Shows events for specific servers

2. **Import/Export**
   - `JsonImportModal.tsx` - Import functionality

3. **Tools & Plugins**
   - `discord-plugin.tsx` - Discord integration (no -trpc version yet)
   - `template-form.tsx` - Template management

4. **UI Components**
   - `event-edit-modal.tsx` - Event editing modal

5. **Service Providers**
   - `ServiceInitializer.tsx` - Initializes services

### Low Priority (Auth Pages)

Auth pages that might benefit from tRPC but are lower priority:

- `/auth/activate/page.tsx`
- `/auth/forgot-password/page.tsx`
- `/auth/reset-password/page.tsx`
- `/auth/signin/page.tsx`

### Pages Still Using API Routes

- `/dashboard/admin/users/[id]/page.tsx`
- `/dashboard/console/page.tsx`
- `/dashboard/logs/[id]/page.tsx`
- `/dashboard/settings/page.tsx`
- `/dashboard/workflows/[id]/edit/page.tsx`
- `/dashboard/workflows/[id]/page.tsx`
- `/dashboard/workflows/new/page.tsx`

## 3. Migration Recommendations

### Immediate Focus (Next Sprint)

1. **ConditionalActionsSection.tsx** - Critical for event functionality
2. **WorkflowDetailsForm.tsx** & **WorkflowForm.tsx** - Complete workflow migration
3. **ApiTokensManager.tsx** - Security-critical

### Follow-up (Subsequent Sprints)

1. Complete remaining event components (EventDetailsTab, EventEditTab, etc.)
2. Migrate discord-plugin.tsx to match other tool plugins
3. Migrate dashboard pages that don't have -trpc versions

### Migration Pattern

When migrating a component:

1. Create a new file with `-trpc.tsx` suffix
2. Replace fetch calls with tRPC hooks
3. Update imports in parent components
4. Test thoroughly before removing old component
5. Update this document

## 4. Completed Migrations Summary

- ✅ 18 components successfully migrated
- ⏳ 20+ components still need migration
- 📊 ~45% migration progress

## Notes

- Some pages have -trpc versions but the original pages are still in use
- Focus should be on components that handle critical business logic
- Auth pages are lower priority as they work well with current implementation
