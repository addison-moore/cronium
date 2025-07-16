# Cronium Containerized Execution - Stage 1 Revised Plan

## Requirements Summary

### Primary Requirements

1. **Single Container Deployment**: Bundle cronium-agent (orchestrator), Next.js backend, WebSocket server, and Runtime API into a single container
2. **Migrate Test Events**: Ensure all test events work with the new architecture
3. **Optional Dependencies**: Grafana, Prometheus, and Valkey must be completely optional (Postgres remains required)
4. **Valkey-Free Operation**: App must function properly without Valkey
5. **Runtime API Migration**: Deprecate file-based runtime helpers in favor of Runtime API (bundled in main container)
6. **Docker Compose Files**:
   - `docker-compose.dev.yml`: Development environment (`pnpm dev:docker`)
   - `docker-compose.stack.yml`: Example with Postgres and Valkey containers
   - `docker-compose.yml`: Simplified single-container deployment

### Documentation Requirements

Create comprehensive documentation in `docs/container-migration/`:

- System overview with diagrams
- Data flow documentation
- Monitoring setup guide (Prometheus/Grafana)
- Deployment guide

## Current State Analysis

### Architecture Gaps

1. **Multi-Container Architecture**: Currently using 5+ separate containers
2. **Go Orchestrator**: Written in Go, runs as separate service
3. **Hard Valkey Dependency**: App assumes Valkey availability
4. **File-Based Runtime Helpers**: Still present in codebase
5. **Complex Docker Setup**: Multiple interdependent services

### Technical Debt Identified

1. Incomplete Runtime API migration
2. Tightly coupled service dependencies
3. Mixed programming languages (Go/TypeScript)
4. Inconsistent configuration management
5. Legacy file-based execution code

## Implementation Plan

### Phase 1: Technical Debt Remediation

**Goal**: Clean up existing codebase and remove obstacles to single-container deployment

#### Tasks:

- [ ] Audit and document all Valkey dependencies
- [ ] Identify file-based runtime helper usage (check src/runtime-helpers/, src/lib/scheduler/)
- [ ] Map orchestrator-to-app communication points
- [ ] Document all inter-service dependencies
- [ ] Review existing test events for compatibility
- [ ] Identify and list deprecated code for removal

#### Human Intervention Required:

- Decision on orchestrator implementation approach (TypeScript rewrite vs embedded Go)

### Phase 2: Orchestrator Integration

**Goal**: Integrate orchestrator functionality into main application container

#### Option A: TypeScript Rewrite (Recommended)

- [ ] Create TypeScript orchestrator service within Next.js app
- [ ] Port job polling and execution logic
- [ ] Implement Docker container management
- [ ] Port SSH execution capabilities
- [ ] Integrate WebSocket log streaming
- [ ] Implement health checks and monitoring

#### Option B: Embedded Go Binary

- [ ] Create Node.js wrapper for Go orchestrator
- [ ] Implement IPC communication layer
- [ ] Bundle Go binary in Docker image
- [ ] Create process management system
- [ ] Handle lifecycle and health checks

#### Tasks (Common):

- [ ] Remove separate orchestrator container configuration
- [ ] Integrate WebSocket server into main process
- [ ] Update API endpoints for internal communication
- [ ] Consolidate configuration management
- [ ] Update build process for single container with all services
- [ ] Implement process supervisor or service manager

### Phase 3: Runtime API Implementation

**Goal**: Complete migration from file-based to API-based runtime helpers

Based on `runtime_helpers_redesign.md`:

#### Tasks:

- [ ] Review existing Runtime API implementation in runtime/cronium-runtime
- [ ] Integrate Runtime API service into main container (not separate service)
- [ ] Implement all required endpoints:
  - [ ] `getInput()` / `setOutput()`
  - [ ] `getVariable()` / `setVariable()`
  - [ ] `getCondition()` / `setCondition()`
  - [ ] `getEventContext()`
  - [ ] `executeToolAction()`
- [ ] Create authentication/token generation system
- [ ] Implement helper SDKs:
  - [ ] JavaScript/TypeScript SDK
  - [ ] Python SDK
  - [ ] Bash wrapper script
- [ ] Add environment auto-detection (container vs SSH)
- [ ] Implement retry logic and error handling
- [ ] Remove all file-based runtime helper code
- [ ] Update all test events to use Runtime API

### Phase 4: Valkey Decoupling

