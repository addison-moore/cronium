# Storage Module Refactoring Plan

## Overview
The storage.ts file has grown to over 2700 lines and needs to be broken down into smaller, more manageable modules. This plan outlines how to reorganize the code into logically grouped modules while maintaining backward compatibility.

## Current Structure Analysis
The storage.ts file currently contains:
- Interface definitions (IStorage, supporting types)
- DatabaseStorage class implementation with methods for:
  - Users (12 methods)
  - Events/Scripts (14 methods)
  - Environment Variables (3 methods)
  - Conditional Actions (9 methods)
  - Logs (10 methods)
  - Servers (7 methods)
  - Event-Server relationships (4 methods)
  - Settings (3 methods)
  - API Tokens (6 methods)
  - Dashboard Stats (1 method)
  - Workflows (6 methods)
  - Workflow Nodes (5 methods)
  - Workflow Connections (5 methods)
  - Workflow Logs (4 methods)
  - Workflow Executions (6 methods)
  - Workflow Execution Events (3 methods)
  - User Variables (7 methods)
  - Password Reset Tokens (4 methods)
  - Webhooks (3 methods)

## Proposed Module Structure

### 1. Core Structure (`/src/server/storage/`)
```
storage/
├── index.ts                    # Main export, IStorage interface, DatabaseStorage class shell
├── types.ts                    # All shared types and interfaces
├── modules/
│   ├── users.ts               # User-related operations
│   ├── events.ts              # Event/Script operations
│   ├── servers.ts             # Server management
│   ├── logs.ts                # Logging operations
│   ├── workflows.ts           # Workflow core operations
│   ├── workflow-nodes.ts      # Workflow node operations
│   ├── workflow-execution.ts  # Workflow execution and events
│   ├── auth.ts                # API tokens & password reset
│   ├── variables.ts           # User variables & environment vars
│   ├── webhooks.ts            # Webhook operations
│   └── system.ts              # Settings & dashboard stats
└── utils/
    └── cache.ts               # Caching utilities (admin user cache)
```

### 2. Module Breakdown Details

#### `index.ts` (Main Export)
- [ ] Export IStorage interface
- [ ] Export DatabaseStorage class that imports and delegates to modules
- [ ] Re-export all types for backward compatibility
- [ ] Maintain storage singleton instance

#### `types.ts` (Type Definitions)
- [ ] Move all interface definitions
- [ ] Move all type aliases and complex types
- [ ] EventWithRelations
- [ ] WorkflowNodeWithEvent
- [ ] WorkflowWithRelations
- [ ] DashboardStats
- [ ] LogFilters
- [ ] WorkflowExecutionEventWithDetails

#### `modules/users.ts` (User Operations)
- [ ] getUser
- [ ] getUserByEmail
- [ ] getUserByUsername
- [ ] getUserByInviteToken
- [ ] getAllUsers
- [ ] getFirstAdminUser (with caching logic)
- [ ] createUser
- [ ] updateUser
- [ ] upsertUser
- [ ] disableUser
- [ ] deleteUser

#### `modules/events.ts` (Event/Script Operations)
- [ ] getEvent
- [ ] getEventWithRelations (with optimized/simple variants)
- [ ] getActiveEventsWithRelations
- [ ] getAllEvents
- [ ] getEventsByServerId
- [ ] canViewEvent
- [ ] canEditEvent
- [ ] createScript
- [ ] updateScript
- [ ] deleteScript
- [ ] Conditional action methods (getSuccess/Fail/Always/Condition)
- [ ] createAction
- [ ] deleteActionsByEventId and variants

#### `modules/servers.ts` (Server Management)
- [ ] getServer
- [ ] getAllServers
- [ ] canUserAccessServer
- [ ] createServer
- [ ] updateServer
- [ ] updateServerStatus
- [ ] deleteServer
- [ ] Event-Server relationship methods

#### `modules/logs.ts` (Logging Operations)
- [ ] getLog
- [ ] getLatestLogForScript
- [ ] getAllLogs
- [ ] getLogs
- [ ] getLogsByEventId
- [ ] getFilteredLogs
- [ ] getDistinctWorkflowsFromLogs
- [ ] createLog
- [ ] updateLog
- [ ] deleteLog

#### `modules/workflows.ts` (Workflow Core)
- [ ] getWorkflow
- [ ] getWorkflowWithRelations
- [ ] getAllWorkflows
- [ ] getWorkflowsUsingEvent
- [ ] createWorkflow
- [ ] updateWorkflow
- [ ] deleteWorkflow

