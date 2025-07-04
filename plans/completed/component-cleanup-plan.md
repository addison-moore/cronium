# Component Architecture Cleanup Plan

## Overview

This document outlines the systematic cleanup of redundant REST components and normalization of tRPC component naming conventions.

## Current State

- ✅ **Live Application**: All tRPC components functional (100% complete)
- ❌ **Codebase**: Contains 29 redundant REST components
- ❌ **Naming**: Function exports contain "TRPC" suffixes
- ❌ **Imports**: Component imports reference "-trpc" suffixes

## Cleanup Strategy

### Phase 11a: Create Backup Directory ✅ COMPLETED

```bash
mkdir -p backups/rest-components
```

### Phase 11b: Component Migration List

#### Dashboard Components (6 total)

1. `AIScriptAssistant.tsx` → backup → `AIScriptAssistant-trpc.tsx` → `AIScriptAssistant.tsx`
2. `ApiTokensManager.tsx` → backup → `ApiTokensManager-trpc.tsx` → `ApiTokensManager.tsx`
3. `DashboardStats.tsx` → backup → `DashboardStats-trpc.tsx` → `DashboardStats.tsx`
4. `EventsList.tsx` → backup → `EventsList-trpc.tsx` → `EventsList.tsx`
5. `ServerForm.tsx` → backup → `ServerForm-trpc.tsx` → `ServerForm.tsx`
6. `UserVariablesManager.tsx` → backup → `UserVariablesManager-trpc.tsx` → `UserVariablesManager.tsx`

#### Event Components (7 total)

7. `EventDetails.tsx` → backup → `EventDetails-trpc.tsx` → `EventDetails.tsx`
8. `EventDetailsTab.tsx` → backup → `EventDetailsTab-trpc.tsx` → `EventDetailsTab.tsx`
9. `EventEditTab.tsx` → backup → `EventEditTab-trpc.tsx` → `EventEditTab.tsx`
10. `ResetCounterSwitch.tsx` → backup → `ResetCounterSwitch-trpc.tsx` → `ResetCounterSwitch.tsx`
11. `WorkflowsCard.tsx` → backup → `WorkflowsCard-trpc.tsx` → `WorkflowsCard.tsx`
12. `ConditionalActionsSection.tsx` → backup → `ConditionalActionsSection-trpc.tsx` → `ConditionalActionsSection.tsx`
13. `EditorSettingsModal.tsx` → backup → `EditorSettingsModal-trpc.tsx` → `EditorSettingsModal.tsx`
14. `EventForm.tsx` → backup → `EventForm-trpc.tsx` → `EventForm.tsx`

#### Workflow Components (5 total)

15. `WorkflowDetailsForm.tsx` → backup → `WorkflowDetailsForm-trpc.tsx` → `WorkflowDetailsForm.tsx`
16. `WorkflowExecutionGraph.tsx` → backup → `WorkflowExecutionGraph-trpc.tsx` → `WorkflowExecutionGraph.tsx`
17. `WorkflowExecutionHistory.tsx` → backup → `WorkflowExecutionHistory-trpc.tsx` → `WorkflowExecutionHistory.tsx`
18. `WorkflowForm.tsx` → backup → `WorkflowForm-trpc.tsx` → `WorkflowForm.tsx`
19. `WorkflowList.tsx` → backup → `WorkflowList-trpc.tsx` → `WorkflowList.tsx`

#### Tools & Admin Components (4 total)

20. `modular-tools-manager.tsx` → backup → `modular-tools-manager-trpc.tsx` → `modular-tools-manager.tsx`
21. `email-plugin.tsx` → backup → `email-plugin-trpc.tsx` → `email-plugin.tsx`
22. `slack-plugin.tsx` → backup → `slack-plugin-trpc.tsx` → `slack-plugin.tsx`
23. `VariablesTab.tsx` → backup → `VariablesTab-trpc.tsx` → `VariablesTab.tsx`

### Phase 11c: Function Export Name Changes

#### Export Function Renames Needed