**Goal**: Make Valkey completely optional for application operation

#### Tasks:

- [ ] Implement in-memory fallback for caching
- [ ] Create abstraction layer for cache operations
- [ ] Add feature detection for Valkey availability
- [ ] Implement graceful degradation
- [ ] Update queue implementation to work without Valkey
- [ ] Test all features with and without Valkey
- [ ] Document performance implications

### Phase 5: Docker Compose Restructuring

**Goal**: Create three deployment configurations as specified

#### Tasks:

- [ ] Create simplified `docker-compose.yml`:
  - [ ] Single 'cronium' container only
  - [ ] External database connection via DATABASE_URL
  - [ ] Minimal configuration
  - [ ] No additional services
- [ ] Update `docker-compose.stack.yml`:
  - [ ] Include Postgres container
  - [ ] Include optional Valkey container
  - [ ] Example production configuration
- [ ] Update `docker-compose.dev.yml`:
  - [ ] Development overrides
  - [ ] Hot reload configuration
  - [ ] Development tools (mailhog, adminer)
  - [ ] Enable `pnpm dev:docker` command
- [ ] Remove monitoring from default setup
- [ ] Create separate monitoring compose file

### Phase 6: Test Migration and Validation

**Goal**: Ensure all functionality works in new architecture

#### Tasks:

- [ ] Migrate all test events to Runtime API
- [ ] Create integration test suite
- [ ] Test local container execution
- [ ] Test SSH remote execution
- [ ] Validate WebSocket log streaming
- [ ] Test with/without optional services
- [ ] Performance benchmarking
- [ ] Security audit of new architecture

### Phase 7: Documentation

**Goal**: Comprehensive documentation for the new architecture

#### Tasks:

- [ ] Create system architecture diagram
- [ ] Document data flow:
  - [ ] Job submission flow
  - [ ] Execution flow (container/SSH)
  - [ ] Log streaming flow
  - [ ] Runtime API interactions
- [ ] Write deployment guide:
  - [ ] Single container setup
  - [ ] Stack deployment
  - [ ] Development setup
  - [ ] Environment variables
- [ ] Create monitoring setup guide:
  - [ ] Prometheus configuration
  - [ ] Grafana dashboards
  - [ ] Alerting setup
- [ ] Migration guide from old architecture
- [ ] Troubleshooting guide

### Phase 8: Cleanup and Finalization

**Goal**: Remove old code and finalize the implementation

#### Tasks:

- [ ] Remove deprecated orchestrator Go code (if rewritten)
- [ ] Remove file-based runtime helper code
- [ ] Clean up unused dependencies
- [ ] Update CI/CD pipelines
- [ ] Final security review
- [ ] Performance optimization
- [ ] Update README and setup instructions

## Success Criteria

1. **Single Container**: App and orchestrator run in one container
2. **Optional Services**: App functions without Valkey, monitoring is optional
3. **Runtime API**: All script execution uses Runtime API, no file-based helpers
4. **Test Coverage**: All test events work in new architecture
5. **Documentation**: Complete documentation in `docs/container-migration/`
6. **Deployment**: Three working docker-compose configurations
7. **Performance**: No significant performance degradation
8. **Security**: No new security vulnerabilities introduced

## Risk Mitigation

1. **Orchestrator Rewrite Risk**:
   - Mitigation: Careful feature parity testing, phased rollout
2. **Docker-in-Docker Complexity**:
   - Mitigation: Use Docker socket mounting with security considerations
3. **Performance Impact**:
   - Mitigation: Benchmark before/after, optimize critical paths
4. **Breaking Changes**:
   - Mitigation: Feature flags, compatibility layer during migration

## Timeline Estimate

- Phase 1: 2-3 days (Technical Debt)
- Phase 2: 5-7 days (Orchestrator Integration)
- Phase 3: 3-4 days (Runtime API)
- Phase 4: 2-3 days (Valkey Decoupling)
- Phase 5: 1-2 days (Docker Compose)
- Phase 6: 2-3 days (Testing)
- Phase 7: 2-3 days (Documentation)
- Phase 8: 1-2 days (Cleanup)

**Total: 3-4 weeks** for complete implementation

## Next Steps

1. Get approval on orchestrator approach (TypeScript rewrite recommended)
2. Begin Phase 1 technical debt audit
3. Set up feature flags for gradual migration
4. Create development branch for Stage 1 implementation
