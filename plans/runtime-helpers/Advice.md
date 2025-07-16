# Cronium Runtime Helpers Redesign Proposal

## Overview

This document outlines a proposed redesign of Cronium's runtime helper system to align with the new containerized orchestrator architecture and support both local and remote (SSH) event execution. The redesign aims to enhance security, improve performance, and provide a unified, extensible developer experience.

---

## Goals

- Eliminate security risks associated with file-based helpers and host execution
- Enable consistent runtime APIs across languages and execution environments
- Improve support for streaming, large data, and tool integration
- Maintain backward compatibility via a migration path

---

## Proposed Architecture

### Runtime API

Replace file-based communication with an HTTP-based Runtime API, accessible via SDKs:

```ts
interface RuntimeAPI {
  getInput(): Promise<any>;
  setOutput(data: any): Promise<void>;
  getVariable(key: string): Promise<any>;
  setVariable(key: string, value: any): Promise<void>;
  setCondition(condition: boolean): Promise<void>;
  getCondition(): Promise<boolean>;
  getEventContext(): Promise<EventContext>;
  streamInput(): AsyncIterator<any>;
  streamOutput(): WritableStream;
  executeToolAction(config: ToolActionConfig): Promise<any>;
}
```

### Deployment Modes

- **Container Execution**: Helpers communicate with a local sidecar service using mTLS
- **Remote SSH Execution**: Helpers communicate with a public Runtime API URL using scoped execution tokens

---

## Security Model

### Container Execution

- Non-root containers with read-only root filesystems
- mTLS-secured communication to sidecar runtime API
- Scoped short-lived tokens for authentication

### Remote SSH Execution

- Tokens injected at runtime via env vars
- HTTPS-based API communication
- Rate limiting, namespacing, and audit logging enforced by backend

---

## Runtime Helper SDKs

### Common Features

- Auto-detect execution environment (container or SSH)
- Built-in retry and error handling
- Language wrappers: Python, JS, Bash
- SDKs generated from OpenAPI spec for consistency

### Stub Mode (Local Dev)

- Fallback to mock interfaces for local testing
- Supports `.env` injection for variables and input/output mocking

---

## Tool Actions Integration

- Tool actions can be executed from scripts via `cronium.executeToolAction()`
- Tool actions can modify runtime variables
- Shared execution context enables transactional consistency

---

## Migration Strategy

### Phase 1: Compatibility Layer

- Build API-compatible adapters for legacy helpers
- Detect execution environment and fallback to file-based I/O if needed

### Phase 2: Dual Operation

- Roll out new SDKs with feature flags
- Monitor usage and performance
- Offer migration tools for script authors

### Phase 3: Deprecation

- Deprecate file-based helpers
- Remove legacy I/O support from orchestrator
- Finalize security hardening and runtime contracts

---

## SSH Runtime Support

### Env Vars Injected:

- `CRONIUM_API_URL=https://your-cronium.com/runtime-api`
- `CRONIUM_EXECUTION_TOKEN=<scoped-token>`

### Limitations:

- Read-only variable access by default
- No tool action execution (unless agent is installed)
- No streaming APIs

### Optional: cronium-agent-lite

- Small daemon on remote host
- Provides persistent secure channel
- Enables full helper functionality including tool actions and streaming

---

## Implementation Priorities

### High

- API-based runtime service
- Container security and isolation
- Remote SSH token-based execution

### Medium

- Enhanced variable metadata and schema support
- Streaming and large data transfer APIs
- Unified Tool Action integration

### Low

- Debugging, replay, and step-through execution
- L1/L2 caching layers
- Snapshotting and rollback support

---

## Conclusion

This redesign modernizes Cronium's runtime helpers to support secure, scalable, and extensible workflows across both containerized and remote execution environments. It balances innovation with compatibility and sets the foundation for future features like step debugging, rollback, and advanced observability.
