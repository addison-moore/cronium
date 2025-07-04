# TypeScript Error Resolution Plan

## Overview
This document outlines a systematic approach to resolving 102 TypeScript errors across the codebase. The errors have been categorized and organized into phases for manageable execution.

## Error Summary
- **Total Errors**: 102
- **Files Affected**: 31
- **Main Categories**: 
  - exactOptionalPropertyTypes compatibility (31 errors)
  - Data structure/property access issues (15 errors)
  - Null/undefined handling (20 errors)
  - Type annotations and implicit any (11 errors)
  - Component prop mismatches (10 errors)
  - tRPC type errors (7 errors)
  - Other misc errors (8 errors)

## Phase 1: Critical Type Definition Fixes
**Priority**: High  
**Estimated Impact**: ~25 errors

### Checklist:
- [x] Fix WorkflowTriggerType.SCHEDULED vs SCHEDULE enum inconsistency
  - Files: WorkflowDetailsForm.tsx, WorkflowForm.tsx (4 occurrences)
- [x] Add missing `createEvent` method to IStorage interface
  - File: src/app/api/events/[id]/route-new.ts (2 occurrences)
- [x] Fix duplicate ApiResponse type definitions
  - File: src/lib/advanced-types.ts (2 occurrences)
- [x] Update workflow execution history data structure
  - File: WorkflowExecutionHistory.tsx (8 errors - executions property access)
- [x] Fix tRPC router query parameter mismatches
  - Files: WorkflowsCard.tsx, WorkflowForm.tsx (3 occurrences)

## Phase 2: exactOptionalPropertyTypes Compatibility
**Priority**: High  
**Estimated Impact**: ~31 errors

### Checklist:
- [x] Update type definitions to explicitly include undefined in union types
- [x] Fix Switch component checked prop types
  - File: template-form.tsx
- [x] Fix EventDetailsPopover prop types
  - Files: event-details-popover.tsx, EventNode.tsx
- [x] Fix toast action types
  - File: use-toast.tsx
- [x] Fix Discord plugin validation return type
  - File: discord-plugin.tsx
- [x] Update script execution result types
  - Files: execute-script.ts, local-executor.ts, script-executor.ts
- [x] Fix event handler metadata types
  - File: event-handlers.ts

## Phase 3: Null/Undefined Handling
**Priority**: Medium  
**Estimated Impact**: ~20 errors

### Checklist:
- [x] Fix auth.ts null/undefined assignments (5 occurrences)
- [x] Fix SSH connection client assignments
  - File: ssh.ts (6 occurrences)
- [x] Fix encryption service optional chaining
  - Files: encryption-service.ts, useClientEncryption.ts
- [x] Fix seed script undefined checks
  - Files: seed-events.ts, seed-roles.ts, seed-workflows.ts (18 occurrences)
- [x] Fix template processor string parameter handling
  - File: template-processor.ts

## Phase 4: Component Props and Type Annotations
**Priority**: Medium  
**Estimated Impact**: ~21 errors

### Checklist:
- [x] Fix ServerForm sshKey prop type (undefined to string)
  - File: ServerForm.tsx
- [x] Fix WorkflowForm component prop mismatches
  - TabsTrigger children props
  - TagsInput onValueChange prop
  - WorkflowCanvas events prop
- [x] Add explicit type annotations for implicit any parameters
  - Files: WorkflowsCard.tsx, WorkflowExecutionHistory.tsx, WorkflowList.tsx, use-toast.tsx
- [x] Fix WorkflowList type assertions and array methods
  - Property access on workflow tags
- [x] Fix Terminal component return type
  - File: Terminal.tsx

## Phase 5: Data Structure and API Integration
**Priority**: Medium  
**Estimated Impact**: ~15 errors

### Checklist:
- [x] Fix WorkflowList data structure (lastRunAt property)
  - File: WorkflowList.tsx
- [x] Fix IntegrationTestPanel API call structure
  - File: IntegrationTestPanel.tsx
- [x] Fix events-table async handler type
  - File: events-table.tsx
- [x] Fix ResetCounterSwitch unknown property
  - File: ResetCounterSwitch.tsx
- [x] Fix WorkflowCanvas node state type
  - File: WorkflowCanvas.tsx

## Phase 6: Core Library Integration
**Priority**: Low  
**Estimated Impact**: ~10 errors

### Checklist:
- [x] Fix tRPC client configuration (missing transformer)
  - File: trpc.ts
- [x] Fix clear-all-logs script type conversions
  - File: clear-all-logs.ts (6 occurrences)
- [x] Fix AI service optional property access
  - File: ai.ts
- [x] Fix useOptimisticUpdate generic type constraint
  - File: useOptimisticUpdate.ts

## Phase 7: Final Validation and Cleanup
**Priority**: High  
**Estimated Impact**: Verification only

### Checklist:
- [x] Run full TypeScript compilation check
- [x] Document any remaining complex type issues (None remaining)
- [x] Update type safety guidelines if needed (Not needed)
- [x] Create follow-up tasks for architectural improvements (Not needed)
- [x] Update CLAUDE.md with any new type checking commands (Already documented)

## Execution Notes

### Commands to Run
```bash
# Check current errors
npx tsc --noEmit

# Check specific file
npx tsc --noEmit --skipLibCheck src/path/to/file.ts

# Run after each phase
pnpm lint
```

### Key Patterns to Apply

1. **For exactOptionalPropertyTypes errors**:
   ```typescript
   // Before
   type Props = { value?: string }
   // After  
   type Props = { value?: string | undefined }
   ```

2. **For null/undefined assignments**:
   ```typescript
   // Before
   let value: string = undefined
   // After
   let value: string | undefined = undefined
   ```

3. **For property access on union types**:
   ```typescript
   // Before
   data.property
   // After
   'property' in data ? data.property : defaultValue
   ```

## Success Criteria
- Zero TypeScript compilation errors
- All tests passing
- No runtime errors introduced
- Type safety maintained or improved

## Risk Mitigation
- Test each phase thoroughly before proceeding
- Keep changes focused and atomic
- Document any type assertions or workarounds
- Consider creating type guard functions for complex unions