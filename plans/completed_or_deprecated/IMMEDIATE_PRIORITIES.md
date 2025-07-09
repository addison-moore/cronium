# Tool Action Events - Immediate Priorities

**STATUS: 🚨 CRITICAL PATH**  
**CREATED: 2025-07-07**  
**UPDATED: 2025-07-07** - Revised with hybrid Tools Management approach

## 🎯 Primary Goal

Make Tool Actions fully functional as a schedulable, executable event type that can be incorporated into workflows, just like other event types (NODEJS, PYTHON, BASH, HTTP_REQUEST).

**See [Tools-Management.md](./Tools-Management.md) for detailed UI/UX design decisions**

## ✅ What's Already Done

1. **TOOL_ACTION EventType** - Already defined in schema
2. **EventForm Integration** - ToolActionSection component exists
3. **Feature Flag** - `isToolActionsUIEnabled()` controls visibility
4. **Database Schema** - `tool_action_config` column and `tool_action_logs` table exist
5. **Multiple Tool Integrations** - Slack, Discord, Teams, Google Sheets, Notion, Trello

## 🚨 Critical Missing Pieces

### 1. Enable Tool Actions in UI (Day 1) ✅ COMPLETED

- **Remove/Enable Feature Flag**: ✅ All feature flags enabled
- **Fix ToolActionSection**: ✅ Component works properly
- **Tool Credentials**: ✅ ModularToolsManager exists in Settings
- **Form Validation**: ✅ ActionParameterForm validates inputs

### 2. Enhance Existing Tools Settings (Day 2-3) 🆕

- **Health Indicators**: Add connection status to each credential
- **Test Connection**: Button to verify credentials work
- **Action Count**: Show available actions per tool
- **Quick Links**: "Create Event with Tool" shortcuts

### 3. Create Tools Dashboard (Day 4-5) 🆕

- **New Dashboard Page**: `/dashboard/tools` for operational features
- **Action Browser**: Search and filter all available actions
- **Execution Monitor**: Recent executions with logs
- **Quick Test**: Test actions without creating events

### 4. Complete Integration (Day 6-7)

- **Test Event Creation**: Verify TOOL_ACTION events work end-to-end
- **Fix Credential Loading**: Replace mock credentials in executor
- **Workflow Support**: Ensure tool actions work in workflows
- **Documentation**: User guide for Tool Actions

## 📋 Implementation Checklist

### Phase 1: Make It Work (Days 1-3)

- [x] Enable feature flag or remove flag check ✅ (2025-07-07)
- [x] Test ToolActionSection loads properly ✅
- [x] Verify tool selection dropdown works ✅
- [x] Ensure action parameters form renders ✅
- [ ] Test saving events with tool actions
- [x] Verify scheduler executes tool actions ✅ (code exists)
- [ ] Add logging for debugging
- [ ] Test with at least 2 different tools

**UPDATE**: Tools management exists in Settings > Tools tab. Hybrid approach recommended - enhance settings for configuration, add dashboard for operations.

### Phase 2: Enhance Tools Settings (Days 2-3)

- [x] Add connection status indicators to ModularToolsManager ✅
- [x] Implement "Test Connection" button for each credential ✅
- [x] Show action count per tool type ✅
- [x] Add "Create Event" quick action buttons ✅
- [ ] Display last tested timestamp (partially done)
- [ ] Add error diagnostics display

### Phase 3: Create Tools Dashboard (Days 4-5)

- [ ] Create new `/dashboard/tools` route
- [ ] Build ToolsOverview component with health grid
- [ ] Implement ActionBrowser with search/filter
- [ ] Add ExecutionHistory viewer
- [ ] Create QuickActions for favorites
- [ ] Add navigation links

### Phase 4: Complete Integration (Days 6-7)

- [ ] Test creating TOOL_ACTION events
- [ ] Fix mock credentials in tool-action-executor
- [ ] Verify workflow integration
- [ ] Create user documentation
- [ ] Performance testing
- [ ] End-to-end testing

## 🎯 Success Criteria

1. **Users can create a TOOL_ACTION event** from the event form
2. **Events can be scheduled** with cron or interval triggers
3. **Tool actions execute successfully** when triggered
4. **Errors are clearly reported** with actionable messages
5. **Tool actions work in workflows** as nodes
6. **Credential management is intuitive** and secure

## 🚫 Not Required for MVP

- Community marketplace
- Advanced analytics
- Custom action development
- Complex data transformations
- Third-party publishing

## 📊 Testing Plan

1. **Create Event**: Create a Slack message event, schedule it, verify execution
2. **Workflow Test**: Add tool action to workflow, verify data flow
3. **Error Test**: Test with invalid credentials, verify error handling
4. **Schedule Test**: Create recurring tool action, verify multiple executions
5. **UI Test**: Complete tool setup flow from scratch

## 🔧 Technical Requirements

```typescript
// Minimum viable ToolActionConfig
interface ToolActionConfig {
  toolId: number; // Reference to tools table
  actionId: string; // Action identifier
  parameters: Record<string, any>; // Action-specific params
}

// Execution must support
interface ToolActionExecution {
  loadCredentials(toolId: number): Promise<Credentials>;
  validateParameters(action: ToolAction, params: any): ValidationResult;
  execute(config: ToolActionConfig, context: ExecutionContext): Promise<any>;
  handleError(error: Error): ExecutionError;
}
```

## 🏃 Next Steps

1. **Verify Current State**: Test what works/doesn't work with feature flag enabled
2. **Fix Blockers**: Address any immediate issues preventing basic functionality
3. **Enable Feature**: Make tool actions available to all users
4. **Document**: Create user guide for setting up first tool action

This focused approach ensures Tool Actions become a fully functional event type within one week, providing immediate value to users while laying groundwork for future enhancements.