1. `EventsListTrpc()` → `EventsList()`
2. `DashboardStatsTRPC()` → `DashboardStats()`
3. `AdminPageTRPC()` → `AdminPage()`
4. `APITokensManagerTRPC()` → `ApiTokensManager()`
5. `AIScriptAssistantTRPC()` → `AIScriptAssistant()`
6. `ServerFormTRPC()` → `ServerForm()`
7. `UserVariablesManagerTRPC()` → `UserVariablesManager()`
8. `EventDetailsTabTRPC()` → `EventDetailsTab()`
9. `EventEditTabTRPC()` → `EventEditTab()`
10. `ResetCounterSwitchTRPC()` → `ResetCounterSwitch()`
11. `WorkflowsCardTRPC()` → `WorkflowsCard()`
12. `ConditionalActionsSectionTRPC()` → `ConditionalActionsSection()`
13. `EditorSettingsModalTRPC()` → `EditorSettingsModal()`
14. `WorkflowDetailsFormTRPC()` → `WorkflowDetailsForm()`
15. `WorkflowExecutionGraphTRPC()` → `WorkflowExecutionGraph()`
16. `WorkflowExecutionHistoryTRPC()` → `WorkflowExecutionHistory()`
17. `WorkflowFormTRPC()` → `WorkflowForm()`
18. `WorkflowListTrpc()` → `WorkflowList()`
19. `ModularToolsManagerTrpc()` → `ModularToolsManager()`
20. `VariablesTabTRPC()` → `VariablesTab()`
21. `ServerDetailsPageTRPC()` → `ServerDetailsPage()`
22. `LogsPageTRPC()` → `LogsPage()`

### Phase 11d: Import Reference Updates

#### Files with imports to update (18 files)

1. `src/app/[lang]/dashboard/page.tsx` (1 import)
2. `src/app/[lang]/dashboard/events/page.tsx` (1 import)
3. `src/app/[lang]/dashboard/events/[id]/page.tsx` (1 import)
4. `src/app/[lang]/dashboard/events/new/page.tsx` (1 import)
5. `src/app/[lang]/dashboard/events/[id]/edit/page.tsx` (1 import)
6. `src/app/[lang]/dashboard/logs/page.tsx` (1 import)
7. `src/app/[lang]/dashboard/workflows/page.tsx` (1 import)
8. `src/app/[lang]/dashboard/workflows/[id]/page.tsx` (3 imports)
9. `src/app/[lang]/dashboard/workflows/new/page.tsx` (1 import)
10. `src/app/[lang]/dashboard/settings/page.tsx` (3 imports)
11. `src/components/event-details/EventEditTab.tsx` (1 import)
12. `src/components/event-form/EventForm-trpc.tsx` (2 imports)
13. Plus 6 test files

## Implementation Commands

### Backup REST Components

```bash
# Dashboard components
cp src/components/dashboard/AIScriptAssistant.tsx backups/rest-components/AIScriptAssistant.tsx
cp src/components/dashboard/ApiTokensManager.tsx backups/rest-components/ApiTokensManager.tsx
cp src/components/dashboard/DashboardStats.tsx backups/rest-components/DashboardStats.tsx
cp src/components/dashboard/EventsList.tsx backups/rest-components/EventsList.tsx
cp src/components/dashboard/ServerForm.tsx backups/rest-components/ServerForm.tsx
cp src/components/dashboard/UserVariablesManager.tsx backups/rest-components/UserVariablesManager.tsx

# Event components
cp src/components/event-details/EventDetails.tsx backups/rest-components/EventDetails.tsx
cp src/components/event-details/EventDetailsTab.tsx backups/rest-components/EventDetailsTab.tsx
cp src/components/event-details/EventEditTab.tsx backups/rest-components/EventEditTab.tsx
cp src/components/event-details/ResetCounterSwitch.tsx backups/rest-components/ResetCounterSwitch.tsx
cp src/components/event-details/WorkflowsCard.tsx backups/rest-components/WorkflowsCard.tsx
cp src/components/event-form/ConditionalActionsSection.tsx backups/rest-components/ConditionalActionsSection.tsx
cp src/components/event-form/EditorSettingsModal.tsx backups/rest-components/EditorSettingsModal.tsx
cp src/components/event-form/EventForm.tsx backups/rest-components/EventForm.tsx

# Workflow components
cp src/components/workflows/WorkflowDetailsForm.tsx backups/rest-components/WorkflowDetailsForm.tsx
cp src/components/workflows/WorkflowExecutionGraph.tsx backups/rest-components/WorkflowExecutionGraph.tsx
cp src/components/workflows/WorkflowExecutionHistory.tsx backups/rest-components/WorkflowExecutionHistory.tsx
cp src/components/workflows/WorkflowForm.tsx backups/rest-components/WorkflowForm.tsx
cp src/components/workflows/WorkflowList.tsx backups/rest-components/WorkflowList.tsx

# Tools & Admin components
cp src/components/tools/modular-tools-manager.tsx backups/rest-components/modular-tools-manager.tsx
cp src/components/tools/plugins/email/email-plugin.tsx backups/rest-components/email-plugin.tsx
cp src/components/tools/plugins/slack/slack-plugin.tsx backups/rest-components/slack-plugin.tsx
cp src/components/admin/VariablesTab.tsx backups/rest-components/VariablesTab.tsx
```

