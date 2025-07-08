# Event Form Tool Action Integration Plan

## Implementation Progress Summary

**Overall Progress**: ~80% Complete

### ✅ Completed

- ImprovedEventForm component with React Hook Form + Zod validation
- ImprovedToolActionSection with visual tool browser and two-tab interface
- Conditional rendering (hides script IDE for Tool Actions)
- Tool search, filtering, and category organization
- Action selection with visual cards and type badges
- Test execution functionality with real-time feedback
- Type-safe implementation with zero `any` types

### 🚧 In Progress

- Integration with existing event pages
- Parameter templates and variable substitution
- Live action previews

### 📋 Remaining

- Animation and transitions
- Keyboard shortcuts
- Unit and integration tests

## Overview

This document outlines the comprehensive plan to improve the Tool Action event type UI/UX in the Cronium event form. The goal is to create a clean, intuitive interface that guides users through configuring tool actions without showing unnecessary elements like the script IDE.

## Current State Analysis

### Issues with Current Implementation

1. **Script IDE is shown for Tool Action events** - The code editor appears even though Tool Actions don't require code
2. **Tool selection is basic** - Tools and actions are not well organized or easy to browse
3. **No visual differentiation** - Tool Action events look too similar to script events
4. **Limited feedback** - No clear indication of what the selected action will do
5. **Poor tool discovery** - Users can't easily see available tools or understand their capabilities

### Existing Components

- `EventForm.tsx` - Main form component that handles all event types
- `ToolActionSection.tsx` - Basic tool action configuration
- `EnhancedToolActionSection.tsx` - Improved version with better UX (partially implemented)
- `ActionParameterForm.tsx` - Dynamic form for action parameters

## Design Goals

1. **Clear Visual Hierarchy** - Tool Actions should have their own distinct UI flow
2. **Progressive Disclosure** - Guide users step-by-step through tool selection → action selection → parameter configuration
3. **Contextual Help** - Show relevant information at each step
4. **Visual Feedback** - Clear indication of tool status, action type, and expected outcomes
5. **Efficient Workflow** - Support both new users and power users with shortcuts

## Implementation Plan

### Phase 1: Conditional UI Rendering

#### 1.1 Hide Unnecessary Sections for Tool Actions

```typescript
// In EventForm.tsx, conditionally render sections based on event type
{!isToolAction && (
  <>
    {/* Script IDE Section */}
    <AIScriptAssistant />
    <Card>
      <CardHeader>
        <CardTitle>Script Content</CardTitle>
      </CardHeader>
      <CardContent>
        <MonacoEditor />
      </CardContent>
    </Card>
  </>
)}
```

#### 1.2 Update Form Layout

- Move Tool Action section higher in the form when Tool Action is selected
- Hide script-specific settings (no need for script content, AI assistant)
- Show tool-specific settings prominently

### Phase 2: Enhanced Tool Selection Experience

#### 2.1 Tool Browser Component

Create a visual tool browser that shows:

- Tool icons and names
- Tool status (active/inactive)
- Number of available actions
- Tool categories (Communication, Productivity, Development, etc.)

```typescript
interface ToolBrowserProps {
  tools: Tool[];
  selectedToolId?: number;
  onSelectTool: (tool: Tool) => void;
}

// Visual grid layout with tool cards
<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
  {groupedTools.map(category => (
    <ToolCategorySection key={category.name}>
      {category.tools.map(tool => (
        <ToolCard
          tool={tool}
          selected={tool.id === selectedToolId}
          onClick={() => onSelectTool(tool)}
        />
      ))}
    </ToolCategorySection>
  ))}
</div>
```

#### 2.2 Tool Search and Filtering

- Add search functionality to quickly find tools
- Filter by category, status, or capabilities
- Show recently used tools first

### Phase 3: Improved Action Selection

#### 3.1 Action Browser

Once a tool is selected, show available actions in a clear, organized way:

```typescript
interface ActionBrowserProps {
  tool: ToolPlugin;
  selectedActionId?: string;
  onSelectAction: (action: ToolAction) => void;
}

// Group actions by type
const actionsByType = {
  message: actions.filter((a) => a.actionType === "message"),
  create: actions.filter((a) => a.actionType === "create"),
  update: actions.filter((a) => a.actionType === "update"),
  query: actions.filter((a) => a.actionType === "query"),
};
```

