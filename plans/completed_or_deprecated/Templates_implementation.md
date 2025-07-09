# Tool Action Templates Implementation Plan

## Executive Summary

This document outlines the implementation plan for a new template system for Tool Actions in Cronium. The plan is divided into 4 phases, with Phase 1 focusing on simplifying existing tool action forms, Phase 2 implementing the core template functionality, Phase 3 creating the UI for template management, and Phase 4 migrating the existing conditional action templates to the new system.

### Phase Overview

1. **Phase 1: Tool Action Form Simplification** (1-2 days)
   - Simplify existing tool action forms to MVP essentials
   - Remove complex optional fields
   - Streamline the ActionParameterForm component

2. **Phase 2: Template System Core Implementation** (2-3 days)
   - Create new database schema for tool action templates
   - Implement template CRUD operations via tRPC
   - Add template selection to tool action forms

3. **Phase 3: Template Management UI** (2-3 days)
   - Create template management page under Tools section
   - Build template creation/editing forms
   - Implement template preview functionality

4. **Phase 4: Migration and Cleanup** (1-2 days)
   - Migrate existing SEND_MESSAGE templates to new system
   - Replace conditional action template system
   - Update documentation and cleanup old code

## Phase 1: Tool Action Form Simplification

### Objective

Reduce complexity of tool action forms to essential fields only, making them easier to template and use.

### Tasks

#### 1.1 Simplify Plugin Action Schemas

- [x] Update Discord plugin to minimal schema
  - [x] `send-message`: Only `content` field (remove embeds, TTS, etc.)
  - [x] Remove `send-embed` action entirely for MVP
  - [x] Keep other actions but simplify parameters
- [x] Update Slack plugin to minimal schema
  - [x] `send-message`: Only `text` and optional `channel`
  - [x] Remove blocks, attachments, thread functionality
  - [x] Simplify other actions similarly
- [x] Update Email plugin to minimal schema
  - [x] `send-email`: Only `to`, `subject`, and `body`
  - [x] Remove CC/BCC, attachments, priority for MVP
- [x] Update other plugins (Teams, Notion, etc.) similarly

#### 1.2 Simplify ActionParameterForm Component

- [x] Remove JSON editor functionality (lines 352-423)
- [x] Remove date picker components (lines 287-349)
- [x] Remove array management UI (lines 664-758)
- [x] Remove smart defaults generation
- [x] Remove collapsible sections for optional fields
- [x] Simplify field rendering to basic inputs only
- [x] Keep only essential field types: text, textarea, select, boolean

#### 1.3 Update Type Definitions

- [x] Create simplified action schemas in each plugin
- [x] Update TypeScript types to reflect simplified schemas
- [x] Ensure backward compatibility with existing events

### Success Criteria

- Tool action forms contain only essential fields
- ActionParameterForm component reduced from 1000+ to ~200 lines
- All existing tool actions still function correctly

## Phase 2: Template System Core Implementation

### Objective

Build the backend infrastructure for tool action templates, enabling storage, retrieval, and application of templates.

### Tasks

#### 2.1 Database Schema Updates

- [x] Create new `tool_action_templates` table:
  ```typescript
  export const toolActionTemplates = pgTable("tool_action_templates", {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 }).references(() => users.id),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    toolType: varchar("tool_type", { length: 50 }).notNull(), // DISCORD, SLACK, etc.
    actionId: varchar("action_id", { length: 100 }).notNull(), // send-message, etc.
    parameters: json("parameters").notNull(), // Stored action parameters
    isSystemTemplate: boolean("is_system_template").default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  });
  ```
- [x] Add indexes for efficient querying
- [x] Create migration script

#### 2.2 tRPC Router Implementation

- [x] Create `toolActionTemplates` router with procedures:
  - [x] `create` - Create new template
  - [x] `update` - Update existing template
  - [x] `delete` - Delete template
  - [x] `getById` - Get single template
  - [x] `getByToolAction` - Get templates for specific tool/action
  - [x] `getUserTemplates` - Get all user templates
  - [x] `getSystemTemplates` - Get system templates
- [x] Add proper authorization checks
- [x] Implement template validation

#### 2.3 Template Processing Integration

- [x] Extend existing `templateProcessor` to handle tool action parameters
- [x] Create `processToolActionTemplate` function
- [x] Ensure Handlebars syntax works with all parameter types
- [x] Handle nested object parameters correctly

#### 2.4 Default System Templates

