# SSH Runner Implementation Plan (Simplified)

## Executive Summary

This plan outlines the rapid implementation of a new SSH runner architecture for Cronium. Since we have no existing users or production deployments, we can make breaking changes and focus on building the correct architecture from the start. The new system will provide runtime helper support and enhanced security through signed binaries.

## Current State Summary

### Existing Architecture

- **Local Execution**: Uses Docker containers with runtime API sidecar for helper functions
- **SSH Execution**: Direct script execution via SSH without runtime helper support
- **Multi-Server**: Events can be associated with multiple servers via `eventServers` table
- **Job Queue**: PostgreSQL-based job queue with orchestrator polling

### Key Limitations

- No runtime helper support for SSH execution
- No resource limits or sandboxing for SSH scripts
- Tool actions inadvertently exposed on SSH targets
- Limited security controls for remote execution

## Implementation Approach

Since we have no existing users, we will:

- Replace the existing SSH executor entirely (no migration needed)
- Build the runner system as the only SSH execution method
- Skip feature flags, gradual rollouts, and compatibility layers
- Focus on core functionality first, add monitoring later

## Implementation Phases

### Phase 1: Runner Binary and Infrastructure

**Duration: 2 weeks**

#### Objectives

- Build the runner binary with core functionality
- Set up basic build pipeline and storage

#### Tasks

- [x] Create runner binary
  - [x] Payload extraction and execution
  - [x] Support for bash, python, node.js scripts
  - [x] Basic logging to stdout/stderr
  - [x] Cleanup on exit
- [x] Set up simple build pipeline
  - [x] Cross-compile for linux/amd64 and linux/arm64 (primary targets)
  - [x] Basic signing with cosign (placeholder implemented)
  - [x] Store artifacts in local filesystem
- [x] Implement payload structure
  - [x] Define manifest.yaml format
  - [x] Create tar.gz packaging
  - [x] Add basic signature verification

### Phase 2: Event Integration and Payload Generation

**Duration: 1.5 weeks**

#### Objectives

- Generate runner payloads when events are created/updated
- Replace existing SSH executor

#### Tasks

- [x] Database updates
  - [x] Add runner_payloads table to track generated payloads
  - [x] Add payload_version to events table
- [x] Payload generation
  - [x] Generate payload on event save/update
  - [x] Store payloads in local filesystem
  - [x] Remove old payloads when events are updated
- [x] Replace SSH executor
  - [x] Remove existing SSH executor code
  - [x] Create new runner-based SSH executor
  - [x] Update job routing to use new executor

### Phase 3: Runtime Helper Support

**Duration: 2 weeks**

#### Objectives

- Add runtime helper support for SSH execution
- Implement both bundled and API modes

#### Tasks

- [x] Create helper binaries
  - [x] cronium.input() implementation
  - [x] cronium.output() implementation
  - [x] cronium.getVariable() implementation
  - [x] cronium.setVariable() implementation
- [x] Bundled mode (for offline execution)
  - [x] Embed helpers in runner binary
  - [x] File-based communication (input.json, output.json)
  - [x] Environment variable injection
- [x] API mode (via SSH tunnel)
  - [x] Add JWT generation for job auth (implemented in orchestrator)
  - [x] Create helper API endpoints (exists in runtime service)
  - [x] Implement SSH reverse tunnel
  - [x] Add fallback to bundled mode
  - [x] Environment variable configuration for API mode

### Phase 4: Multi-Server Support

**Duration: 1 week**

#### Objectives

- Enable parallel execution on multiple servers
- Reuse existing eventServers associations

#### Tasks

- [x] Parallel runner deployment
  - [x] Deploy runner to all associated servers
  - [x] Cache runners per server
  - [x] Handle deployment failures
- [x] Synchronized execution
  - [x] Execute on all servers in parallel
  - [x] Aggregate results
  - [x] Handle partial failures

### Phase 5: Final Integration

**Duration: 1 week**

#### Objectives

- Complete integration and testing
- Basic operational features

#### Tasks

- [x] Error handling
  - [x] Runner deployment failures
  - [x] Execution timeouts
  - [x] Cleanup on failure
- [x] Basic monitoring
  - [x] Log runner version in execution logs
  - [x] Track execution success/failure
  - [x] Simple performance metrics
- [x] Testing
  - [x] Integration tests
  - [x] Multi-server execution tests
  - [x] Helper functionality tests

## Technical Specifications

### Runner Binary Specifications

- **Size**: ~3-5 MB per architecture
- **Dependencies**: None (static binary)
- **Initial OS/Arch**: linux/amd64, linux/arm64 (expand later as needed)
- **Security**: Basic cosign signing

### Payload Specifications

- **Format**: tar.gz archive
- **Contents**: manifest.yaml, user script
- **Size**: Typically < 100 KB
- **Storage**: Local filesystem

### Simplified Requirements

- **Runner deployment**: Working deployment to SSH hosts
- **Payload generation**: Generate on event save
- **Helper support**: Both bundled and API modes
- **Multi-server**: Parallel execution support

## Key Simplifications

### What We're NOT Building (Yet)

- Migration tools (no existing users to migrate)
- Feature flags (direct cutover)
- Monitoring dashboards (use existing logs)
- Gradual rollout infrastructure
- Backward compatibility layers
- Complex caching strategies
- Multiple storage backends

### What We ARE Building

- Runner binary that executes scripts
- Payload generation on event save/update
- Runtime helper support (critical feature)
- Multi-server execution
- Basic error handling and logging

## Timeline Summary

Total Duration: 7-8 weeks

- Phase 1: Weeks 1-2 (Runner Binary)
- Phase 2: Weeks 3-4 (Event Integration)
- Phase 3: Weeks 4-6 (Runtime Helpers)
- Phase 4: Week 7 (Multi-Server)
- Phase 5: Week 8 (Final Integration)

## Resource Requirements

### Development Resources

- 1-2 backend engineers (Go, TypeScript)
- Minimal frontend changes needed

### Infrastructure

- Local development environment
- Basic CI/CD for building runners
- Local filesystem for artifacts

## Success Criteria

- Runner executes scripts via SSH
- Runtime helpers work correctly
- Multi-server execution functions
- Old SSH executor completely replaced
- System is ready for initial deployment

## Conclusion

This simplified plan focuses on rapidly building the core SSH runner functionality. By avoiding unnecessary complexity like migrations, feature flags, and monitoring dashboards, we can deliver the new architecture in 7-8 weeks. The system will be production-ready from day one, with the ability to add monitoring and operational features as needed after deployment.
