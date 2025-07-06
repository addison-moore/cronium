# Tool Action Events - Phase 1 Implementation Plan

## Overview

This document provides a detailed implementation plan for Phase 1 (Weeks 1-4) of the Tool Action Events project. Phase 1 focuses on establishing the foundational architecture for tool action events while maintaining backward compatibility with existing functionality.

## Current State Analysis

### Existing Tool Architecture

**Plugin System**:

- Well-established `ToolPlugin` interface with registry pattern
- Current plugins: Email, Slack, Discord
- Components: `CredentialForm`, `CredentialDisplay`, `TemplateManager`
- Registry supports categorization and plugin management

**Database Schema**:

- `tools` table with `type`, `credentials`, `isActive` fields
- `templates` table for message templates
- `ToolType` enum: EMAIL, SLACK, DISCORD, WEBHOOK, HTTP

**tRPC Integration**:

- `tools` router: CRUD operations for tool credentials
- `integrations` router: Message sending and template management
- Authentication handling for both development and production

**Current Event System**:

- EventType enum: NODEJS, PYTHON, BASH, HTTP_REQUEST
- Event form supports different types with conditional rendering
- Execution engine with timeout, retry, and server selection

## Phase 1 Goals

1. **Enhanced Plugin System**: Extend current plugin interface to support actions
2. **TOOL_ACTION Event Type**: Add new event type to existing system
3. **Basic UI Components**: Create foundational UI for tool action configuration
4. **Database Extensions**: Add necessary schema changes
5. **Execution Integration**: Basic tool action execution capability
6. **Real-time Feedback**: Foundation for execution progress tracking

## Implementation Tasks

### Week 1: Core Architecture & Schema

#### Task 1.1: Enhanced Plugin System (2 days)

**Goal**: Extend the existing `ToolPlugin` interface to support actions

**Files to Modify**:

- `src/components/tools/types/tool-plugin.ts`
- `src/shared/schema.ts`

**Implementation**:

1. **Extend ToolPlugin Interface**:

```typescript
// Add to existing ToolPlugin interface
export interface ToolPlugin {
  // ... existing properties
  actions: ToolAction[];
  getActionById: (id: string) => ToolAction | undefined;
  getActionsByType: (type: ActionType) => ToolAction[];
}

export interface ToolAction {
  id: string;
  name: string;
  description: string;
  category: string;
  actionType: "create" | "update" | "search" | "delete";

  // Development mode support
  developmentMode: "visual" | "code";

  // Schemas for validation
  inputSchema: z.ZodSchema<any>;
  outputSchema: z.ZodSchema<any>;

  // Execution
  execute: (
    credentials: any,
    params: any,
    context: ExecutionContext,
  ) => Promise<any>;

  // Testing support
  testData?: () => any;
  validate?: (params: any) => { isValid: boolean; errors?: string[] };

  // UI configuration
  formConfig?: VisualFormConfig;
  helpText?: string;
  examples?: ActionExample[];
}

export interface ExecutionContext {
  variables: VariableManager;
  logger: Logger;
  onProgress?: (progress: { step: string; percentage: number }) => void;
  onPartialResult?: (result: any) => void;
  isTest?: boolean;
  mockData?: any;
}
```

2. **Update Registry Methods**:

```typescript
export class ToolPluginRegistry {
  // ... existing methods

  static getAllActions(): ToolAction[] {
    return Array.from(this.plugins.values()).flatMap(
      (plugin) => plugin.actions || [],
    );
  }

  static getActionsByCategory(category: string): ToolAction[] {
    return this.getAllActions().filter(
      (action) => action.category === category,
    );
  }

  static getActionsByType(actionType: string): ToolAction[] {
    return this.getAllActions().filter(
      (action) => action.actionType === actionType,
    );
  }
}
```

#### Task 1.2: Database Schema Extensions (1 day)

**Goal**: Add necessary database schema changes

**Files to Modify**:

- `src/shared/schema.ts`

**Implementation**:

1. **Update EventType Enum**:

```typescript
export enum EventType {
  NODEJS = "NODEJS",
  PYTHON = "PYTHON",
  BASH = "BASH",
  HTTP_REQUEST = "HTTP_REQUEST",
  TOOL_ACTION = "TOOL_ACTION", // New
}
```

2. **Extend Events Table**:

```typescript
export const events = pgTable("events", {
  // ... existing fields
  toolActionConfig: jsonb("tool_action_config"), // New field
});
```

3. **Create Tool Action Logs Table**:

