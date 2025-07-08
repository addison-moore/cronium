# Tools Tab Migration Plan

## Overview

Migrate the tools tab from the Settings page to the Tools page to consolidate tool management functionality in one location.

## Current State Analysis

### Settings Page Structure

- **Location**: `src/app/[lang]/dashboard/settings/page.tsx`
- **Tools Tab**: Uses "integrations" value with `ModularToolsManager` component
- **Functionality**:
  - Credential management (add, edit, delete tool credentials)
  - Template management (create and manage message templates)
  - Plugin configuration and health monitoring
  - Stats cards (total tools, active tools, inactive tools)

### Tools Page Structure

- **Location**: `src/app/[lang]/dashboard/tools/page.tsx`
- **Component**: `ToolsDashboard` component
- **Current Tabs**:
  - Browse Actions (action discovery and search)
  - Execution History (recent tool executions)
  - Health Overview (tool statistics and health monitoring)

## Migration Plan

### Phase 1: Add Management Tab to Tools Page

- [x] **1.1** Read current Tools page implementation
- [x] **1.2** Add "Management" tab to existing tab structure
- [x] **1.3** Import and integrate `ModularToolsManager` component
- [x] **1.4** Update tab navigation logic
- [x] **1.5** Test new Management tab functionality
- [x] **1.6** Fix module import issues (tRPC and Plugin Registry paths)
- [x] **1.7** Fix credential decryption logic in tools router

### Phase 2: UI Improvements & Enhancements

- [x] **2.1** Move Management tab to first position (far left)
- [x] **2.2** Add search bar to Available Tools list in Management tab
- [x] **2.3** Implement search filtering for tools by name, description, category
- [x] **2.4** Add "No tools found" message for empty search results
- [x] **2.5** Update default tab to open Management first
- [x] **2.6** Add new Actions tab to left panel (Credentials, Templates, Actions)
- [x] **2.7** Implement Actions list showing all available actions for selected tool
- [x] **2.8** Add action cards with name, description, type, and category badges
- [x] **2.9** Add "Use" button for each action to create events

### Phase 3: Verify Functionality

- [ ] **3.1** Test credential management in new location
- [ ] **3.2** Test template management functionality
- [ ] **3.3** Test plugin configuration and health monitoring
- [ ] **3.4** Verify all tool integrations work correctly
- [ ] **3.5** Test stats cards and analytics

### Phase 4: Clean Up and Finalization

- [x] **4.1** Remove tools tab from Settings page
- [x] **4.2** Remove unused imports (ModularToolsManager, Plug icon)
- [x] **4.3** Update Settings page tab navigation (removed integrations)
- [x] **4.4** Remove stats cards from Management tab (info available in Health Overview)
- [x] **4.5** Clean up unused tRPC queries (getStats)
- [x] **4.6** Update component heights for better space utilization

### Phase 5: Final Navigation Updates

- [ ] **5.1** Search for internal links to Settings#tools
- [ ] **5.2** Update navigation links to point to Tools page
- [ ] **5.3** Update any documentation references
- [ ] **5.4** Check for hardcoded routes or redirects

### Phase 5: Final Testing

- [ ] **5.1** Full end-to-end testing of tool management
- [ ] **5.2** Test navigation between all dashboard sections
- [ ] **5.3** Verify no broken links or 404 errors
- [ ] **5.4** Test with different user roles and permissions

## Technical Details

### Components Involved

- **ModularToolsManager**: Main tools management component
- **ToolsDashboard**: Current tools page dashboard
- **Settings Page**: Current location of tools tab

### Key Files to Modify

- `src/app/[lang]/dashboard/tools/page.tsx` - Add Management tab
- `src/app/[lang]/dashboard/settings/page.tsx` - Remove tools tab
- `src/components/tools/ToolsDashboard.tsx` - Add Management tab integration

### Testing Requirements

- Credential CRUD operations
- Template creation and editing
- Plugin health monitoring
- Stats and analytics display
- Navigation and routing
- User permissions and access control

## Success Criteria

- [ ] Tools management functionality fully migrated to Tools page
- [ ] All existing features work without regression
- [ ] Settings page no longer has tools tab
- [ ] Navigation and links updated correctly
- [ ] No broken functionality or 404 errors
- [ ] User experience maintained or improved

## Rollback Plan

If issues arise during migration:

1. Revert changes to Tools page
2. Restore tools tab in Settings page
3. Test all functionality works as before
4. Document issues for future migration attempt

## Timeline

- **Phase 1**: Add Management tab - 1 hour
- **Phase 2**: Verify functionality - 30 minutes
- **Phase 3**: Update navigation - 30 minutes
- **Phase 4**: Clean up Settings - 30 minutes
- **Phase 5**: Final testing - 30 minutes

**Total Estimated Time**: 3 hours

## Notes

- Maintain backward compatibility during migration
- Test thoroughly before removing old implementation
- Document any issues or edge cases discovered
- Consider user notifications if navigation changes significantly
