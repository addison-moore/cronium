# Conditional Actions Template Migration - Clean Implementation

## Overview

Since the application is still in early development and hasn't been deployed, we can implement a clean solution without backward compatibility concerns. The new approach uses a flag-based system to identify which tool actions can be used as conditional actions.

## Flag-Based Architecture

### ToolAction Interface Update

Add a new optional flag to the ToolAction interface:

```typescript
export interface ToolAction {
  id: string;
  name: string;
  description: string;
  category: string;
  actionType: ActionType;

  // New flag for conditional actions
  isConditionalAction?: boolean;

  // ... rest of interface
}
```

### Updated Tool Actions

Each tool plugin will mark appropriate actions:

```typescript
// Discord Plugin
const discordActions: ToolAction[] = [
  {
    id: "discord-send-message",
    name: "Send Message",
    description: "Send a message to a Discord channel",
    isConditionalAction: true, // Flag for conditional actions
    // ... rest of action
  },
  // Other actions without the flag
];

// Slack Plugin
const slackActions: ToolAction[] = [
  {
    id: "slack-send-message",
    name: "Send Message",
    description: "Send a message to a Slack channel",
    isConditionalAction: true, // Flag for conditional actions
    // ... rest of action
  },
];

// Email Plugin
const emailActions: ToolAction[] = [
  {
    id: "send-email",
    name: "Send Email",
    description: "Send an email message",
    isConditionalAction: true, // Flag for conditional actions
    // ... rest of action
  },
];
```

## Implementation Details

### 1. Tool Registry Enhancement

Add methods to query conditional actions:

```typescript
// In ToolPluginRegistry
export class ToolPluginRegistry {
  // ... existing methods

  // Get all actions that can be used as conditional actions
  static getConditionalActions(): Array<{
    tool: ToolPlugin;
    action: ToolAction;
  }> {
    const conditionalActions: Array<{ tool: ToolPlugin; action: ToolAction }> =
      [];

    this.plugins.forEach((plugin, toolType) => {
      plugin.actions.forEach((action) => {
        if (action.isConditionalAction) {
          conditionalActions.push({ tool: plugin, action });
        }
      });
    });

    return conditionalActions;
  }

  // Get conditional actions for specific tool types
  static getConditionalActionsByTools(toolIds: number[]): Array<{
    tool: ToolPlugin;
    action: ToolAction;
  }> {
    // Implementation
  }
}
```

### 2. ConditionalActionsSection Updates

Remove hardcoded tool filtering:

```typescript
// OLD - Remove this
const allTools = useMemo(() => {
  return (
    toolsData?.tools?.filter(
      (tool) =>
        tool.type === ToolType.EMAIL ||
        tool.type === ToolType.SLACK ||
        tool.type === ToolType.DISCORD,
    ) ?? []
  );
}, [toolsData?.tools]);

// NEW - Get all tools with conditional actions
const conditionalActionTools = useMemo(() => {
  const conditionalActions = ToolPluginRegistry.getConditionalActions();
  const toolTypes = new Set(conditionalActions.map((ca) => ca.tool.id));

  return (
    toolsData?.tools?.filter((tool) =>
      toolTypes.has(tool.type.toLowerCase()),
    ) ?? []
  );
}, [toolsData?.tools]);
```

### 3. Template Query Updates

Replace old template queries:

```typescript
// Remove old query
const { data: templatesData } = trpc.integrations.templates.getAll.useQuery(...);

// New query for tool action templates
const { data: templatesData } = trpc.toolActionTemplates.getByToolAction.useQuery({
  toolType: selectedToolType,
  actionId: getConditionalActionId(selectedToolType),
}, {
  enabled: !!selectedToolType,
});

// Helper to get the conditional action ID for a tool
const getConditionalActionId = (toolType: string): string => {
  const conditionalActions = ToolPluginRegistry.getConditionalActions();
  const action = conditionalActions.find(
    ca => ca.tool.id === toolType.toLowerCase()
  );
  return action?.action.id || '';
};
```

### 4. Template Application

Update template selection to use new structure:

```typescript
const handleTemplateSelect = useCallback(
  (templateId: string) => {
    if (!templateId || templateId === "none") {
      setSelectedTemplate("");
      return;
    }

    const template = allTemplates.find((t) => t.id.toString() === templateId);
    if (template && template.parameters) {
      setSelectedTemplate(templateId);

      // Extract content based on the action's parameter structure
      const params = template.parameters as Record<string, any>;

      // Get the action schema to know which field contains the message
      const action = ToolPluginRegistry.getActionById(template.actionId);
      if (action) {
        // Use the action's schema to determine the message field
        const messageField = getMessageFieldFromSchema(action.inputSchema);
        if (messageField && params[messageField]) {
          setNewMessage(params[messageField]);
        }

        // Handle email-specific fields
        if (template.toolType === "EMAIL") {
          setNewEmailSubject(params.subject || "");
          setNewEmailAddresses(params.to || "");
        }
      }
    }
  },
  [allTemplates, selectedToolType],
);
```

### 5. Conditional Action Storage Update

Update the conditional action structure to store tool information:

```typescript
interface ConditionalAction {
  id?: number;
  type: "ON_SUCCESS" | "ON_FAILURE" | "ALWAYS" | "ON_CONDITION";
  action: ConditionalActionType; // Keep for now, deprecate later

  // New fields
  toolType?: string;
  actionId?: string;
  toolId?: number;
  parameters?: Record<string, any>;

  // Legacy fields (remove after migration)
  emailAddresses?: string;
  emailSubject?: string;
  targetEventId?: number;
  message?: string;
}
```

## Benefits of This Approach

1. **Extensibility**: Easy to add new conditional actions by adding the flag
2. **Clean Code**: No hardcoded tool types in ConditionalActionsSection
3. **Type Safety**: Actions are validated by their schemas
4. **Future Proof**: Can add conditional actions to any tool type
5. **Simpler Implementation**: No dual support or migration complexity

## Example: Adding a New Conditional Action

To add Microsoft Teams as a conditional action:

```typescript
// In teams-plugin.tsx
const teamsActions: ToolAction[] = [
  {
    id: "teams-send-message",
    name: "Send Teams Message",
    description: "Send a message to a Teams channel",
    isConditionalAction: true, // Just add this flag!
    inputSchema: z.object({
      channel: z.string(),
      message: z.string(),
    }),
    // ... rest of action
  },
];
```

That's it! The ConditionalActionsSection will automatically discover and allow this action.

## Migration Steps

1. **Update ToolAction Interface** - Add isConditionalAction flag
2. **Update Existing Actions** - Add flag to Discord, Slack, Email send message actions
3. **Enhance Tool Registry** - Add conditional action query methods
4. **Update ConditionalActionsSection** - Remove hardcoded filtering
5. **Switch to New Templates** - Use toolActionTemplates instead of old templates
6. **Remove Old Code** - Delete templates table and related code

## Testing Plan

1. **Unit Tests**
   - Test flag-based action discovery
   - Test template application with different schemas
   - Test parameter extraction

2. **Integration Tests**
   - Test creating conditional actions with templates
   - Test execution of conditional actions
   - Test with multiple tool types

3. **E2E Tests**
   - Create event with conditional action
   - Apply template and verify parameters
   - Execute event and verify conditional action fires

## Success Metrics

1. All existing conditional actions work without modification
2. New conditional actions can be added in < 5 minutes
3. Code reduction of 30%+ in ConditionalActionsSection
4. No hardcoded tool types in conditional action logic