### Replace with tRPC Components

```bash
# Dashboard components
mv src/components/dashboard/AIScriptAssistant-trpc.tsx src/components/dashboard/AIScriptAssistant.tsx
mv src/components/dashboard/ApiTokensManager-trpc.tsx src/components/dashboard/ApiTokensManager.tsx
mv src/components/dashboard/DashboardStats-trpc.tsx src/components/dashboard/DashboardStats.tsx
mv src/components/dashboard/EventsList-trpc.tsx src/components/dashboard/EventsList.tsx
mv src/components/dashboard/ServerForm-trpc.tsx src/components/dashboard/ServerForm.tsx
mv src/components/dashboard/UserVariablesManager-trpc.tsx src/components/dashboard/UserVariablesManager.tsx

# Event components
mv src/components/event-details/EventDetails-trpc.tsx src/components/event-details/EventDetails.tsx
mv src/components/event-details/EventDetailsTab-trpc.tsx src/components/event-details/EventDetailsTab.tsx
mv src/components/event-details/EventEditTab-trpc.tsx src/components/event-details/EventEditTab.tsx
mv src/components/event-details/ResetCounterSwitch-trpc.tsx src/components/event-details/ResetCounterSwitch.tsx
mv src/components/event-details/WorkflowsCard-trpc.tsx src/components/event-details/WorkflowsCard.tsx
mv src/components/event-form/ConditionalActionsSection-trpc.tsx src/components/event-form/ConditionalActionsSection.tsx
mv src/components/event-form/EditorSettingsModal-trpc.tsx src/components/event-form/EditorSettingsModal.tsx
mv src/components/event-form/EventForm-trpc.tsx src/components/event-form/EventForm.tsx

# Workflow components
mv src/components/workflows/WorkflowDetailsForm-trpc.tsx src/components/workflows/WorkflowDetailsForm.tsx
mv src/components/workflows/WorkflowExecutionGraph-trpc.tsx src/components/workflows/WorkflowExecutionGraph.tsx
mv src/components/workflows/WorkflowExecutionHistory-trpc.tsx src/components/workflows/WorkflowExecutionHistory.tsx
mv src/components/workflows/WorkflowForm-trpc.tsx src/components/workflows/WorkflowForm.tsx
mv src/components/workflows/WorkflowList-trpc.tsx src/components/workflows/WorkflowList.tsx

# Tools & Admin components
mv src/components/tools/modular-tools-manager-trpc.tsx src/components/tools/modular-tools-manager.tsx
mv src/components/tools/plugins/email/email-plugin-trpc.tsx src/components/tools/plugins/email/email-plugin.tsx
mv src/components/tools/plugins/slack/slack-plugin-trpc.tsx src/components/tools/plugins/slack/slack-plugin.tsx
mv src/components/admin/VariablesTab-trpc.tsx src/components/admin/VariablesTab.tsx
```

## Risk Mitigation

- Complete backup of all original REST components
- Git branch for rollback capability
- Systematic validation after each phase
- Full build testing before completion

## Success Criteria

- ✅ All redundant REST components removed
- ✅ All tRPC components renamed without "-trpc" suffix
- ✅ All function exports cleaned of "TRPC" naming
- ✅ All imports updated to reference clean component names
- ✅ Full application functionality preserved
- ✅ Clean build with zero TypeScript errors