```typescript
export const toolActionLogs = pgTable("tool_action_logs", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id),
  toolType: varchar("tool_type", { length: 50 }).notNull(),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  actionId: varchar("action_id", { length: 100 }).notNull(),
  parameters: jsonb("parameters"),
  result: jsonb("result"),
  status: varchar("status", { length: 20 }).notNull(),
  executionTime: integer("execution_time"), // milliseconds
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});
```

#### Task 1.3: Migration Script (1 day)

**Goal**: Create database migration for schema changes

**Files to Create**:

- `migrations/add_tool_actions.sql`

**Implementation**:

```sql
-- Add tool_action_config column to events table
ALTER TABLE events ADD COLUMN tool_action_config JSONB;

-- Create tool_action_logs table
CREATE TABLE tool_action_logs (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id),
  tool_type VARCHAR(50) NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  action_id VARCHAR(100) NOT NULL,
  parameters JSONB,
  result JSONB,
  status VARCHAR(20) NOT NULL,
  execution_time INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create indexes for performance
CREATE INDEX idx_tool_action_logs_event_id ON tool_action_logs(event_id);
CREATE INDEX idx_tool_action_logs_tool_type ON tool_action_logs(tool_type);
CREATE INDEX idx_tool_action_logs_status ON tool_action_logs(status);
CREATE INDEX idx_tool_action_logs_created_at ON tool_action_logs(created_at);
```

### Week 2: Event Form Integration

#### Task 2.1: Tool Action Form Components (3 days)

**Goal**: Create UI components for tool action configuration

**Files to Create**:

- `src/components/event-form/ToolActionSection.tsx`
- `src/components/event-form/ActionParameterForm.tsx`
- `src/components/event-form/ActionSelector.tsx`

**Implementation**:

1. **ToolActionSection Component**:

```typescript
interface ToolActionSectionProps {
  value: ToolActionConfig | null;
  onChange: (config: ToolActionConfig | null) => void;
  availableTools: Tool[];
}

export function ToolActionSection({
  value,
  onChange,
  availableTools,
}: ToolActionSectionProps) {
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [selectedAction, setSelectedAction] = useState<ToolAction | null>(null);

  // Tool selection dropdown
  // Action selection based on tool
  // Parameter form based on action schema
  // Real-time validation
}
```

2. **ActionParameterForm Component**:

```typescript
interface ActionParameterFormProps {
  action: ToolAction;
  value: Record<string, any>;
  onChange: (params: Record<string, any>) => void;
  isTest?: boolean;
}

export function ActionParameterForm({
  action,
  value,
  onChange,
  isTest,
}: ActionParameterFormProps) {
  // Dynamic form generation based on action.inputSchema
  // Support for different field types (text, number, select, array, object)
  // Real-time validation with Zod
  // Test data population for testing mode
}
```

#### Task 2.2: Event Form Integration (2 days)

**Goal**: Integrate tool action components into existing EventForm

**Files to Modify**:

- `src/components/event-form/EventForm.tsx`

**Implementation**:

1. **Add Tool Action State**:

```typescript
// Add to EventForm state
const [toolActionConfig, setToolActionConfig] =
  useState<ToolActionConfig | null>(
    eventData?.toolActionConfig ? JSON.parse(eventData.toolActionConfig) : null,
  );
```

2. **Add Tool Action Section**:

```typescript
{/* Tool Action Section - only show for TOOL_ACTION type */}
{type === EventType.TOOL_ACTION && (
  <Card>
    <CardHeader>
      <CardTitle>Tool Action Configuration</CardTitle>
    </CardHeader>
    <CardContent>
      <ToolActionSection
        value={toolActionConfig}
        onChange={setToolActionConfig}
        availableTools={availableTools}
      />
    </CardContent>
  </Card>
)}
```

3. **Update Form Submission**:

```typescript
// Include tool action config in form data
const formData = {
  // ... existing fields
  ...(type === EventType.TOOL_ACTION && {
    toolActionConfig: JSON.stringify(toolActionConfig),
  }),
};
```

### Week 3: Backend Integration

#### Task 3.1: tRPC Router Extensions (2 days)

**Goal**: Extend existing tRPC routers to support tool actions

**Files to Modify**:

- `src/server/api/routers/events.ts` (existing router with 9 operations)
- `src/server/api/routers/tools.ts` (existing router with 11 operations)

**Implementation**:

1. **Events Router Extensions**:

```typescript
// Add to existing event validation schemas in events.ts
const toolActionConfigSchema = z.object({
  toolType: z.string(),
  actionId: z.string(),
  toolId: z.number(),
  parameters: z.record(z.any()),
  outputMapping: z.record(z.string()).optional(),
});

// Update existing create/update event procedures
const createEventSchema = z.object({
  // ... existing fields already implemented
  toolActionConfig: z.string().optional(),
});
```

