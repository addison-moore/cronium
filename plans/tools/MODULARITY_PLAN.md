# Tool Modularity Implementation Plan

## Overview

This plan outlines the steps to improve tool modularity in Cronium by moving tool-specific logic into plugins, removing hardcoded tool types, and creating a dynamic API route system. The goal is to make tools completely self-contained modules that can be added without modifying core application files.

**Note**: The project has been restructured into a monorepo. The Next.js application is now located in `apps/cronium-app/`. All paths in this document should be prefixed with `apps/cronium-app/` when referencing web application files.

## Goals

1. Move tool schemas into plugins so each plugin contains its own schemas
2. Create plugin API route system with dynamic route registration
3. Remove hardcoded tool types from the codebase
4. Deprecate the integrations router in favor of plugin-based routes
5. Maintain conditional actions functionality without hardcoding specific tools

## Important Constraints

- No UI/UX changes allowed - maintain existing visual design and functionality
- Breaking changes are acceptable (no production users yet)
- Focus only on modularity improvements, not new features
- Conditional actions must continue working seamlessly

## Phase 1: Schema Migration

### Objective

Move all tool-related schemas from shared locations into their respective plugin directories.

### Tasks

#### Plugin Schema Consolidation

- [x] Create `schemas.ts` file in each plugin directory
- [x] Move credential schemas from `/src/shared/schemas/tools.ts` to respective plugins
- [x] Move action schemas from `/src/shared/schemas/integrations.ts` to respective plugins
- [x] Update plugin definitions to export schemas from local files
- [x] Remove tool-specific schemas from shared schema files
- [x] Update all imports to use plugin-provided schemas
- [x] Verify schema validation still works in all components

#### Schema Interface Updates

- [x] Add `credentialSchema` property to ToolPlugin interface (already existed as `schema`)
- [x] Add `actionSchemas` property to ToolPlugin interface (actions have inputSchema/outputSchema)
- [x] Update ToolPluginRegistry to provide schema access methods

## Phase 2: Dynamic API Route System

### Objective

Enable plugins to register their own API endpoints dynamically without modifying central routers.

### Tasks

#### 2.1 Plugin API Route Definition

- [x] Add `apiRoutes` property to ToolPlugin interface
- [x] Create route handler type definitions for plugins
- [x] Update each plugin to define its own API routes
- [x] Include route input/output schemas in plugin definitions

#### 2.2 Dynamic Route Registration

- [x] Create `plugin-router.ts` in tools router directory
- [x] Implement dynamic route builder that reads from ToolPluginRegistry
- [x] Add plugin route mounting to main tools router
- [x] Ensure proper authentication/authorization on dynamic routes
- [x] Add error handling for plugin route failures

#### 2.3 API Migration

- [x] Move send endpoints from integrations router to respective plugins
- [x] Move test endpoints to plugin definitions
- [x] Move bulk operations to plugin definitions where applicable
- [x] Update all API calls to use new plugin-based endpoints
- [x] Add deprecation notices to old integrations router endpoints

## Phase 3: Remove Hardcoded Tool Types

### Objective

Eliminate all hardcoded tool type enums and switch statements from the codebase.

### Tasks

#### 3.1 Database Schema Updates

- [x] Change `toolType` columns from enum to string type
- [x] Remove ToolType enum from schema definitions
- [x] Update all database queries to handle string tool types
- [x] Create data migration to convert existing enum values to strings

#### 3.2 Human intervention required

- [x] Run database migration to update schema
- [x] Verify data integrity after migration

#### 3.3 Conditional Actions Refactoring

- [x] Update ConditionalActionsSection to remove hardcoded icon switches
- [x] Make tool icons come from plugin definitions
- [x] Remove hardcoded email/slack/discord parameter mapping
- [x] Use plugin action schemas to determine field requirements
- [x] Update conditional action execution to use plugin-provided methods

#### 3.4 Tool Type References

- [x] Find and replace all ToolType enum usages with string types
- [x] Update type definitions to use string instead of enum
- [x] Remove switch statements based on tool types
- [x] Update validation logic to check against registered plugins

## Phase 4: Conditional Actions Enhancement

### Objective

Enable any tool to provide conditional actions without hardcoding specific tools.

### Tasks

#### 4.1 Plugin Conditional Action Support

- [x] Add `conditionalActionConfig` to ToolAction interface
- [x] Define structure for conditional action parameter mapping
- [x] Update plugins to provide conditional action configurations
- [x] Add method to ToolPlugin for rendering conditional action forms

#### 4.2 UI Updates (No Visual Changes)

- [x] Update ConditionalActionsSection to dynamically render fields
- [x] Use plugin-provided configurations for field display
- [x] Remove hardcoded email subject/recipients fields
- [x] Make form fields dynamic based on action requirements
- [x] Ensure UI remains visually identical

#### 4.3 Execution Updates

- [ ] Update event handlers to use plugin methods for conditional actions
- [ ] Remove hardcoded parameter mapping in execution logic
- [ ] Use action schemas to validate and transform parameters
- [ ] Ensure template processing works with dynamic fields

## Phase 5: Deprecate Integrations Router

### Objective

Remove the centralized integrations router in favor of plugin-based routes.

### Tasks

#### 5.1 Router Deprecation

