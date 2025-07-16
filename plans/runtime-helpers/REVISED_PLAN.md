# Revised Runtime Helpers Implementation Plan - Local Execution Focus

## Overview

This document outlines the plan to get local event execution working properly with runtime helpers on the cronium-agent (orchestrator). Given that SSH execution will transition to a signed runner binary approach, this plan focuses exclusively on containerized local execution.

## Current State Assessment

### Working Components

- Container executor implementation in orchestrator
- Runtime API sidecar lifecycle management
- JWT authentication and network isolation
- WebSocket log streaming
- HTTP-based runtime helper clients

### Critical Issues Preventing Local Execution

1. **Missing Docker Images**: Runtime container images not built
2. **Incomplete Configuration**: Missing runtime environment variables
3. **Legacy Code**: Old file-based helpers still present
4. **Tool Actions**: Integration incomplete for local execution

## Implementation Phases

### Phase 1: Build and Configure Runtime Infrastructure

#### 1.1 Build Runtime Container Images

- [x] Navigate to `/runtime/container-images/`
- [x] Review Dockerfiles for bash, python, and node images
- [x] Execute build script or create if missing
- [x] Tag images with expected names:
  - `cronium/runner:bash-alpine`
  - `cronium/runner:python-alpine`
  - `cronium/runner:node-alpine`
- [x] Verify images contain runtime helpers at correct paths

#### 1.2 Build Runtime API Image

- [x] Navigate to `/runtime/cronium-runtime/`
- [x] Create Dockerfile if missing
- [x] Build runtime API image as `cronium/runtime-api:latest`
- [x] Verify image includes all required dependencies
- [x] Test image can start successfully

#### 1.3 Update Docker Compose Configuration

- [x] Add missing runtime configuration to `docker-compose.yml`:
  - `CRONIUM_CONTAINER_RUNTIME_IMAGE`
  - `CRONIUM_CONTAINER_RUNTIME_BACKEND_URL`
  - `CRONIUM_CONTAINER_RUNTIME_VALKEY_URL`
  - `CRONIUM_CONTAINER_RUNTIME_JWT_SECRET`
- [x] Ensure valkey service is properly configured
- [x] Verify network connectivity between services

#### Human Intervention Required:

- [x] Generate and set JWT_SECRET environment variable
- [x] Ensure Docker daemon is running and accessible

### Phase 2: Verify Container Execution Flow

#### 2.1 Test Basic Container Execution

- [x] Create simple test event (echo "Hello World")
- [x] Execute event via UI "Run Now" button
- [x] Verify job appears in queue
- [x] Confirm orchestrator claims job
- [x] Check container creation logs
- [x] Validate execution completion

#### 2.2 Debug Container Issues

- [x] Review orchestrator logs for errors
- [x] Check Docker container status during execution
- [x] Verify network creation and cleanup
- [x] Ensure proper image references
- [x] Validate environment variable injection

#### 2.3 Fix Container Execution Problems

- [ ] Update image references if mismatched
- [ ] Correct any network configuration issues
- [ ] Fix environment variable propagation
- [ ] Ensure proper container cleanup

### Phase 3: Runtime Helper Integration

#### 3.1 Verify Runtime API Sidecar

- [x] Confirm sidecar container starts with job
- [x] Check sidecar is accessible from job container
- [x] Verify JWT token generation and injection
- [x] Test sidecar API endpoints manually
- [x] Ensure sidecar cleanup after job completion

#### 3.2 Test Runtime Helper Functions

- [x] Create test event using `cronium.getVariable()`
- [x] Test `cronium.setVariable()` functionality
- [x] Verify `cronium.input()` and `cronium.output()`
- [x] Check `cronium.setCondition()` behavior
- [x] Validate `cronium.event()` metadata access

#### 3.3 Fix Runtime Helper Issues

- [x] Update runtime helper paths if incorrect
- [x] Fix any API communication problems
- [x] Resolve authentication/authorization issues
- [x] Ensure proper error handling
- [x] Validate data persistence

### Phase 4: Remove Legacy Components

#### 4.1 Remove File-Based Helpers

- [x] Delete `/src/runtime-helpers/cronium.js`
- [x] Delete `/src/runtime-helpers/cronium.py`
- [x] Delete `/src/runtime-helpers/cronium.sh`
- [x] Remove any file-based helper utilities

#### 4.2 Update SSH Executor

- [x] Remove file-based helper injection from SSH executor
- [x] Add clear error message about runtime helpers not supported via SSH
- [x] Document SSH limitations until runner implementation
- [x] Update any SSH-specific helper documentation

#### 4.3 Clean Up References

- [x] Search for and remove imports of old helpers
- [x] Update any hardcoded file paths
- [x] Remove legacy configuration options
- [x] Clean up unused dependencies

### Phase 5: Tool Actions for Local Execution

**Note: Tool actions will only be supported for execution in the local orchestrator**

#### 5.1 Review Tool Action Requirements

- [ ] Identify all tool action types (Email, Slack, Discord)
- [ ] Review current tool action execution flow
- [ ] Check tool plugin system integration
- [ ] Verify credential management