2. **Extend Tools Router**:

```typescript
// Add to existing tools.ts router (11 operations already implemented)
export const toolsRouter = createTRPCRouter({
  // ... existing 11 operations

  // Add new tool action operations
  getAvailableActions: protectedProcedure
    .input(z.object({ toolType: z.string().optional() }))
    .query(async ({ input }) => {
      // Return available actions for tool type
    }),

  validateActionParams: protectedProcedure
    .input(
      z.object({
        actionId: z.string(),
        parameters: z.record(z.any()),
      }),
    )
    .mutation(async ({ input }) => {
      // Validate parameters against action schema
    }),

  executeAction: protectedProcedure
    .input(
      z.object({
        toolId: z.number(),
        actionId: z.string(),
        parameters: z.record(z.any()),
        isTest: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      // Execute tool action
    }),
});
```

**Note**: The existing tRPC infrastructure provides 16 routers with 150+ endpoints, including comprehensive tools and events routers that can be extended for tool actions.

#### Task 3.2: Execution Engine Integration (3 days)

**Goal**: Integrate tool actions into the existing execution engine

**Files to Create**:

- `src/server/execution/toolActionExecutor.ts`
- `src/server/execution/types.ts`

**Implementation**:

1. **Tool Action Executor**:

```typescript
export class ToolActionExecutor {
  async execute(
    event: Event,
    config: ToolActionConfig,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    // Load tool credentials
    // Get action definition
    // Validate parameters
    // Execute action
    // Handle real-time progress
    // Log execution details
    // Return results
  }

  async validateConfig(config: ToolActionConfig): Promise<ValidationResult> {
    // Validate tool exists
    // Validate action exists
    // Validate parameters against schema
  }
}
```

2. **Integration with Main Executor**:

```typescript
// Modify existing execution engine
if (event.type === EventType.TOOL_ACTION) {
  const executor = new ToolActionExecutor();
  const config = JSON.parse(event.toolActionConfig);
  result = await executor.execute(event, config, context);
}
```

### Week 4: Sample Implementation & Testing

#### Task 4.1: Email Actions Implementation (2 days)

**Goal**: Create sample actions for the Email plugin

**Files to Modify**:

- `src/components/tools/plugins/email/email-plugin.tsx`

**Implementation**:

1. **Email Actions Definition**:

```typescript
const emailActions: ToolAction[] = [
  {
    id: "send-email",
    name: "Send Email",
    description: "Send an email message",
    category: "Communication",
    actionType: "create",
    developmentMode: "visual",
    inputSchema: z.object({
      to: z.string().email().or(z.array(z.string().email())),
      subject: z.string().min(1),
      body: z.string().min(1),
      attachments: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({
      messageId: z.string(),
      status: z.enum(["sent", "failed"]),
      timestamp: z.string(),
    }),
    async execute(credentials, params, context) {
      // Implementation
    },
  },
  {
    id: "check-email-status",
    name: "Check Email Status",
    description: "Check the delivery status of a sent email",
    category: "Communication",
    actionType: "search",
    developmentMode: "visual",
    inputSchema: z.object({
      messageId: z.string(),
    }),
    outputSchema: z.object({
      status: z.enum(["delivered", "bounced", "pending"]),
      deliveredAt: z.string().optional(),
    }),
    async execute(credentials, params, context) {
      // Implementation
    },
  },
];

// Update EmailPlugin
export const EmailPlugin: ToolPlugin = {
  // ... existing properties
  actions: emailActions,
  getActionById: (id) => emailActions.find((action) => action.id === id),
  getActionsByType: (type) =>
    emailActions.filter((action) => action.actionType === type),
};
```

#### Task 4.2: Real-time Progress Foundation (2 days)

**Goal**: Implement basic real-time execution feedback

**Files to Create**:

- `src/components/event-form/ExecutionProgress.tsx`
- `src/lib/executionProgress.ts`

**Implementation**:

1. **Progress Component**:

```typescript
interface ExecutionProgressProps {
  isExecuting: boolean;
  progress: ExecutionProgress;
  onCancel?: () => void;
}

export function ExecutionProgress({
  isExecuting,
  progress,
  onCancel,
}: ExecutionProgressProps) {
  // Show execution steps
  // Progress bar
  // Real-time updates
  // Partial results display
}
```

2. **Progress Management**:

```typescript
export class ExecutionProgressManager {
  private subscribers: Set<(progress: ExecutionProgress) => void> = new Set();

  subscribe(callback: (progress: ExecutionProgress) => void) {
    this.subscribers.add(callback);
  }

  updateProgress(step: string, percentage: number, data?: any) {
    const progress = { step, percentage, data, timestamp: Date.now() };
    this.subscribers.forEach((callback) => callback(progress));
  }
}
```