- [ ] Mark all integrations router endpoints as deprecated
- [ ] Add console warnings when deprecated endpoints are used
- [ ] Update all internal code to use plugin routes
- [ ] Create migration guide for any external integrations

#### 5.2 Cleanup

- [ ] Remove unused imports from integrations router
- [ ] Remove mock implementations from integrations router
- [ ] Update API documentation to reflect new endpoints
- [ ] Remove integrations router file once all references are updated

#### 5.3 Testing Migration

- [ ] Move integration tests to respective plugin directories
- [ ] Update test configurations to use plugin routes
- [ ] Ensure all existing tests continue to pass
- [ ] Add tests for dynamic route registration

## Phase 6: Final Cleanup and Validation

### Objective

Ensure the system is fully modular and all hardcoded references are removed.

### Tasks

#### 6.1 Code Cleanup

- [ ] Remove all unused tool-specific imports
- [ ] Delete deprecated schema files
- [ ] Remove commented-out code related to old implementation
- [ ] Update type definitions to reflect new architecture

#### 6.2 Documentation Updates

- [ ] Update CLAUDE.md with new tool plugin guidelines
- [ ] Create migration notes for future reference
- [ ] Update API documentation
- [ ] Add examples of creating new tool plugins

#### 6.3 Validation

- [ ] Test adding a new tool plugin without core changes
- [ ] Verify all existing tools work correctly
- [ ] Ensure conditional actions work for all tools
- [ ] Validate that no hardcoded tool types remain
- [ ] Performance testing to ensure no degradation

#### Human intervention required

- [ ] Manual testing of OAuth flows for applicable tools
- [ ] Verify webhook endpoints still function correctly

## Phase 7: ToolActionSection Modularity

### Objective

Remove all hardcoded tool-specific logic from ToolActionSection.tsx and move it to plugin definitions, making the component fully generic and extensible for new tools.

### Tasks

#### 7.1 Preview System Refactoring

- [ ] Add `PreviewComponent` property to ToolAction interface in plugin types
- [ ] Move preview components from `/tools/previews` to respective plugin directories
- [ ] Update each plugin to export its own preview component
- [ ] Create a generic fallback preview component for tools without custom previews
- [ ] Remove hardcoded preview rendering logic from ToolActionSection (lines 406-522)

#### 7.2 Dynamic Preview Loading

- [ ] Implement dynamic preview component loading based on plugin configuration
- [ ] Remove direct imports of specific preview components from ToolActionSection
- [ ] Add preview component registry to ToolPluginRegistry
- [ ] Ensure preview components are lazy-loaded for performance

#### 7.3 Category and Styling Configuration

- [ ] Move CATEGORY_ICONS mapping to plugin definitions
- [ ] Add `categoryIcon` property to ToolPlugin interface
- [ ] Move ACTION_TYPE_COLORS to a plugin-configurable system
- [ ] Allow plugins to define custom action type colors
- [ ] Create default icon and color mappings for undefined categories

#### 7.4 Parameter UI Customization

- [ ] Add `parameterComponents` property to ToolAction for custom parameter UIs
- [ ] Allow plugins to provide custom parameter input components
- [ ] Create a plugin helper for common parameter patterns (file upload, OAuth flow, etc.)
- [ ] Ensure backward compatibility with standard parameter forms

#### 7.5 Testing and Validation

- [ ] Test ToolActionSection with existing tools to ensure no regression
- [ ] Create a mock tool plugin to validate extensibility
- [ ] Verify preview components load correctly from plugins
- [ ] Ensure styling and icons work dynamically
- [ ] Test with tools that don't provide custom components (fallback behavior)

### Implementation Guidelines

1. **Preview Component Interface**: Each plugin's preview component should accept a standardized props interface:

   ```typescript
   interface ToolPreviewProps {
     parameters: Record<string, unknown>;
     action: ToolAction;
     tool: Tool;
   }
   ```

2. **Lazy Loading**: Use React.lazy() for loading preview components to avoid bundling all previews:

   ```typescript
   const PreviewComponent = plugin.getPreviewComponent?.(action.id);
   ```

3. **Fallback UI**: Provide a generic preview that displays parameters in a structured format when no custom preview exists

4. **Migration Path**:
   - Keep existing preview components working during transition
   - Gradually move each tool's preview to its plugin directory
   - Update plugins one at a time to minimize risk

## Success Criteria

1. **No Core Modifications**: Adding a new tool requires only creating a plugin directory
2. **Dynamic Discovery**: All tool types, actions, and routes are discovered from plugins
3. **Conditional Actions**: Any tool can provide conditional actions without hardcoding
4. **Clean Architecture**: No tool-specific logic exists outside plugin directories
5. **Backwards Compatibility**: All existing functionality continues to work

## Risk Mitigation

1. **Testing Strategy**: Comprehensive tests at each phase before proceeding
2. **Rollback Plan**: Git tags at each phase completion for easy rollback
3. **Gradual Migration**: Deprecated code remains functional during transition
4. **Monitoring**: Log all deprecated endpoint usage to track migration progress

## Notes

- The `isConditionalAction` flag approach for tool actions will be enhanced to include configuration
- Plugin schemas will be the single source of truth for all tool-related data structures
- The UI will dynamically adapt to plugin configurations while maintaining visual consistency
- All database changes are backwards compatible with string-based tool types
