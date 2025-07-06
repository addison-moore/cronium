# Conditional Actions Naming Consistency Plan

## Overview

This document outlines the plan to resolve naming inconsistencies between "conditional events" and "conditional actions" throughout the Cronium codebase. Based on comprehensive analysis, the system should consistently use "conditional actions" as the primary terminology.

## Current State Analysis

### Naming Inconsistencies Found

1. **Database Layer**
   - Table name: `conditional_events` (should be `conditional_actions`)
   - Storage methods: `getSuccessEvents()`, `getFailEvents()`, etc. (should be `getSuccessActions()`, etc.)
   - Schema exports: Mixed usage of `conditionalEvents` and `ConditionalAction`

2. **Frontend Components**
   - Component: `ConditionalActionsSection` ✓ (correct)
   - Types: `ConditionalAction` interface ✓ (correct)
   - State variables: `conditionalEvents` in some places (should be `conditionalActions`)
   - Props: Mixed usage of both terms

3. **Documentation**
   - Main doc file: `CONDITIONAL_EVENTS.md` (should be `CONDITIONAL_ACTIONS.md`)
   - Page route: `/docs/conditional-actions/` ✓ (correct)
   - Content: Mixed references to both "events" and "actions"

4. **Backend/API**
   - Field names in API payloads: `onSuccessEvents`, `onFailEvents` (should be `onSuccessActions`, etc.)
   - tRPC router methods: Mixed terminology
   - Handler functions: `handleSuccessEvents()` (should be `handleSuccessActions()`)

5. **Type System**
   - Enum: `ConditionalActionType` ✓ (correct)
   - Schema: `conditionalEventSchema` (should be `conditionalActionSchema`)
   - Type exports: Mixed usage

## Rationale for "Conditional Actions"

1. **Clarity**: "Actions" better describes what these entities do - they perform actions (send messages, trigger scripts) based on conditions
2. **Consistency**: The enum is already `ConditionalActionType` with action types like `SEND_MESSAGE` and `SCRIPT`
3. **User Understanding**: UI already uses "Conditional Actions" which is more intuitive
4. **Avoiding Confusion**: Using "events" for both the main Events and their conditional behaviors is confusing

## Migration Plan

### Phase 1: Database Schema Migration

1. Create migration to rename table from `conditional_events` to `conditional_actions`
2. Update all foreign key constraints
3. Update indexes if any
4. Test migration in development environment

### Phase 2: Backend Code Updates

1. **Storage Layer** (`src/server/storage.ts`)
   - Rename all methods: `getSuccessEvents` → `getSuccessActions`
   - Update import statements
   - Update query references

2. **Schema File** (`src/shared/schema.ts`)
   - Rename `conditionalEvents` → `conditionalActions`
   - Update `conditionalEventsRelations` → `conditionalActionsRelations`
   - Update type exports

3. **Event Handlers** (`src/lib/scheduler/event-handlers.ts`)
   - Rename functions: `handleSuccessEvents` → `handleSuccessActions`
   - Update parameter names and internal references

4. **API Routes**
   - Update field names in API schemas
   - Change `onSuccessEvents` → `onSuccessActions`
   - Update validation schemas

### Phase 3: Frontend Updates

1. **Component Updates**
   - Update state variable names
   - Update prop names
   - Ensure consistent usage of `conditionalActions`

2. **Type Definitions**
   - Update all type imports and exports
   - Rename `conditionalEventSchema` → `conditionalActionSchema`

3. **Form Submissions**
   - Update payload field names
   - Update form data transformation logic

### Phase 4: Documentation Updates

1. Rename `CONDITIONAL_EVENTS.md` → `CONDITIONAL_ACTIONS.md`
2. Update all references within documentation
3. Update CLAUDE.md to reference the new documentation
4. Update changelog with migration notes

### Phase 5: Testing & Validation

1. Run all existing tests
2. Add migration tests
3. Manual testing of all conditional action workflows
4. Verify no broken references

## Implementation Checklist

### Database Changes

- [ ] Create database migration script
- [ ] Test migration on development database
- [ ] Update SQL dump files

### Backend Changes

- [ ] Update `src/shared/schema.ts`
- [ ] Update `src/server/storage.ts`
- [ ] Update `src/lib/scheduler/event-handlers.ts`
- [ ] Update `src/lib/scheduler/scheduler.ts`
- [ ] Update API route schemas
- [ ] Update tRPC routers
- [ ] Update type definitions

### Frontend Changes

- [ ] Update EventForm component
- [ ] Update ConditionalActionsSection (if needed)
- [ ] Update dashboard components
- [ ] Update event details components
- [ ] Update all type imports

### Documentation Changes

- [ ] Rename documentation file
- [ ] Update all documentation content
- [ ] Update code comments
- [ ] Update CLAUDE.md references

### Testing

- [ ] Run unit tests
- [ ] Run integration tests
- [ ] Manual testing of conditional actions
- [ ] Test database migration rollback

## Risk Mitigation

1. **Database Migration Risks**
   - Keep old table name as alias temporarily
   - Ensure rollback capability
   - Test thoroughly in staging

2. **API Compatibility**
   - Consider supporting both field names temporarily
   - Add deprecation warnings for old field names
   - Document breaking changes clearly

3. **Code Dependencies**
   - Use IDE refactoring tools where possible
   - Search for string references that might be missed
   - Review all import statements

## Timeline Estimate

- Phase 1 (Database): 2-3 hours
- Phase 2 (Backend): 3-4 hours
- Phase 3 (Frontend): 2-3 hours
- Phase 4 (Documentation): 1 hour
- Phase 5 (Testing): 2-3 hours

**Total Estimated Time**: 10-14 hours

## Success Criteria

1. All references to "conditional events" are replaced with "conditional actions"
2. Database table and schema are renamed
3. All tests pass
4. No functionality is broken
5. Documentation is updated and consistent
6. Code is more maintainable and less confusing

## Notes

- This change is primarily a refactoring effort with no functional changes
- Special attention needed for database migration to avoid data loss
- Consider creating a feature flag to enable gradual rollout if needed
