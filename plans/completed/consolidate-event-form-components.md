# Plan: Consolidate EventForm and ToolActionSection Components

**STATUS: COMPLETED**

## Overview

Consolidate multiple versions of EventForm and ToolActionSection into single, flexible components that can handle all use cases (new event, edit event page, edit event modal, edit event tab).

**Completion Date**: 2025-07-08
**Result**: Successfully consolidated all EventForm variants into a single unified EventForm component. ImprovedEventForm and ImprovedToolActionSection have been deleted.

## Current State Analysis (Historical - Pre-Consolidation)

### EventForm Variants

1. **EventForm** (`/src/components/event-form/EventForm.tsx`)
   - Used in: event edit modal, edit event page
   - Features: Basic event form functionality
2. **ImprovedEventForm** (`/src/components/event-form/ImprovedEventForm.tsx`)
   - Used in: new event page, event edit tab
   - Features: Enhanced UI, better state management

### ToolActionSection Variants

1. **ToolActionSection** (`/src/components/event-form/ToolActionSection.tsx`)
   - Used by: EventForm
2. **ImprovedToolActionSection** (`/src/components/event-form/ImprovedToolActionSection.tsx`)
   - Used by: ImprovedEventForm

### Usage Locations

- `/src/app/[lang]/dashboard/events/new/page.tsx` - Uses ImprovedEventForm
- `/src/app/[lang]/dashboard/events/[id]/edit/page.tsx` - Uses EventForm
- `/src/components/ui/event-edit-modal.tsx` - Uses EventForm
- `/src/components/event-details/EventEditTab.tsx` - Uses ImprovedEventForm

## Migration Strategy (Completed)

### Phase 1: Analysis and Feature Comparison ✓

#### EventForm Differences

**Core Architecture:**

- **EventForm**: Traditional React state with useState for each field
- **ImprovedEventForm**: React Hook Form with Zod validation (better choice as base)

**Key Features to Preserve:**

- Keyboard shortcuts (Ctrl+S) from EventForm
- React Hook Form + Zod validation from ImprovedEventForm
- Error handling from both (inline + toast notifications)

#### ToolActionSection Differences

**UI/UX Approach:**

- **ToolActionSection**: Dropdown-based with template support
- **ImprovedToolActionSection**: Card-based grid with search/filter (better UX)

**Key Features to Preserve:**

- Template functionality from ToolActionSection
- Visual card-based selection from ImprovedToolActionSection
- Live action previews from ImprovedToolActionSection
- Search and category filtering from ImprovedToolActionSection

#### Migration Considerations

1. **Base Components**: Use Improved versions as base (modern architecture)
2. **Missing Features**: Add keyboard shortcuts and template support
3. **Layout Flexibility**: Add props to support modal/page/embedded contexts

### Phase 2: Design Unified Components

#### EventForm Design

```typescript
interface EventFormProps {
  // Core props
  eventId?: string; // undefined for new events
  defaultValues?: Partial<Event>;

  // Layout/context props
  layout?: "page" | "modal" | "embedded";
  mode?: "create" | "edit";

  // Behavior props
  onSuccess?: (event: Event) => void;
  onCancel?: () => void;
  showHeader?: boolean;
  showFooter?: boolean;

  // Feature flags
  enableAutosave?: boolean;
  enableDrafts?: boolean;
}
```

#### ToolActionSection Design

```typescript
interface ToolActionSectionProps {
  // Core props
  value?: ToolActionConfig;
  onChange: (config: ToolActionConfig | undefined) => void;

  // Context props
  eventType: EventType;
  disabled?: boolean;

  // UI customization
  compact?: boolean;
  showHelp?: boolean;
}
```

### Phase 3: Implementation Steps

1. **Create new unified EventForm**
   - Start with ImprovedEventForm as base (newer, more features)
   - Add layout prop to handle different contexts
   - Add mode prop for create/edit behavior
   - Implement responsive design for modal/page/embedded layouts
   - Ensure all existing features from both versions are supported

