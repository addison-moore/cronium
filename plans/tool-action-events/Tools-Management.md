# Tools Management Interface Design

**CREATED: 2025-07-07**

## Current State Analysis

### Existing Tools Management System

The current Tools management interface is located at **Settings > Tools** (`/dashboard/settings#integrations`) and provides:

#### Current Features:

1. **Tool Statistics**
   - Total tools configured
   - Active vs inactive tools count
   - Visual dashboard cards

2. **Tool Plugin List**
   - Left sidebar showing all available plugins (Email, Slack, Discord, etc.)
   - Count of configured credentials per tool
   - Visual selection interface

3. **Credentials Management**
   - Add/Edit/Delete credentials for each tool
   - Tool-specific credential forms
   - Credential display with masked sensitive data
   - Per-credential activation toggle

4. **Templates Management**
   - Create message templates per tool type
   - Email templates with subject lines
   - Template editor with Monaco editor
   - Template listing and management

### What's Missing for Tool Actions:

1. **Action Discovery**
   - No way to browse available actions per tool
   - No action descriptions or parameter previews
   - No action testing interface

2. **Health & Status Monitoring**
   - No connection status indicators
   - No last successful use timestamps
   - No error history or diagnostics

3. **Quick Actions**
   - No way to test actions directly
   - No action execution history
   - No quick access to frequently used actions

4. **Tool Action Integration**
   - No link between tools config and event creation
   - No indication which tools have actions available
   - No action count or capability indicators

## Design Considerations

### Option 1: Enhance Existing Tools Tab

**Pros:**

- Single source of truth for all tool-related configuration
- Users already know where to find tool settings
- Minimal navigation changes
- Consistent user experience

**Cons:**

- Settings page might become cluttered
- Limited space for action browsing
- Settings context may not be ideal for operational features

### Option 2: Create Separate Dashboard Page

**Pros:**

- More space for action-focused features
- Better suited for operational tasks (testing, monitoring)
- Can include execution history and logs
- Dashboard context better for daily use

**Cons:**

- Splits tool management across two locations
- Potential user confusion about where to go
- Duplication of some features

### Option 3: Hybrid Approach (Recommended)

**Keep in Settings:**

- Credential configuration
- Basic tool setup
- Templates management
- Tool activation/deactivation

**Add to Dashboard:**

- Tool Actions Hub (`/dashboard/tools`)
- Action browser and testing
- Execution monitoring
- Quick action shortcuts

## Recommended Implementation Plan

### Phase 1: Enhance Existing Tools Tab (Week 1)

Add the following to the current Tools settings tab:

1. **Action Indicators**

   ```
   Email (3 credentials, 2 actions available)
   Slack (1 credential, 4 actions available)
   ```

2. **Connection Status**
   - Green/red dot for each credential
   - "Test Connection" button
   - Last verified timestamp

3. **Quick Links**
   - "Browse Actions" button per tool
   - "Create Event with this Tool" shortcut

### Phase 2: Create Tools Dashboard (Week 2)

New dashboard page at `/dashboard/tools` with:

1. **Tools Overview**
   - Grid of configured tools with health status
   - Quick stats (executions today, success rate)
   - Recent tool action executions

2. **Action Browser**
   - Searchable list of all available actions
   - Filter by tool, category, or type
   - Action details with parameter info
   - "Use in Event" and "Test Now" buttons

3. **Execution Monitor**
   - Recent tool action executions
   - Success/failure indicators
   - Execution logs viewer
   - Performance metrics

4. **Quick Actions**
   - Favorite actions for one-click execution
   - Recently used actions
   - Action templates/presets

### Phase 3: Integration Improvements (Week 3)

1. **Event Form Integration**
   - "Configure Tool" link if credentials missing
   - Tool health indicator in dropdown
   - Recent executions for selected tool

2. **Workflow Integration**
   - Tool action nodes show health status
   - Quick access to tool configuration

3. **Navigation Updates**
   - Add "Tools" to main dashboard navigation
   - Quick access from event creation

## UI/UX Guidelines

### Information Architecture

```
Dashboard
├── Tools (NEW)
│   ├── Overview
│   ├── Actions Browser
│   ├── Execution History
│   └── Quick Actions
└── Settings
    └── Tools (EXISTING)
        ├── Credentials
        └── Templates
```

### Design Principles

1. **Progressive Disclosure**
   - Basic features in settings
   - Advanced features in dashboard
   - Contextual help throughout

2. **Action-Oriented**
   - Focus on what users can do
   - Clear CTAs for common tasks
   - Minimal clicks to execute

3. **Status Visibility**
   - Always show health indicators
   - Clear error messages
   - Success confirmations

## Implementation Priority

### Must Have (Week 1)

- Connection testing in settings
- Action count indicators
- Basic health status
- Link to create events

### Should Have (Week 2)

- Tools dashboard page
- Action browser
- Execution history
- Quick test interface

### Nice to Have (Week 3)

- Favorites system
- Advanced filtering
- Performance metrics
- Batch operations

## Technical Considerations

### API Requirements

1. **New Endpoints Needed:**
   - `tools.testConnection` - Test tool credentials
   - `tools.getActionStats` - Get execution statistics
   - `tools.getRecentExecutions` - Get recent tool action runs

2. **Database Updates:**
   - Add `last_tested_at` to tools table
   - Add `last_error` for diagnostics
   - Consider caching health status

### Component Structure

```typescript
// Existing (Enhanced)
ModularToolsManager
├── CredentialManager
├── TemplateManager
└── HealthIndicator (NEW)

// New Dashboard Components
ToolsDashboard
├── ToolsOverview
├── ActionBrowser
├── ExecutionHistory
└── QuickActions
```

## Conclusion

The recommended approach is a **hybrid solution** that:

1. Enhances the existing Tools settings tab with health monitoring and action indicators
2. Creates a new Tools dashboard for operational tasks and action management
3. Maintains clear separation between configuration (settings) and operations (dashboard)

This approach provides the best user experience by keeping related features together while avoiding interface clutter. Users can configure tools in settings and use them effectively from the dashboard.

## Next Steps

1. Add health indicators to existing Tools tab
2. Create `/dashboard/tools` page structure
3. Implement action browser component
4. Add execution monitoring
5. Update navigation and linking