#### Task 4.3: Testing & Validation (1 day)

**Goal**: Create comprehensive tests for Phase 1 components

**Files to Create**:

- `src/__tests__/components/tool-actions/ToolActionSection.test.tsx`
- `src/__tests__/server/toolActionExecutor.test.ts`
- `src/__tests__/components/tool-actions/ActionParameterForm.test.tsx`

**Implementation**:

1. **Component Tests**:

```typescript
describe("ToolActionSection", () => {
  test("renders tool selection dropdown", () => {});
  test("updates action list when tool changes", () => {});
  test("validates parameters in real-time", () => {});
  test("handles form submission correctly", () => {});
});
```

2. **Integration Tests**:

```typescript
describe("ToolActionExecutor", () => {
  test("executes email send action successfully", () => {});
  test("handles validation errors correctly", () => {});
  test("reports progress during execution", () => {});
  test("logs execution details properly", () => {});
});
```

#### Task 4.4: Feature Flag Implementation (1 day)

**Goal**: Implement feature flags for controlled rollout

**Files to Create**:

- `src/lib/featureFlags.ts`

**Implementation**:

```typescript
export const FeatureFlags = {
  TOOL_ACTIONS_ENABLED: process.env.NEXT_PUBLIC_TOOL_ACTIONS_ENABLED === 'true',
  TOOL_ACTIONS_UI_ENABLED: process.env.NEXT_PUBLIC_TOOL_ACTIONS_UI_ENABLED === 'true',
  TOOL_ACTIONS_EXECUTION_ENABLED: process.env.NEXT_PUBLIC_TOOL_ACTIONS_EXECUTION_ENABLED === 'true',
} as const;

// Usage in EventForm
{FeatureFlags.TOOL_ACTIONS_UI_ENABLED && (
  <SelectItem value={EventType.TOOL_ACTION}>
    Tool Action
  </SelectItem>
)}
```

## Success Criteria

### Functional Requirements

- [ ] `TOOL_ACTION` event type can be created and saved
- [ ] Tool action form displays available tools and actions
- [ ] Action parameters are dynamically validated based on schema
- [ ] Basic tool action execution works with email plugin
- [ ] Real-time progress updates during execution
- [ ] Execution logs are properly stored
- [ ] Feature flags control visibility and functionality
- [ ] No regression in existing event types

### Technical Requirements

- [ ] Database schema migrations run successfully
- [ ] All TypeScript types are properly defined
- [ ] tRPC endpoints work correctly
- [ ] Component tests pass
- [ ] Integration tests pass
- [ ] Code follows existing patterns and conventions

### Performance Requirements

- [ ] Form loading time < 2 seconds
- [ ] Tool action execution starts within 1 second
- [ ] Progress updates occur within 500ms intervals
- [ ] No memory leaks in long-running operations

## Risk Mitigation

### High-Risk Areas

1. **Database Migration**: Ensure migrations are reversible and tested
2. **Event Form Complexity**: Keep UI simple and intuitive
3. **Plugin Compatibility**: Maintain backward compatibility with existing plugins
4. **Execution Engine Integration**: Avoid breaking existing event execution

### Mitigation Strategies

1. **Comprehensive Testing**: Unit, integration, and E2E tests
2. **Feature Flags**: Gradual rollout with ability to disable
3. **Code Reviews**: Peer review for all changes
4. **Documentation**: Clear documentation for new interfaces
5. **Rollback Plan**: Ability to revert changes quickly

## Dependencies

### Internal Dependencies

- Stable tRPC infrastructure
- Existing plugin system
- Current event form architecture
- Database migration system

### External Dependencies

- None for Phase 1 (using existing tools)

## Timeline

| Week | Focus                    | Key Deliverables                         |
| ---- | ------------------------ | ---------------------------------------- |
| 1    | Core Architecture        | Enhanced plugin system, database schema  |
| 2    | UI Components            | Tool action form, event form integration |
| 3    | Backend Integration      | tRPC extensions, execution engine        |
| 4    | Implementation & Testing | Sample actions, testing, feature flags   |

## Next Steps

Upon completion of Phase 1:

1. **User Testing**: Gather feedback on UI/UX
2. **Performance Optimization**: Identify and fix bottlenecks
3. **Phase 2 Planning**: Detailed plan for additional tool integrations
4. **Documentation**: Update user documentation
5. **Training**: Prepare team for Phase 2 development

This Phase 1 implementation provides a solid foundation for tool actions while maintaining system stability and setting up for successful subsequent phases.