#### 5.2 Integrate Tool Actions with Runtime API

- [ ] Ensure tool actions execute in containers
- [ ] Verify runtime API supports tool execution
- [ ] Test tool action environment setup
- [ ] Validate credential decryption in containers
- [ ] Check output capture from tools

#### 5.3 Test Tool Action Execution

**Note: valid credentials have been added to the db for email, slack, and discord testing**

- [ ] Create test event with email tool action
- [ ] Test Slack notification if configured
- [ ] Verify Discord integration if available
- [ ] Ensure conditional actions trigger tools
- [ ] Validate error handling for tool failures

### Phase 6: Conditional Actions and Workflows

#### 6.1 Test Conditional Actions

- [ ] Create event with ON_SUCCESS action
- [ ] Test ON_FAILURE conditional trigger
- [ ] Verify ALWAYS actions execute
- [ ] Test ON_CONDITION with runtime helper
- [ ] Validate data flow between events

#### 6.2 Verify Workflow Execution

- [ ] Create simple two-node workflow
- [ ] Test workflow with conditional connections
- [ ] Verify data passing between nodes
- [ ] Check parallel node execution
- [ ] Validate workflow completion status

#### 6.3 Fix Workflow Issues

- [ ] Resolve any data flow problems
- [ ] Fix conditional evaluation errors
- [ ] Ensure proper node status tracking
- [ ] Validate workflow visualization updates

### Phase 7: System Validation

#### 7.1 End-to-End Testing

- [ ] Execute events of each script type (bash, python, node)
- [ ] Test events with variables and runtime helpers
- [ ] Run events with conditional actions
- [ ] Execute complete workflows
- [ ] Verify log streaming and status updates

#### 7.2 Performance Validation

- [ ] Check container startup time
- [ ] Measure runtime API response time
- [ ] Verify resource limits are enforced
- [ ] Test concurrent job execution
- [ ] Validate cleanup processes

#### 7.3 Error Handling

- [ ] Test timeout behavior
- [ ] Verify error message propagation
- [ ] Check failed job handling
- [ ] Validate retry mechanisms
- [ ] Ensure graceful degradation

### Phase 8: Documentation Updates

#### 8.1 Update Technical Documentation

- [ ] Document working runtime helper system
- [ ] Create troubleshooting guide
- [ ] Update execution flow documentation
- [ ] Document container architecture

#### 8.2 Update User-Facing Content

- [ ] Update example scripts in UI
- [ ] Revise getting started guide
- [ ] Create runtime helper reference
- [ ] Document current SSH limitations

#### 8.3 Migration Documentation

- [ ] Document breaking changes
- [ ] Create migration guide for existing events
- [ ] Note SSH execution limitations
- [ ] Reference future SSH runner plans

## Implementation Guidelines

### Priority Order

1. **Phase 1**: Build runtime infrastructure (Critical - nothing works without this)
2. **Phase 2**: Fix container execution (Required for any functionality)
3. **Phase 3**: Runtime helper integration (Core feature)
4. **Phase 5**: Tool actions (Important for notifications)
5. **Phase 6**: Conditional actions (Enables workflows)
6. **Phase 4**: Legacy cleanup (Technical debt)
7. **Phase 7**: Validation (Quality assurance)
8. **Phase 8**: Documentation (User experience)

### Success Criteria

- Local events execute successfully in containers
- Runtime helpers work for all supported languages
- Tool actions execute properly
- Conditional actions trigger correctly
- Workflows complete with proper data flow
- No references to file-based helpers remain
- System is ready for SSH runner migration

### Known Limitations (Temporary)

- SSH execution will not support runtime helpers
- Tool actions only work for local execution
- Remote execution limited until runner implementation

## Risk Mitigation

### Technical Risks

1. **Docker Image Building**: May require debugging Dockerfile issues
2. **Network Configuration**: Container networking can be complex
3. **Runtime API Stability**: New service may have bugs
4. **Performance Impact**: Sidecar adds overhead

### Mitigation Strategies

- Test each component in isolation first
- Use orchestrator logs extensively for debugging
- Keep container images minimal for performance
- Monitor resource usage during testing

## Timeline Estimation

- Phase 1: 1 day (Building and configuration)
- Phase 2: 1 day (Container execution debugging)
- Phase 3: 1-2 days (Runtime helper integration)
- Phase 4: 0.5 days (Legacy cleanup)
- Phase 5: 1 day (Tool actions)
- Phase 6: 1 day (Conditional actions)
- Phase 7: 1 day (Validation)
- Phase 8: 0.5 days (Documentation)

**Total: 7-8 days of development work**

## Next Steps After Completion

Once local execution is working:

1. Begin SSH runner implementation per `ssh_runner_architecture_recommendation.md`
2. Migrate SSH execution to signed binary approach
3. Deprecate raw SSH script execution
4. Achieve full feature parity across execution types

## Conclusion

This plan focuses on getting local containerized execution fully operational with runtime helpers. By deferring SSH runtime helper support until the runner implementation, we can deliver working functionality faster while maintaining a clear migration path. The emphasis is on building and configuring the existing infrastructure correctly rather than adding new features.