- [x] Create default templates for common scenarios:
  - [x] Discord: Success/Error notifications
  - [x] Slack: Status updates, alerts
  - [x] Email: Welcome emails, notifications
- [x] Add seeding logic to `template-seeding.ts`

### Success Criteria

- Database schema created and migrated
- tRPC endpoints functional and tested
- Template processing works with Handlebars syntax
- System templates available to all users

## Phase 3: Template Management UI

### Objective

Create user interface for managing tool action templates, including creation, editing, and selection in event forms.

### Tasks

#### 3.1 Template Management Page

- [ ] Create `/dashboard/tools/templates` page
- [ ] Build template list view with:
  - [ ] Table showing template name, tool, action, last updated
  - [ ] Filter by tool type and action
  - [ ] Search functionality
  - [ ] System vs user templates separation
- [ ] Add create/edit/delete actions
- [ ] Implement proper loading states and error handling

#### 3.2 Template Creation/Edit Form

- [ ] Create `ToolActionTemplateForm` component
- [ ] Fields: name, description, tool selection, action selection
- [ ] Dynamic parameter form based on selected action
- [ ] Preview panel showing processed template with sample data
- [ ] Validate template syntax before saving
- [ ] Support for copying/duplicating templates

#### 3.3 Template Selection in Event Form

- [ ] Modify `ToolActionSection` component
- [ ] Add template dropdown after action selection
- [ ] Load available templates based on selected tool/action
- [ ] Apply template parameters to form on selection
- [ ] Show template description as helper text
- [ ] Allow clearing template selection

#### 3.4 Template Preview Component

- [ ] Create `TemplatePreview` component
- [ ] Show rendered template with sample cronium context
- [ ] Highlight template variables
- [ ] Show before/after comparison
- [ ] Real-time preview updates as user types

### Success Criteria

- Template management UI fully functional
- Templates can be created, edited, and deleted
- Templates can be selected and applied in event forms
- Preview functionality helps users understand template behavior

## Phase 4: Migration and Cleanup

### Objective

Migrate existing conditional action templates to the new system and remove old implementation.

### Tasks

#### 4.1 Data Migration

- [ ] Create migration script to convert existing templates
- [ ] Map SEND_MESSAGE templates to new tool action templates
- [ ] Preserve template names and content
- [ ] Handle email subject fields appropriately
- [ ] Test migration with production data copy

#### 4.2 Update Conditional Actions

- [ ] Modify `ConditionalActionsSection` to use new template system
- [ ] Update SEND_MESSAGE action to reference tool action templates
- [ ] Ensure backward compatibility during transition
- [ ] Update any API endpoints that process conditional actions

#### 4.3 Code Cleanup

- [ ] Remove old template selection logic from ConditionalActionsSection
- [ ] Remove template type from old templates table (or drop table)
- [ ] Update template-related tRPC procedures
- [ ] Clean up unused imports and components
- [ ] Update tests to reflect new structure

#### 4.4 Documentation Updates

- [ ] Update user documentation for new template system
- [ ] Add template examples to docs
- [ ] Update API documentation
- [ ] Create migration guide for existing users

### Success Criteria

- All existing templates migrated successfully
- Conditional actions use new template system
- Old code removed without breaking functionality
- Documentation reflects new implementation

## Technical Considerations

### Performance

- Templates cached in memory for frequent access
- Lazy load templates in dropdown to handle large lists
- Index database queries appropriately

### Security

- Validate template syntax to prevent injection
- Sanitize user input in templates
- Respect user permissions for template access

### Backward Compatibility

- Maintain support for events created before templates
- Gradual migration path for existing users
- Feature flag for rollout if needed

## Timeline

- **Phase 1**: 1-2 days (Form simplification)
- **Phase 2**: 2-3 days (Core implementation)
- **Phase 3**: 2-3 days (UI development)
- **Phase 4**: 1-2 days (Migration and cleanup)

**Total**: 6-10 days for complete implementation

## Phase 5: Conditional Actions Template Integration

### Objective

Update the ConditionalActionsSection to use the new tool action templates system with a flag-based approach for identifying send message actions.

### Tasks

#### 5.1 Add Send Message Flag to Tool Actions

- [ ] Add `isConditionalAction?: boolean` flag to ToolAction interface
- [ ] Update Discord `send-message` action to include flag
- [ ] Update Slack `send-message` action to include flag
- [ ] Update Email `send-email` action to include flag
- [ ] Document the flag usage for future tools

#### 5.2 Create Helper Functions

