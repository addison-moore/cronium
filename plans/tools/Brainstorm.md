# Tools Architecture Modularity Brainstorm

## Current Architecture Overview

### Core Components

1. **Tool Plugins** (`/src/tools/plugins/`)
   - Each tool (Slack, Email, Discord, etc.) is implemented as a plugin
   - Plugins implement the `ToolPlugin` interface
   - Central registry (`ToolPluginRegistry`) manages all plugins
   - Plugins define credentials schema, actions, and UI components

2. **Integration Points**
   - **Database**: `toolCredentials`, `toolActionLogs`, `toolActionTemplates` tables
   - **API Routes**: Tools router, integrations router, OAuth endpoints
   - **Event System**: TOOL_ACTION event type
   - **UI Components**: Tool management dashboard, event configuration forms
   - **Runtime**: Helper functions for script execution

3. **Execution Flow**
   ```
   Event → Tool Action Executor → Decrypt Credentials → Get Plugin → Execute Action → Log Results
   ```

## Current Challenges for Modularity

### 1. Hardcoded Tool Types
- **Problem**: Tool types (EMAIL, SLACK, DISCORD, WEBHOOK) are hardcoded in multiple places:
  - Database schema enum
  - Integrations router with tool-specific endpoints
  - Validation logic in tools router
  - UI components that switch on tool type

- **Impact**: Adding a new tool requires modifying core files outside the plugin

### 2. Integrations Router Coupling
- **Problem**: The integrations router (`/src/server/api/routers/integrations.ts`) contains tool-specific logic:
  ```typescript
  slack: {
    send: protectedProcedure.input(slackSendSchema).mutation(...)
  },
  discord: {
    send: protectedProcedure.input(discordSendSchema).mutation(...)
  },
  // etc for each tool type
  ```

- **Impact**: Every new tool needs modifications to this central router

### 3. Schema Dependencies
- **Problem**: Tool-specific schemas are defined in shared locations:
  - `/src/shared/schemas/tools.ts` - credential schemas
  - `/src/shared/schemas/integrations.ts` - action schemas

- **Impact**: Schema updates require changes outside the plugin directory

### 4. OAuth and Webhook Handling
- **Problem**: OAuth flows and webhook endpoints are partially centralized:
  - OAuth callback routes need tool-specific handling
  - Webhook verification logic varies by tool

- **Impact**: Complex tools requiring OAuth need core infrastructure changes

### 5. Testing and Validation
- **Problem**: Tool testing logic is split between:
  - Plugin's `test()` method
  - Integrations router test endpoints
  - Tools router validation

- **Impact**: Testing logic is scattered and inconsistent

## Opportunities for Improved Modularity

### 1. Self-Contained Plugin Architecture

**Goal**: Each tool plugin should be a completely self-contained module

**Implementation**:
```typescript
// Each plugin directory contains:
src/tools/plugins/slack/
├── index.ts           // Plugin definition
├── schemas.ts         // All schemas (credentials, actions)
├── actions/           // Action implementations
├── components/        // UI components
├── api/              // API route handlers
├── tests/            // Plugin-specific tests
└── docs/             // Plugin documentation
```

**Benefits**:
- Add new tools by dropping in a plugin directory
- No modifications to core files needed
- Easier to maintain and version plugins

### 2. Dynamic API Route Registration

**Goal**: Plugins can register their own API endpoints

**Implementation**:
```typescript
// In plugin definition
export const SlackPlugin: ToolPlugin = {
  // ... existing properties
  
  apiRoutes: {
    send: {
      input: slackSendSchema,
      handler: async ({ input, ctx }) => {
        // Send logic here
      }
    },
    test: {
      input: testSchema,
      handler: async ({ input, ctx }) => {
        // Test logic here
      }
    }
  }
}

// In tools router
const dynamicRoutes = {};
for (const plugin of ToolPluginRegistry.getAll()) {
  if (plugin.apiRoutes) {
    dynamicRoutes[plugin.id] = createRouter(plugin.apiRoutes);
  }
}
```

**Benefits**:
- No need to modify integrations router for new tools
- Plugins control their own API surface
- Better encapsulation of tool-specific logic

### 3. Plugin-Driven Schema System

**Goal**: Remove hardcoded tool types from database schema

**Implementation**:
```typescript
// Instead of enum ToolType
toolCredentials: {
  toolType: text('tool_type'), // Dynamic string
  // Validate against registered plugins
}

// Plugin provides type identifier
export const SlackPlugin: ToolPlugin = {
  id: 'slack',
  type: 'slack', // Used as toolType
  // ...
}
```