#### 3.2 Action Preview

Show a preview of what the action will do:

- Action description
- Required parameters
- Example usage
- Expected output format

### Phase 4: Smart Parameter Configuration

#### 4.1 Contextual Parameter Forms

- Show only relevant parameters based on the action
- Provide helpful placeholders and examples
- Validate inputs in real-time
- Support variable substitution ({{VARIABLE_NAME}})

#### 4.2 Parameter Templates

- Offer pre-configured templates for common use cases
- Allow saving custom templates
- Quick-fill options for testing

### Phase 5: Visual Feedback and Testing

#### 5.1 Live Preview

Show a preview of what will happen when the event runs:

- For Slack: Show message preview
- For Email: Show email preview
- For API calls: Show request structure

#### 5.2 Test Execution

- One-click test button with clear feedback
- Show test results inline
- Dry-run mode for safety

### Phase 6: Form Validation and Submission

#### 6.1 Tool Action Specific Validation

```typescript
// Validate tool action configuration
const validateToolAction = (config: ToolActionConfig): ValidationResult => {
  // Check tool exists and is active
  // Check action exists for tool
  // Validate parameters against schema
  // Check user has permissions
};
```

#### 6.2 Clear Save States

- Show what will be saved
- Indicate required vs optional fields
- Provide clear error messages

## UI Component Structure

### Proposed Component Hierarchy

```
EventForm
├── BasicInfoSection
├── EventTypeSelector
├── ToolActionSection (when type === TOOL_ACTION)
│   ├── ToolBrowser
│   │   ├── ToolSearch
│   │   ├── ToolCategories
│   │   └── ToolGrid
│   ├── ActionSelector
│   │   ├── ActionSearch
│   │   ├── ActionList
│   │   └── ActionPreview
│   └── ParameterConfigurator
│       ├── ParameterForm
│       ├── ParameterTemplates
│       └── TestRunner
├── ScheduleSection
├── ExecutionSettings
└── ConditionalActions
```

## Data Flow

### Tool Action Configuration Flow

1. User selects "Tool Action" as event type
2. Tool browser appears showing available tools
3. User selects a tool
4. Action list appears for selected tool
5. User selects an action
6. Parameter form appears with action-specific fields
7. User configures parameters
8. User can test the action
9. User saves the event

### State Management

```typescript
// Tool action state in EventForm
const [toolActionState, setToolActionState] = useState<{
  selectedTool: Tool | null;
  selectedAction: ToolAction | null;
  parameters: Record<string, any>;
  testResults: TestResult | null;
}>({
  selectedTool: null,
  selectedAction: null,
  parameters: {},
  testResults: null,
});
```

## Specific UI/UX Improvements

### 1. Visual Distinction

- Use different color scheme for Tool Action events
- Add icon badges to clearly identify event type
- Use card-based layouts for better visual separation

### 2. Progressive Enhancement

- Start with simple tool selection
- Progressively reveal more options as user makes selections
- Support keyboard navigation for power users

### 3. Help and Documentation

- Inline help text for each tool and action
- Link to documentation for complex features
- Show examples relevant to user's selection

### 4. Error Prevention

- Disable invalid selections
- Show warnings for common mistakes
- Validate before allowing save

### 5. Responsive Design

- Mobile-friendly tool and action selection
- Touch-optimized parameter forms
- Collapsible sections for small screens

## Implementation Checklist

### Phase 1: Basic Improvements

- [x] Hide script IDE for Tool Action events (Completed in ImprovedEventForm)
- [x] Move tool action section higher in form (Tool action section appears instead of script content)
- [x] Add loading states for tool data (Using tRPC with loading states)
- [x] Implement conditional rendering based on event type
- [x] Create ImprovedEventForm with React Hook Form + Zod validation
- [x] Add type-safe form handling following TYPE_SAFETY_GUIDELINES

### Phase 2: Tool Selection

- [x] Implement visual tool browser (Created in ImprovedToolActionSection)
- [x] Add tool search/filter (Search input and category filtering implemented)
- [x] Show tool status and health (Active/Inactive badges with health indicators)
- [x] Create tool cards with icons and descriptions
- [x] Implement category-based filtering (Communication, Productivity, etc.)
- [x] Add "No tools configured" empty state