- [ ] Create function to get all conditional actions across tools
- [ ] Create function to filter templates by conditional action flag
- [ ] Create type guard for conditional action templates
- [ ] Update tool registry to support querying by flag

#### 5.3 Update ConditionalActionsSection

- [ ] Remove hardcoded tool type filtering (EMAIL, SLACK, DISCORD)
- [ ] Query all tools that have conditional actions
- [ ] Update template query to use new toolActionTemplates system
- [ ] Remove dependency on old templates table

#### 5.4 Refactor Template Selection

- [ ] Update template dropdown to show tool type and action name
- [ ] Group templates by tool type in the dropdown
- [ ] Show template description in selection
- [ ] Apply template parameters based on tool action schema

#### 5.5 Update Conditional Action Storage

- [ ] Store toolType and actionId with conditional actions
- [ ] Update conditional action execution to use new fields
- [ ] Remove old template ID references
- [ ] Update database schema if needed

### Success Criteria

- Any tool action with isConditionalAction flag can be used
- ConditionalActionsSection is tool-agnostic
- Easy to add new send message actions in the future
- Clean implementation without legacy code

## Phase 6: Clean Implementation and Testing

### Objective

Implement a clean solution without legacy code and ensure comprehensive testing.

### Tasks

#### 6.1 Remove Old Template System

- [ ] Delete old templates table from schema
- [ ] Remove integrations.templates tRPC router
- [ ] Remove old template UI components
- [ ] Clean up unused imports and types
- [ ] Update all template references

#### 6.2 Implement Tool Registry Enhancements

- [ ] Add method to get all conditional actions
- [ ] Add filtering by action flags
- [ ] Create unified action discovery mechanism
- [ ] Document registry methods

#### 6.3 Update Event Execution

- [ ] Update conditional action execution logic
- [ ] Use tool action parameters structure
- [ ] Ensure proper variable substitution
- [ ] Add comprehensive logging

#### 6.4 Comprehensive Testing

- [ ] Test all existing conditional action types
- [ ] Test with new tool types
- [ ] Test template variable substitution
- [ ] Test edge cases and error handling
- [ ] Performance testing

### Success Criteria

- Clean codebase without legacy systems
- All conditional actions working properly
- Easy to add new conditional action types
- Well-documented and tested

## Phase 7: Enhanced Template Features

### Objective

Add advanced features to make templates more powerful and user-friendly.

### Tasks

#### 7.1 Template Versioning

- [ ] Add version tracking to templates
- [ ] Allow reverting to previous versions
- [ ] Show version history in UI
- [ ] Implement change tracking

#### 7.2 Template Sharing

- [ ] Add sharing capabilities for templates
- [ ] Create template visibility settings (private, team, public)
- [ ] Implement template marketplace concept
- [ ] Add usage analytics for shared templates

#### 7.3 Advanced Template Features

- [ ] Add template categories/tags
- [ ] Implement template search with filters
- [ ] Create template import/export functionality
- [ ] Add template validation rules

#### 7.4 Template Builder Improvements

- [ ] Add visual template builder
- [ ] Implement template testing interface
- [ ] Create template documentation generator
- [ ] Add AI-powered template suggestions

### Success Criteria

- Users actively sharing templates
- Improved template discovery
- Reduced time to create new templates
- Higher template reuse rate

## Updated Timeline

- **Phase 1-4**: Completed ✓
- **Phase 5**: 1-2 days (Conditional Actions Integration)
- **Phase 6**: 1-2 days (Clean Implementation)
- **Phase 7**: 4-5 days (Enhanced Features) - Optional

**Total Additional Time**: 2-4 days for core implementation, 4-5 days for enhancements

## Implementation Strategy

### Approach

1. **Clean Break**: Since app is not deployed, implement clean solution
2. **Flag-Based Discovery**: Use flags to identify conditional actions
3. **Extensible Design**: Easy to add new conditional action types
4. **No Legacy Code**: Remove old systems completely

### Benefits

1. **Simpler Code**: No backward compatibility complexity
2. **Better Performance**: No dual system overhead
3. **Future Proof**: Easy to add new tools with conditional actions
4. **Cleaner Architecture**: Single source of truth for templates

## Success Metrics

1. Reduced complexity in tool action forms (50%+ fewer fields) ✓
2. Template creation and usage by users ✓
3. Faster event configuration time ✓
4. Successful migration of all existing templates
5. No regression in existing functionality
6. 100% of conditional actions using new template system
7. Improved template management experience
8. Increased template reuse across organization