#### `modules/workflow-nodes.ts` (Workflow Nodes & Connections)
- [ ] Node methods (get, getAll, create, update, delete)
- [ ] Connection methods (get, getAll, create, update, delete)

#### `modules/workflow-execution.ts` (Workflow Execution)
- [ ] Workflow log methods
- [ ] Workflow execution methods
- [ ] Workflow execution event methods
- [ ] getUserWorkflowExecutions

#### `modules/auth.ts` (Authentication Related)
- [ ] API token methods
- [ ] Password reset token methods

#### `modules/variables.ts` (Variables Management)
- [ ] Environment variable methods
- [ ] User variable methods

#### `modules/webhooks.ts` (Webhook Operations)
- [ ] getActiveWebhooksForEvent
- [ ] getWebhookDeliveryWithRelations
- [ ] getUserWebhooksWithStats

#### `modules/system.ts` (System Operations)
- [ ] Settings methods
- [ ] getDashboardStats

## Implementation Checklist

### Phase 1: Setup Structure
- [ ] Create `/src/server/storage/` directory
- [ ] Create subdirectories: `modules/`, `utils/`
- [ ] Create `types.ts` and move all type definitions
- [ ] Create empty module files

### Phase 2: Extract Modules (Order of Implementation)
1. [ ] Extract `types.ts` - Move all interfaces and types
2. [ ] Extract `modules/system.ts` - Smallest module, good starting point
3. [ ] Extract `modules/auth.ts` - Self-contained authentication logic
4. [ ] Extract `modules/variables.ts` - Environment and user variables
5. [ ] Extract `modules/webhooks.ts` - Webhook-specific operations
6. [ ] Extract `modules/servers.ts` - Server management
7. [ ] Extract `modules/logs.ts` - Logging operations
8. [ ] Extract `modules/users.ts` - User operations (handle deletion dependencies)
9. [ ] Extract `modules/workflows.ts` - Core workflow operations
10. [ ] Extract `modules/workflow-nodes.ts` - Node and connection operations
11. [ ] Extract `modules/workflow-execution.ts` - Execution-related operations
12. [ ] Extract `modules/events.ts` - Largest module, extract last

### Phase 3: Create Main Files
- [ ] Create `index.ts` with DatabaseStorage class importing all modules
- [ ] Update class to delegate methods to appropriate modules
- [ ] Ensure all exports maintain backward compatibility
- [ ] Create storage singleton instance

### Phase 4: Update Imports
- [ ] Update all imports from `../server/storage` to use new structure
- [ ] Ensure type imports are updated correctly
- [ ] Test that all existing code continues to work

### Phase 5: Cleanup
- [ ] Remove old `storage.ts` file
- [ ] Update any documentation referencing storage.ts
- [ ] Run tests to ensure everything works correctly

## Implementation Notes

1. **Backward Compatibility**: The refactored structure must maintain the same external API. All existing imports of `storage` should continue to work without modification.

2. **Module Dependencies**: Some modules will need to import from others (e.g., events.ts needs types from servers.ts). Keep circular dependencies in mind.

3. **Database Connection**: Each module will need access to the `db` import. Consider passing it as a parameter or importing directly.

4. **Encryption Service**: Modules that handle sensitive data (users, servers, auth) need access to encryption services.

5. **Private Methods**: Methods like `getEventWithRelationsOptimized` should stay within their respective modules as private functions.

6. **Caching**: The admin user cache should be moved to a utility module or kept within the users module.

## Benefits of This Structure

1. **Maintainability**: Each module is focused on a specific domain
2. **Readability**: Easier to find and understand specific functionality
3. **Testing**: Modules can be tested independently
4. **Scalability**: New features can be added to appropriate modules
5. **Team Collaboration**: Different developers can work on different modules without conflicts

## Risks and Mitigation

1. **Risk**: Breaking existing functionality
   - **Mitigation**: Comprehensive testing after each module extraction
   
2. **Risk**: Circular dependencies between modules
   - **Mitigation**: Careful planning of module boundaries and shared types
   
3. **Risk**: Performance impact from module loading
   - **Mitigation**: Use proper imports and ensure tree-shaking works correctly

## Success Criteria

- [ ] All existing tests pass without modification
- [ ] No changes required to consuming code
- [ ] Each module file is under 500 lines
- [ ] Clear separation of concerns between modules
- [ ] Improved developer experience when working with storage layer