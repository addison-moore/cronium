# Tool Action Templates Implementation Plan (Revised)

## Executive Summary

This document outlines a simplified implementation plan for Tool Action templates integrated into the Tools Management page. The plan focuses on building core functionality without unnecessary complexity, leveraging existing UI patterns and infrastructure.

## Key Design Decisions

1. **Integration Location**: Templates will be managed in the Templates tab of the Tools Management page (`/dashboard/tools`), not as a separate page
2. **UI Consistency**: Use existing table patterns from events/logs/workflows pages
3. **Tool Icons**: Display tool icons instead of ALL-CAPS tool names
4. **Editor Support**: Use Monaco editor with user's saved settings for JSON/HTML fields
5. **Template Variables**: Support all existing cronium context variables from the previous template system
6. **Minimal Features**: No marketplace, analytics, AI suggestions, or other complex features

## Implementation Plan

### Phase 1: UI Updates to Tools Management Page (1 day)

#### 1.1 Update Templates Tab Structure

- **Location**: `/src/components/tools/modular-tools-manager.tsx`
- Replace existing deprecated templates tab content with new structure:

  ```
  [Tool Action Type Dropdown] [+ New Template]

  [Template Form (when adding/editing)]

  [Templates Table]
  ```

#### 1.2 Template List Component

- Create a table-based list matching styling from other pages
- Columns: Icon, Template Name, Action Type, Description, Created, Actions (Edit/Delete)
- Filter templates by selected tool action type
- Show empty state with appropriate messaging

#### 1.3 Template Form Integration

- Show form inline when creating/editing templates
- Form appears above the table when active
- Pre-populate form when editing existing template

### Phase 2: Template Form Component (1-2 days)

#### 2.1 Create Dynamic Template Form

- **Location**: `/src/components/tools/templates/ToolActionTemplateForm.tsx`
- Fields:
  - Template Name (required)
  - Description (optional)
  - Tool Type (auto-selected based on current tool)
  - Action Type (dropdown of available actions)
  - Dynamic parameter fields based on selected action

#### 2.2 Dynamic Field Rendering

- Reuse logic from `ActionParameterForm.tsx`
- Render different input types based on action schema:
  - Text inputs for simple strings
  - Textarea for longer text
  - Monaco editor for JSON/HTML with syntax highlighting
  - Select dropdowns for enums
- Apply user's saved Monaco editor settings (theme, etc.)

#### 2.3 Template Variable Support

- Add variable insertion UI (button/dropdown)
- Support all cronium context variables:
  - `{{cronium.event.*}}` - Event data
  - `{{cronium.getVariables.*}}` - User variables
  - `{{cronium.input.*}}` - Workflow input data
  - `{{cronium.getCondition.*}}` - Conditional flags
- Include Handlebars helpers: `get`, `ifEquals`, `formatDuration`, `formatTime`, `json`, `lookup`

### Phase 3: Backend Integration (1 day)

#### 3.1 Update Template Storage

- Use existing `toolActionTemplates` table and tRPC routes
- Ensure proper filtering by tool type and action ID
- Maintain system vs user template separation

#### 3.2 Template Selection in Event Form

- Update `ToolActionSection.tsx` to show template dropdown
- Only show templates matching selected tool and action
- Apply template parameters when selected
- Show brief alert confirming template application

### Phase 4: Tool Action Enhancements (1 day)

#### 4.1 Update Tool Plugin Display

- Ensure all tool plugins use proper icons (not ALL-CAPS names)
- Update badge styling to match design system
- Fix any inconsistent naming/casing issues

#### 4.2 Action Type Organization

- Group templates by action type in dropdown
- Show action type badges consistently
- Ensure action descriptions are clear and helpful

## Technical Implementation Details

### Component Structure

```
modular-tools-manager.tsx
├── Templates Tab
│   ├── Action Type Filter Dropdown
│   ├── New Template Button
│   ├── ToolActionTemplateForm (inline when active)
│   └── Templates Table
│       ├── Tool Icon
│       ├── Template Name
│       ├── Action Type
│       ├── Description
│       └── Actions (Edit/Delete)
```

### State Management

- Use existing tRPC hooks for data fetching
- Local state for:
  - Selected action type filter
  - Active template being edited
  - Form visibility
- Invalidate queries after mutations

### Monaco Editor Integration

```typescript
// Load user's saved editor settings
const editorSettings = useEditorSettings();

// Apply to Monaco instances
<MonacoEditor
  language={field.format === 'json' ? 'json' : 'html'}
  theme={editorSettings.theme}
  options={{
    fontSize: editorSettings.fontSize,
    wordWrap: editorSettings.wordWrap,
    // ... other user preferences
  }}
/>
```

### Template Variable Insertion

```typescript
// Variable insertion helper
const insertVariable = (variable: string) => {
  const currentValue = form.getValues(fieldName);
  const cursorPosition = editorRef.current?.getPosition();
  // Insert {{variable}} at cursor position
};

// Available variables dropdown
const templateVariables = [
  { group: "Event", variables: ["id", "name", "status", "duration", "output"] },
  { group: "Variables", variables: getAvailableVariables() },
  { group: "Input", variables: ["*"] },
  { group: "Conditions", variables: getAvailableConditions() },
];
```

## Migration Considerations

1. **Existing Templates**: Current templates in the system should continue to work
2. **Deprecated Code**: Remove old template UI components after migration
3. **Documentation**: Update templates documentation page to reflect new system

## Success Criteria

1. ✅ Templates manageable from Tools page management tab
2. ✅ Consistent UI with other pages (tables, forms, styling)
3. ✅ Tool icons displayed instead of ALL-CAPS names
4. ✅ Monaco editor with user settings for JSON/HTML fields
5. ✅ All cronium template variables supported
6. ✅ Templates selectable in event form
7. ✅ No unnecessary complex features

## Timeline

- **Phase 1**: 1 day - UI updates to tools management page
- **Phase 2**: 1-2 days - Template form component
- **Phase 3**: 1 day - Backend integration
- **Phase 4**: 1 day - Tool action enhancements

**Total**: 4-5 days

## Out of Scope

The following features are explicitly excluded to maintain simplicity:

- Template marketplace
- Usage analytics
- AI-powered template suggestions
- Visual template builder
- Template documentation generator
- Complex versioning system
- Import/export functionality (beyond basic CRUD)