2. **Create new unified ToolActionSection**
   - Start with ImprovedToolActionSection as base
   - Add compact mode for modal/embedded contexts
   - Ensure consistent behavior across all contexts

3. **Add compatibility layer**
   - Create temporary wrapper components with old names
   - Map old props to new props
   - Add deprecation warnings

4. **Update usage locations incrementally**
   - Update new event page first (already uses improved version)
   - Update event edit tab (already uses improved version)
   - Update edit event page (requires migration from old version)
   - Update event edit modal (requires migration from old version)

5. **Remove old components and wrappers**
   - Delete original EventForm and ImprovedEventForm
   - Delete original ToolActionSection and ImprovedToolActionSection
   - Remove compatibility wrappers

### Phase 4: Testing and Validation

1. **Test all usage contexts**
   - New event creation
   - Event editing (page)
   - Event editing (modal)
   - Event editing (tab)

2. **Test all event types**
   - Bash scripts
   - Node.js scripts
   - Python scripts
   - HTTP requests
   - Tool actions

3. **Test edge cases**
   - Form validation
   - Error handling
   - Loading states
   - Permission checks

### Phase 5: Documentation and Cleanup

1. **Update documentation**
   - Component API documentation
   - Usage examples
   - Migration guide for any external consumers

2. **Clean up**
   - Remove old component files
   - Update imports throughout codebase
   - Update tests
   - Update Storybook stories (if any)

## Implementation Order (Completed)

1. **Week 1: Analysis and Design**
   - Complete feature comparison
   - Finalize unified component designs
   - Create implementation plan with specific tasks

2. **Week 2: Core Implementation**
   - Implement unified EventForm with layout support
   - Implement unified ToolActionSection
   - Create compatibility wrappers

3. **Week 3: Migration**
   - Migrate all usage locations
   - Update tests
   - Fix any issues discovered during migration

4. **Week 4: Cleanup and Documentation**
   - Remove old components
   - Update documentation
   - Performance optimization
   - Final testing

## Success Criteria

1. **Single EventForm component** handles all use cases
2. **Single ToolActionSection component** works in all contexts
3. **No regression** in functionality
4. **Improved maintainability** - single source of truth
5. **Consistent UX** across all event form contexts
6. **Clean codebase** - no duplicate components

## Risks and Mitigation

1. **Risk**: Breaking existing functionality
   - **Mitigation**: Comprehensive testing, gradual migration with compatibility layer

2. **Risk**: Performance regression
   - **Mitigation**: Profile before/after, optimize as needed

3. **Risk**: UX inconsistency
   - **Mitigation**: Design review, user testing

4. **Risk**: Complex state management
   - **Mitigation**: Use proven patterns from ImprovedEventForm

## Completed Implementation

1. ✓ Feature comparison completed
2. ✓ Unified EventForm created based on ImprovedEventForm architecture
3. ✓ All usage locations migrated to unified component
4. ✓ ImprovedEventForm and ImprovedToolActionSection deleted
5. ✓ Template functionality restored to ToolActionSection

## Implementation Checklist

### Phase 1: Preparation

- [x] Create feature compatibility matrix
- [x] Document all props and behaviors needed
- [x] Design unified API that supports all use cases

### Phase 2: EventForm Consolidation

- [x] Copy ImprovedEventForm to EventForm (backup original)
- [x] Add layout prop ('page' | 'modal' | 'embedded')
- [x] Add keyboard shortcut support (Ctrl+S)
- [x] Add conditional styling based on layout
- [x] Test in all contexts

### Phase 3: ToolActionSection Consolidation

- [x] Copy ImprovedToolActionSection to ToolActionSection (backup original)
- [x] Add template support from original
- [x] Add compact mode for modal/embedded
- [x] Ensure consistent behavior
- [x] Test with all tool types

### Phase 4: Migration

- [x] Update new event page import
- [x] Update edit event page import
- [x] Update event edit modal import
- [x] Update event edit tab import
- [x] Fix any integration issues

### Phase 5: Cleanup

- [x] Remove ImprovedEventForm
- [x] Remove ImprovedToolActionSection
- [x] Update all documentation
- [x] Run full test suite