**Benefits**:
- No database migrations for new tools
- Plugins define their own types
- More flexible tool categorization

### 4. Enhanced Plugin Lifecycle

**Goal**: Plugins can hook into application lifecycle

**Implementation**:
```typescript
interface ToolPlugin {
  // ... existing properties
  
  // Lifecycle hooks
  onInstall?: () => Promise<void>;
  onUninstall?: () => Promise<void>;
  onEnable?: () => Promise<void>;
  onDisable?: () => Promise<void>;
  
  // Migration support
  migrations?: {
    version: string;
    up: () => Promise<void>;
    down: () => Promise<void>;
  }[];
}
```

**Benefits**:
- Plugins can set up required resources
- Support for plugin versioning and updates
- Clean uninstallation of plugins

### 5. Plugin Marketplace Architecture

**Goal**: Support external plugin development

**Implementation**:
```typescript
// Plugin manifest
{
  "name": "@cronium/plugin-jira",
  "version": "1.0.0",
  "croniumPlugin": {
    "type": "tool",
    "entry": "./dist/index.js",
    "permissions": ["network", "storage"]
  }
}

// Plugin loader
class PluginLoader {
  async loadFromPackage(packageName: string) {
    const plugin = await import(packageName);
    ToolPluginRegistry.register(plugin.default);
  }
}
```

**Benefits**:
- Community can contribute plugins
- No need to modify core codebase
- Plugin versioning and distribution via npm

### 6. Unified Plugin Configuration

**Goal**: Standardize how plugins store and access configuration

**Implementation**:
```typescript
interface ToolPlugin {
  // Configuration schema
  configSchema?: z.ZodSchema;
  
  // Default configuration
  defaultConfig?: Record<string, unknown>;
  
  // Configuration UI
  ConfigForm?: React.ComponentType;
}

// Centralized config storage
pluginConfigs: {
  pluginId: string;
  config: JSON;
  userId?: number; // User-specific or global
}
```

**Benefits**:
- Consistent configuration management
- Plugins can have global and user settings
- Better separation of credentials and config

### 7. Plugin Communication System

**Goal**: Allow plugins to interact with each other

**Implementation**:
```typescript
// Event-based plugin communication
class PluginEventBus {
  emit(event: string, data: unknown) {
    // Notify interested plugins
  }
  
  on(event: string, handler: Function) {
    // Subscribe to events
  }
}

// In plugin
export const SlackPlugin: ToolPlugin = {
  onInit(eventBus: PluginEventBus) {
    // Subscribe to events from other plugins
    eventBus.on('email:sent', (data) => {
      // Post to Slack about email
    });
  }
}
```

**Benefits**:
- Plugins can build on each other
- Workflow automation between tools
- Extensible integration patterns

## Implementation Recommendations

### Phase 1: Foundation (Minimal Breaking Changes)
1. **Move schemas into plugins** - Each plugin contains its own schemas
2. **Create plugin API route system** - Dynamic route registration
3. **Implement plugin configuration** - Standardized config management
4. **Add plugin lifecycle hooks** - Install/uninstall/enable/disable

### Phase 2: Core Refactoring
1. **Remove hardcoded tool types** - Make database schema dynamic
2. **Deprecate integrations router** - Move logic to plugins
3. **Implement plugin communication** - Event bus system
4. **Create plugin testing framework** - Standardized testing

### Phase 3: Ecosystem Building
1. **Plugin marketplace** - npm-based distribution
2. **Plugin development kit** - CLI and templates
3. **Plugin documentation** - Auto-generated from plugin metadata
4. **Plugin certification** - Security and quality standards

## Migration Strategy

### For Existing Plugins
1. Create migration script to move existing tool logic into plugins
2. Maintain backwards compatibility during transition
3. Deprecate old APIs with clear migration path
4. Provide automated migration tools

### For New Plugins
1. Start with new architecture immediately
2. Create plugin template/generator
3. Document best practices
4. Provide example plugins

## Success Metrics
- Time to add new tool: < 1 hour (no core changes needed)
- Plugin isolation: 100% of tool logic in plugin directory
- Test coverage: Each plugin has isolated tests
- Documentation: Auto-generated from plugin metadata
- Community contributions: External plugins published

## Next Steps
1. Create proof-of-concept with one plugin (e.g., Slack)
2. Get feedback from team
3. Create plugin development guide
4. Begin phased implementation