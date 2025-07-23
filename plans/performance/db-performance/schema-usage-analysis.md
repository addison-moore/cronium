# Schema Usage Analysis

This document analyzes which exports from `src/shared/schema.ts` are actually being used throughout the codebase.

## Summary of Findings

### Most Frequently Used Imports

1. **Enums** (Heavy Usage):
   - `EventStatus` - Used in 30+ files for event state management
   - `UserRole` - Used in 15+ files for authorization
   - `EventType` - Used in 20+ files for event type definitions
   - `TimeUnit` - Used in 10+ files for scheduling
   - `RunLocation` - Used in 10+ files for execution location
   - `LogStatus` - Used in 10+ files for log state
   - `ConditionalActionType` - Used in event conditional logic
   - `WorkflowTriggerType` - Used in workflow components
   - `UserStatus` - Used in user management
   - `TokenStatus` - Used in API token management
   - `ToolType` - Used in tools/integrations
   - `ConnectionType` - Used in workflow connections

2. **Tables** (Direct Usage):
   - `users` - Used in auth, admin, and user management
   - `events` - Used throughout for event operations
   - `logs` - Used in logging and monitoring
   - `servers` - Used in server management
   - `workflows` - Used in workflow components
   - `systemSettings` - Used in settings management
   - `templates` - Used in template management
   - `toolCredentials` - Used in integrations
   - `roles` - Used in role management
   - `envVars` - Used in environment variable handling
   - `apiTokens` - Used in API authentication

3. **Types** (Heavy Usage in storage.ts and API layers):
   - `User`, `InsertUser`
   - `Event`, `InsertEvent` (aliased as Script/InsertScript)
   - `Log`, `InsertLog`
   - `Server`, `InsertServer`
   - `Workflow`, `InsertWorkflow`
   - `WorkflowNode`, `InsertWorkflowNode`
   - `WorkflowConnection`, `InsertWorkflowConnection`
   - `WorkflowLog`, `InsertWorkflowLog`
   - `WorkflowExecution`, `InsertWorkflowExecution`
   - `WorkflowExecutionEvent`, `InsertWorkflowExecutionEvent`
   - `ConditionalAction`, `InsertConditionalAction`
   - `Setting`, `InsertSetting`
   - `ApiToken`, `InsertApiToken`
   - `PasswordResetToken`, `InsertPasswordResetToken`
   - `Tool`, `InsertTool`
   - `Template`, `InsertTemplate`
   - `UserVariable`, `InsertUserVariable`
   - `EventServer`, `InsertEventServer`

### Rarely or Never Used Exports

1. **Relations** - All relation exports (e.g., `usersRelations`, `eventsRelations`, etc.) appear to be unused directly in the codebase, likely only used internally by Drizzle ORM

2. **Some Tables**:
   - `passwordResetTokens` - Limited usage
   - `sessions` - Might be used by auth library internally
   - `userSettings` - Limited direct usage
   - `eventServers` - Used mainly in storage layer
   - `conditionalActions` - Used mainly in storage layer
   - `workflowExecutionEvents` - Used mainly in storage layer

### Usage Patterns

1. **Storage Layer** (`src/server/storage.ts`):
   - Imports almost all types and tables
   - Primary consumer of Insert\* types
   - Uses tables directly for database operations

2. **API Routers** (`src/server/api/routers/*`):
   - Primarily import enums for validation
   - Sometimes import types for type safety

3. **Components** (`src/components/*`):
   - Heavy usage of enums for UI logic
   - Rarely import types directly (use API response types instead)

4. **Type Definitions** (`src/types/*`):
   - Import enums to compose application types
   - Create wrapper types around schema types

5. **Library Functions** (`src/lib/*`):
   - Import specific enums and types as needed
   - Often create abstraction layers over schema types

## Recommendations

1. **Keep All Enums** - They are heavily used throughout the codebase for type safety

2. **Keep All Types** - Even if not directly imported everywhere, they provide type safety through the storage layer

3. **Consider Removing**:
   - Relation exports could potentially be moved to a separate file since they're not used directly
   - Some legacy aliases like `Script`/`InsertScript` could be removed in favor of `Event`/`InsertEvent`

4. **Potential Optimizations**:
   - Group related exports (e.g., all workflow-related types together)
   - Create barrel exports for common combinations (e.g., all event-related enums)
   - Consider splitting into multiple files: enums.ts, tables.ts, types.ts, relations.ts