### Phase 3: Action Selection

- [x] Create action browser component (Action cards in Configure tab)
- [x] Group actions by type (Action type badges with colors)
- [x] Add action preview (Action description shown in cards)
- [x] Implement two-tab interface (Tools tab → Configure tab)
- [x] Show number of available actions per tool
- [ ] Add action search functionality within selected tool

### Phase 4: Parameter Configuration

- [x] Enhance parameter form with better UX (Using ActionParameterForm)
- [ ] Add parameter templates
- [ ] Support variable substitution ({{VARIABLE_NAME}})
- [x] Integrate with existing ActionParameterForm component
- [x] Show test data as default values
- [ ] Add parameter validation feedback

### Phase 5: Testing & Feedback

- [x] Add test execution functionality (Test button in Configure tab)
- [x] Show live previews (Slack message preview, email preview, etc.)
- [ ] Implement dry-run mode
- [x] Add loading state for test execution
- [x] Show success/error toast notifications
- [ ] Display test results inline

### Phase 6: Polish

- [ ] Add animations and transitions
- [ ] Implement keyboard shortcuts
- [ ] Add usage analytics
- [x] Add help text and tooltips
- [x] Implement responsive design for mobile
- [ ] Add undo/redo functionality

### Additional Completed Items

- [x] Create test page at `/dashboard/events/test-improved`
- [x] Fix missing Settings import from lucide-react
- [x] Follow React Hook Form best practices from RHF_GUIDE.md
- [x] Implement proper TypeScript typing (zero `any` types)
- [x] Add proper form validation with Zod schemas
- [x] Handle form submission for create/update operations

## Next Steps & Remaining Tasks

### Immediate Priorities

1. **Integration**: Replace existing EventForm with ImprovedEventForm
   - [x] Update `/dashboard/events/new/page.tsx`
   - [x] Update `/dashboard/events/[id]/page.tsx` (via EventEditTab)
   - [x] Test with existing events data
2. **Parameter Templates**: Implement reusable parameter templates
   - [ ] Create template storage mechanism
   - [ ] Add template selector UI
   - [ ] Allow saving custom templates
3. **Live Previews**: Show action previews before execution
   - [x] Slack message preview component
   - [x] Email preview with formatting
   - [x] API request preview
   - [x] Discord message preview (using Slack preview)
   - [x] Integrate previews into ImprovedToolActionSection
4. **Variable Substitution**: Support dynamic variables
   - [ ] Parse {{VARIABLE_NAME}} syntax
   - [ ] Show available variables
   - [ ] Validate variable references

### Known Issues to Fix

- [ ] Fix linting errors in other components (servers, tools, workflows pages)
- [ ] Add proper error boundaries for tool action failures
- [ ] Improve error messages for missing tool credentials
- [ ] Handle tool plugin loading failures gracefully

### Testing Requirements

- [ ] Unit tests for ImprovedEventForm
- [ ] Unit tests for ImprovedToolActionSection
- [ ] Integration tests for tool action creation flow
- [ ] E2E tests for complete event lifecycle

## Migration Strategy

1. **Feature Flag**: Use feature flag to gradually roll out new UI
2. **Backwards Compatibility**: Ensure existing Tool Action events continue to work
3. **Data Migration**: Update existing events to new format if needed
4. **User Communication**: Notify users of improvements

## Success Metrics

- **Time to Configure**: Reduce average time to create a Tool Action event by 50%
- **Error Rate**: Reduce configuration errors by 75%
- **User Satisfaction**: Increase tool action usage by 100%
- **Support Tickets**: Reduce tool-action related support requests by 60%

## Future Enhancements

1. **AI-Powered Suggestions**: Suggest tools and actions based on event description
2. **Visual Workflow Builder**: Drag-and-drop interface for complex tool chains
3. **Tool Marketplace**: Browse and install community-created tools
4. **Advanced Templating**: Share and reuse tool action configurations

## Conclusion

This plan provides a comprehensive approach to improving the Tool Action event type UI/UX. By focusing on progressive disclosure, visual clarity, and user guidance, we can make Tool Actions as easy to use as possible while maintaining the power and flexibility users need.
