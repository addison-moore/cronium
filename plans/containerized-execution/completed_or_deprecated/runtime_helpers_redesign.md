# Cronium Runtime Helpers Redesign Proposal

## Overview

This proposal defines a new architecture for Cronium's runtime helpers system that is fully compatible with the redesigned event orchestrator written in Go. The new design ensures secure and consistent execution of user scripts across local Docker containers and remote SSH environments, while simplifying the deployment process into a single container.

---

## Objectives

- Eliminate security vulnerabilities of file-based runtime helpers
- Unify helper behavior across all environments (container and SSH)
- Securely deliver input/output, variables, and metadata to scripts
- Avoid transmitting secrets via SSH or embedding them in raw script files
- Keep setup minimal for early adopters while enabling future scaling

---

## Architecture Overview

### Components

1. **Runtime API Service**
   - Exposes an HTTP-based API for runtime data access (input, output, variables, context)
   - Bundled inside the main Cronium container alongside the orchestrator and backend

2. **Runtime Helper SDKs**
   - Lightweight language wrappers (Python, JS, Bash) that communicate with the Runtime API
   - Automatically detect execution mode (container or remote SSH)

3. **Orchestrator (cronium-agent)**
   - Written in Go, embedded in the main container
   - Coordinates event execution locally (Docker) and remotely (via SSH)
   - Injects scoped credentials and environment config at execution time

4. **Execution Environments**
   - **Local Container**: Docker-based job runner on the same host
   - **Remote SSH**: Scripts run via SSH on a user-defined remote server

---

## Data Flow

### Local Container Execution

1. Orchestrator launches Docker container for job
2. Injects ephemeral token + service URL into container
3. Script uses helper SDK to securely call Runtime API
   - `getInput()` → pulls input data
   - `getVariable()` → fetches scoped secrets from server
   - `setOutput()` → transmits results back to backend

### Remote SSH Execution

1. Orchestrator uploads job script via SSH
2. Injects ephemeral token + API URL as environment variables
3. Script uses helper SDK to call Runtime API over HTTPS
   - Secrets never sent over SSH or embedded in the script
   - All data access goes through scoped, time-limited API tokens

Example injected environment:

```bash
export CRONIUM_API_URL=https://your-cronium.com/runtime-api
export CRONIUM_EXECUTION_TOKEN=eyJhbGciOi...
```

---

## Security Model

- **Short-lived tokens** scoped to job execution
- **No direct file injection of secrets** to scripts or SSH targets
- HTTPS + authentication for all API communication
- Read-only mode enforced on remote execution if needed
- Audit logging and rate limits on sensitive operations

---

## Unified Runtime Helper SDK

### Features

- Environment autodetection (local container vs SSH)
- Retry logic and timeouts
- OpenAPI-generated clients for consistency across languages
- Optional stub/fake mode for local dev and testing

### Supported Operations

```ts
interface RuntimeAPI {
  getInput(): Promise<any>;
  setOutput(data: any): Promise<void>;
  getVariable(key: string): Promise<any>;
  setVariable(key: string, value: any): Promise<void>;
  setCondition(condition: boolean): Promise<void>;
  getCondition(): Promise<boolean>;
  getEventContext(): Promise<EventContext>;
  executeToolAction(config: ToolActionConfig): Promise<any>;
}
```

---

## Migration Strategy

### Phase 1: Compatibility Layer

- Maintain file-based helper support temporarily
- Introduce API-based SDKs with auto-fallback behavior

### Phase 2: Gradual Rollout

- Add feature flags to toggle between old and new behavior
- Offer script conversion tools and usage guidance

### Phase 3: Full Migration

- Deprecate file-based execution logic
- Lock down secure-only runtime access

---

## Future Expansion

This architecture is modular and prepares Cronium for distributed multi-agent execution in future stages:

- `cronium-agent` can push jobs to other agents (e.g. agent-to-agent)
- Runtime API can support additional transports (gRPC, streams)
- Token/permission model supports team/org isolation and secrets scoping

---

## Conclusion

This redesign offers a secure, consistent, and extensible runtime helper architecture for Cronium. It fully supports containerized and SSH-based execution, aligns with single-container deployment goals, and eliminates the need to transmit sensitive data over insecure channels. The API-driven model provides a strong foundation for future scalability and advanced runtime features.
