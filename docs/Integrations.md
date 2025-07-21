# Integrations vs Tools in Cronium

This document clarifies the distinction between "integrations" and "tools" in the Cronium application architecture.

## Overview

While the terms "integrations" and "tools" are sometimes used interchangeably in the codebase, they represent different layers of the same system:

- **Tools** = Stored credentials and configurations for external services
- **Integrations** = The API layer that handles communication with external services

## Tools (User-Facing Concept)

**What they are**: Tools are saved configurations that users create to connect Cronium with external services.

**Key characteristics**:

- Stored in the `toolCredentials` database table
- Contains encrypted credentials (API keys, webhook URLs, OAuth tokens)
- Created and managed by users via `/dashboard/tools`
- Each tool has a name, type (EMAIL, SLACK, DISCORD, WEBHOOK), and encrypted credentials
- Can be activated/deactivated
- Used by events to perform actions

**Example**: A user creates a "Marketing Slack" tool that contains:

```json
{
  "name": "Marketing Slack",
  "type": "SLACK",
  "credentials": {
    "webhookUrl": "https://hooks.slack.com/services/...",
    "channel": "#marketing-alerts"
  }
}
```

## Integrations (API/Service Layer)

**What they are**: Integrations are the service layer that handles the actual communication with external APIs.

**Key characteristics**:

- Implemented in `src/server/api/routers/integrations.ts`
- Provides tRPC endpoints for sending messages
- Contains the business logic for formatting and sending data
- Handles rate limiting, retries, and error handling
- Currently uses mock implementations for testing

**Example**: When an event wants to send a Slack message:

1. Event references a tool (e.g., "Marketing Slack" tool ID: 123)
2. Tool action executor retrieves and decrypts the tool's credentials
3. Integration API (`integrations.slack.send`) is called with the credentials and message
4. Integration handles the HTTP request to Slack's API

## The Relationship

```
User creates Tool → Tool stores credentials → Event uses Tool → Integration API sends message
```

1. **Tool Creation**: User configures external service credentials
2. **Tool Storage**: Credentials are encrypted and stored in database
3. **Event Configuration**: User selects a tool for their TOOL_ACTION event
4. **Execution**: Event runs → retrieves tool credentials → calls integration API
5. **Integration**: Handles the actual API communication

## Architecture Layers

```
┌─────────────────────────┐
│     User Interface      │ ← Users create/manage tools
├─────────────────────────┤
│    Tool Management      │ ← CRUD operations on tools
├─────────────────────────┤
│   Event Configuration   │ ← Events reference tools
├─────────────────────────┤
│  Tool Action Executor   │ ← Retrieves credentials, orchestrates
├─────────────────────────┤
│   Integration APIs      │ ← Handles external communication
├─────────────────────────┤
│   External Services     │ ← Slack, Discord, Email, etc.
└─────────────────────────┘
```

## Key Differences

| Aspect               | Tools                         | Integrations             |
| -------------------- | ----------------------------- | ------------------------ |
| **Purpose**          | Store credentials             | Handle API communication |
| **User interaction** | Direct (create, edit, delete) | Indirect (via events)    |
| **Database**         | Yes (`toolCredentials`)       | No (service layer)       |
| **Contains**         | Encrypted credentials         | API logic                |
| **Managed by**       | Users                         | Developers               |

## Tool Plugins

Tool plugins bridge the gap between tools and integrations:

- Define available actions for each tool type
- Provide UI components for configuration
- Define credential schemas
- Map tool configurations to integration API calls

Located in `src/components/tools/plugins/`, each plugin (e.g., `SlackPlugin`, `EmailPlugin`) defines:

- Available actions (send message, create task, etc.)
- Parameter schemas
- Configuration UI
- Execution logic that calls the integration API

## Summary

- **Tools** are user-created credential stores for external services
- **Integrations** are the API layer that communicates with those services
- **Tool Plugins** define what actions are available and how to configure them
- When an event runs, it uses a **tool's** credentials to call an **integration** API

This separation allows:

- Multiple tools of the same type (e.g., multiple Slack workspaces)
- Secure credential storage separate from execution logic
- Flexibility in adding new integration types
- Clear separation of concerns between configuration and execution
