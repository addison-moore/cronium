# Cronium Agent Implementation Plan

This document outlines the comprehensive plan to implement Cronium's containerized execution architecture using a Go-based orchestrator. Since Cronium is in early development with only test events, this plan focuses on building the system correctly from the start rather than migrating existing production workloads.

## Overview

### Goal

Implement a secure, containerized execution architecture from the ground up, ensuring simplicity and ease of deployment for self-hosted users while avoiding the security vulnerabilities of direct host execution.

### Scope (Stage 1)

- **In Scope:**
  - Local containerized event execution
  - Remote server execution via SSH
  - Go-based orchestrator bundled with Next.js backend
  - Real-time log streaming
  - Backward compatibility with existing features
- **Out of Scope (Deferred to Stage 2):**
  - Remote cronium-agent execution
  - Distributed agent management
  - Complex orchestration features

### Timeline

Estimated duration: 6-8 weeks

**Progress Update (2025-07-11):**

- Phase 1: ✓ Complete (Architecture Review & Analysis)
- Phase 2: ✓ Complete (Orchestrator Design & Planning)
- Phase 3: ~40% Complete (Orchestrator Implementation)
  - Core components and container executor done
  - SSH executor, WebSocket client, and testing remain

---

## Phase 1: Architecture Review & Analysis (Week 1)

### Objectives

- Document current execution flow comprehensively
- Identify all integration points
- Map migration risks and dependencies

### Checklist

- [x] Review and document current event execution flow
  - [x] Local script execution (bash, Node.js, Python)
  - [x] HTTP request execution
  - [x] SSH remote execution
  - [x] Workflow orchestration logic
- [x] Analyze existing code structure
  - [x] Map all files in `src/lib/services/execution/`
  - [x] Document WebSocket communication for logs
  - [x] Review runtime helper implementations
  - [x] Identify database interactions
- [x] Document all API endpoints related to execution
  - [x] Job queue endpoints
  - [x] Status update endpoints
  - [x] Log streaming endpoints
- [x] Create execution flow diagrams
  - [x] Current architecture diagram
  - [x] Data flow diagram
  - [x] Sequence diagrams for each execution type
- [x] Identify technical debt and refactoring opportunities
- [x] Document security vulnerabilities in current implementation

### Deliverables ✓

- [x] Current architecture documentation (phase1-current-architecture-analysis.md)
- [x] Execution flow diagrams (phase1-execution-flow-diagrams.md)
- [x] Technical debt inventory (phase1-technical-debt-inventory.md)
- [x] Risk assessment (phase1-migration-risk-assessment.md)

---

## Critical Findings from Phase 1 Analysis

### Security Vulnerabilities (Must Address)

1. **No execution isolation** - Scripts run directly on host with full system access
2. **Uncontrolled resource usage** - No CPU/memory/disk limits
3. **Shared runtime environment** - Potential data leakage between executions

### Technical Debt (High Priority)

1. **No real-time log streaming** - Logs only available after execution completes
2. **Sequential multi-server execution** - Major performance bottleneck
3. **Poor error handling** - Generic messages, inconsistent patterns
4. **No connection pooling efficiency** - SSH connections not properly reused

### Architecture Gaps

1. **Missing job queue** - Direct synchronous execution blocks API
2. **No retry mechanisms** - Limited fault tolerance
3. **Lack of monitoring** - No metrics or observability

### Opportunities (Greenfield Advantages)

1. **No migration needed** - Can build the right architecture from start
2. **No legacy constraints** - Free to choose optimal solutions
3. **Security-first design** - Implement best practices from day one

---

## Phase 2: Orchestrator Design & Planning (Week 1-2)

### Key Insights from Phase 1

- No real-time log streaming currently exists (critical feature to add)
- Runtime helpers require careful volume mounting and data persistence
- Sequential multi-server execution is a major bottleneck
- No existing production events to migrate (greenfield opportunity)

### Objectives

- Design the Go orchestrator architecture
- Define interfaces and contracts
- Plan integration with existing systems

### Checklist

- [x] Design orchestrator architecture
  - [x] Define executor interface supporting parallel execution
  - [x] Design job queue with priority support
  - [x] Plan container lifecycle management
  - [x] Design real-time log streaming via WebSocket
  - [x] Include connection pooling for SSH
- [x] Define API contracts
  - [x] Job queue API specification (`/api/internal/jobs/queue`)
  - [x] Status update API specification
  - [x] Real-time log streaming protocol
  - [x] Authentication mechanism for orchestrator
  - [x] Metrics and monitoring endpoints
- [x] Plan Docker integration
  - [x] Minimal base images (Alpine-based)
  - [x] Resource limits (CPU: configurable, Memory: 512MB default)
  - [x] Volume strategy for `/tmp/cronium/[executionId]/`
  - [x] Runtime helper embedding strategy
  - [x] Data persistence for workflow state
  - [x] Security: non-root containers, capability dropping
- [x] Design configuration system
  - [x] Environment variables for orchestrator
  - [x] Container resource limit configuration
  - [x] Runtime helper paths
  - [x] Connection pool settings
- [x] Plan error handling and recovery
  - [x] Specific error types (not generic messages)
  - [x] Container crash recovery
  - [x] Network failure handling
  - [x] Graceful shutdown with job completion
  - [x] Circuit breaker for SSH connections

### Deliverables ✓

- [x] Orchestrator architecture document (phase2-orchestrator-architecture.md)
- [x] API contract specifications (phase2-api-contracts.md)
- [x] Docker integration design (phase2-docker-integration.md)
- [x] Configuration specification (phase2-configuration-system.md)
- [x] Error handling and recovery plan (phase2-error-handling-recovery.md)

---

## Phase 3: Orchestrator Implementation (Week 2-4)

### Objectives

- Implement the Go orchestrator with all Stage 1 features
- Ensure robust error handling and logging
- Create comprehensive test suite

### Checklist

- [x] Set up Go project structure
  - [x] Initialize module and dependencies
  - [x] Create directory structure as per plan
  - [x] Build pipeline (manual build working)
  - [ ] Automated test pipeline
- [x] Implement core components
  - [x] Configuration loader (hierarchical with YAML/env support)
  - [x] API client with authentication
  - [x] Job queue poller
  - [x] Executor interface and manager
- [x] Implement executors ✓ COMPLETED
  - [x] Container executor
    - [x] Docker client integration
    - [x] Container lifecycle management
    - [x] Script injection mechanism
    - [x] Environment setup
    - [x] Resource limits enforcement
    - [x] Security options (non-root, capabilities)
    - [x] Real-time log streaming from containers
  - [x] SSH executor
    - [x] Port existing SSH logic
    - [x] Connection pooling with health checks
    - [x] Key management with base64 decoding
    - [x] Session handling with PTY support
    - [x] Circuit breaker implementation
- [x] Implement log streaming ✓ COMPLETED
  - [x] Real-time log capture (from containers and SSH)
  - [x] WebSocket client for backend with auto-reconnect
  - [x] Buffer management for network issues
  - [x] Error handling and exponential backoff
- [x] Implement job lifecycle management ✓ COMPLETED
  - [x] Basic status tracking
  - [x] Timeout handling
  - [x] Resource cleanup (container removal)
  - [x] Result reporting
  - [ ] Enhanced lifecycle features (retries, dependencies) - deferred
- [x] Add monitoring and observability ✓ COMPLETED
  - [x] Structured logging (logrus with JSON)
  - [x] Metrics collection (Prometheus)
  - [x] Health check endpoints (/health, /live, /ready)
  - [x] Metrics endpoint (/metrics)
- [ ] Create comprehensive tests
  - [ ] Unit tests for all components
  - [ ] Integration tests with mock API
  - [ ] Container executor tests
  - [ ] SSH executor tests
  - [ ] End-to-end tests

### Deliverables

- Working orchestrator binary ✓ COMPLETE
- Core functionality test suite (pending - simplified scope)
- Basic deployment documentation for UAT (pending)
- Simple configuration examples (pending)

### Progress Notes (Updated 2025-07-11)

**Phase 3 Core Implementation COMPLETED:**

- ✅ Module path adjusted to actual GitHub repository (github.com/addison-moore/cronium)
- ✅ Container executor fully implemented with Docker integration
- ✅ SSH executor implemented with connection pooling and circuit breaker
- ✅ WebSocket log streaming with automatic reconnection
- ✅ Real-time log streaming from both containers and SSH sessions
- ✅ Resource limits and security features implemented
- ✅ Complete job lifecycle management
- ✅ Health check system with component tracking
- ✅ Prometheus metrics integration throughout

**Key Implementation Details:**

- Container executor: Non-root execution, capability dropping, resource limits, volume mounting
- SSH executor: Connection pooling, circuit breaker pattern, PTY support, key authentication
- Log streaming: WebSocket with reconnection, buffering, batch flushing
- Health checks: Liveness/readiness probes, component health tracking
- Metrics: Job metrics, API metrics, resource metrics, Prometheus integration

**Technical Discoveries:**

- envconfig requires environment variables even when loading from file
- Docker integration working smoothly with proper error handling
- Memory parsing utility implemented for config strings like "512MB"
- Container security features (non-root, capabilities) working as designed
- WebSocket reconnection with exponential backoff handles network issues well
- Circuit breaker pattern effective for SSH connection reliability

**Architecture Decisions:**

- Simplified orchestrator for initial implementation proved effective
- Executor interface pattern allows clean separation of container/SSH logic
- Metrics middleware pattern enables transparent API tracking
- Component-based health checking provides granular system status

**Next Priority:**

- Create focused test suite for core functionality (unit tests for executors, API client)
- Simple deployment documentation for UAT environment
- Direct backend integration without compatibility concerns

---

## Phase 4: Backend Integration (Week 4-5)

### Objectives

- Replace direct execution with orchestrator-based execution
- Update backend to use job queue model
- Create migration script for existing test events

### Checklist

- [ ] Backend API Updates
  - [ ] Remove direct execution code from event service
  - [ ] Implement job creation instead of direct execution
  - [ ] Add orchestrator service token to configuration
  - [ ] Update WebSocket log handling to use orchestrator streams
- [ ] Database schema updates
  - [ ] Add orchestrator_id field to executions table
  - [ ] Add job_id field for tracking
  - [ ] Create simple migration script
  - [ ] Add indexes for job queue queries
- [ ] Update execution flow
  - [ ] Replace synchronous execution with job creation
  - [ ] Update frontend to handle async execution status
  - [ ] Modify execution history to show job status
  - [ ] Remove old SSH execution code
- [ ] Runtime helpers updates
  - [ ] Test cronium.js/py/sh in container environment
  - [ ] Update file paths for container execution
  - [ ] Ensure environment variables work in containers
  - [ ] Document any behavioral changes
- [ ] Simple deployment setup
  - [ ] Create basic Dockerfile for orchestrator
  - [ ] Add orchestrator service to docker-compose.yml
  - [ ] Create example configuration file
  - [ ] Basic health monitoring setup
- [ ] Migration tasks
  - [ ] Write script to migrate existing test events
  - [ ] Update event configuration format if needed
  - [ ] Test all existing event types work correctly
  - [ ] Document any breaking changes

### Simplified Approach Benefits

Since we're in early development with no production users:

- Direct replacement of execution system without compatibility concerns
- Clean removal of old execution code
- Simple migration script for test data only
- No need for feature flags or gradual rollout
- Focus on getting the new system working correctly

### Deliverables

- Updated backend with orchestrator integration
- Simple database migration script
- Basic docker-compose configuration
- Test event migration script
- Updated documentation for new execution model

---

## Phase 5: Testing & Validation (Week 5-6)

### Objectives

- Comprehensive testing of integrated system
- Performance validation
- Security verification

### Checklist

- [ ] Functional testing
  - [ ] Test all event types (bash, Node.js, Python, HTTP)
  - [ ] Test workflow execution
  - [ ] Test variable handling
  - [ ] Test error scenarios
  - [ ] Test timeout handling
- [ ] Integration testing
  - [ ] End-to-end event execution
  - [ ] Log streaming validation
  - [ ] Status update verification
  - [ ] WebSocket communication
  - [ ] Database consistency
- [ ] Performance testing
  - [ ] Load testing with multiple events
  - [ ] Resource usage monitoring
  - [ ] Container startup time
  - [ ] Log streaming latency
  - [ ] API response times
- [ ] Security testing
  - [ ] Container isolation verification
  - [ ] Resource limit enforcement
  - [ ] Script injection attempts
  - [ ] Authentication bypass attempts
  - [ ] Data leak prevention
- [ ] Compatibility testing
  - [ ] Existing event migration
  - [ ] Runtime helper compatibility
  - [ ] SSH execution validation
  - [ ] UI functionality
- [ ] User acceptance testing
  - [ ] Deploy to staging environment
  - [ ] Run real-world scenarios
  - [ ] Gather feedback
  - [ ] Document issues

### Deliverables

- Test results documentation
- Performance benchmarks
- Security audit report
- Bug list and fixes

---

## Phase 6: Initial Deployment (Week 6-7)

### Objectives

- Deploy initial version
- Create example events
- Monitor system stability

### Checklist

- [ ] Prepare migration plan
  - [ ] Backup procedures
  - [ ] Rollback strategy
  - [ ] Communication plan
  - [ ] Downtime windows
- [ ] Update documentation
  - [ ] User migration guide
  - [ ] Administrator guide
  - [ ] Troubleshooting guide
  - [ ] API documentation
- [ ] Deploy to production
  - [ ] Deploy orchestrator
  - [ ] Update backend
  - [ ] Verify configuration
  - [ ] Monitor initial startup
- [ ] Create initial setup
  - [ ] Create example events showcasing features
  - [ ] Set up demo workflows
  - [ ] Configure initial monitoring
  - [ ] Establish baseline metrics
- [ ] Monitor system health
  - [ ] Watch error rates
  - [ ] Monitor performance metrics
  - [ ] Check log streaming
  - [ ] Verify job completion rates
- [ ] User communication
  - [ ] Release notes
  - [ ] Feature announcements
  - [ ] Support documentation
  - [ ] Feedback channels

### Deliverables

- Production deployment
- Migration completion report
- Updated documentation
- Monitoring dashboards

---

## Phase 7: Cleanup & Optimization (Week 7-8)

### Objectives

- Remove legacy code
- Optimize performance
- Prepare for Stage 2

### Checklist

- [ ] Remove legacy code
  - [ ] Remove direct execution code
  - [ ] Clean up old SSH implementation
  - [ ] Remove deprecated APIs
  - [ ] Update tests
- [ ] Code optimization
  - [ ] Profile orchestrator performance
  - [ ] Optimize container startup
  - [ ] Improve log streaming efficiency
  - [ ] Reduce API calls
- [ ] Documentation updates
  - [ ] Archive old documentation
  - [ ] Update architecture diagrams
  - [ ] Create Phase 2 planning docs
  - [ ] Update README files
- [ ] Technical debt reduction
  - [ ] Refactor identified issues
  - [ ] Improve error handling
  - [ ] Add missing tests
  - [ ] Update dependencies
- [ ] Prepare for Stage 2
  - [ ] Document lessons learned
  - [ ] Create Stage 2 requirements
  - [ ] Identify improvement areas
  - [ ] Plan remote agent architecture

### Deliverables

- Cleaned codebase
- Performance improvements
- Updated documentation
- Stage 2 planning documents

---

## Success Criteria

### Technical

- All events execute in isolated containers
- Zero security vulnerabilities from direct execution
- Performance within 10% of current system
- 100% backward compatibility maintained
- All tests passing with >80% coverage

### Operational

- Single container deployment working
- Documentation complete and accurate
- Monitoring and alerting functional
- Development environment documented
- Quick start guide available

### Developer Experience

- Setup time under 5 minutes
- Clear architecture documentation
- Comprehensive error messages
- Debugging workflow documented
- Container overhead under 500ms

---

## Risk Mitigation

### High Priority Risks

1. **Container startup overhead**
   - Mitigation: Optimize base images, implement caching
   - Future: Container pooling in Stage 2
   - Fallback: Increase timeout limits

2. **Initial architecture complexity**
   - Mitigation: Extensive documentation and examples
   - Fallback: Simplified development mode

3. **Debugging complexity**
   - Mitigation: Enhanced logging and container inspection tools
   - Fallback: Development mode with extended access

### Medium Priority Risks

1. **Complex debugging**
   - Mitigation: Enhanced logging and debugging tools
   - Fallback: Direct container access for admins

2. **Resource constraints**
   - Mitigation: Careful resource planning and limits
   - Fallback: Horizontal scaling options

---

## Notes

- This plan focuses on Phase 1 only - local containers and SSH execution
- Remote agent functionality is intentionally deferred to Phase 2
- Emphasis on simplicity and maintainability over complex features
- Security improvements are the primary driver
- User experience must not degrade

## Lessons Learned (Phase 3 Progress)

### What's Working Well

1. **Go Module Structure**: Clean separation of concerns with internal/pkg packages
2. **Docker Integration**: Smooth integration with minimal complexity
3. **Executor Pattern**: Interface-based design allows easy extension
4. **Configuration System**: Hierarchical loading works well (file + env)
5. **Real-time Logging**: Container log streaming implemented successfully

### Challenges Encountered

1. **Environment Variable Requirements**: envconfig requires vars even when using config file
   - **Solution**: May need to make env vars optional or provide defaults
2. **Memory String Parsing**: Config uses strings like "512MB" but Docker needs bytes
   - **Solution**: Implemented parseMemory utility function
3. **Type Conversions**: Docker API uses different types (int64 vs int for exit codes)
   - **Solution**: Added appropriate type conversions

### Recommendations for Next Steps

1. **Testing First**: Before adding more features, create basic tests for existing code
2. **WebSocket Priority**: Log streaming to backend is critical for user experience
3. **Error Handling**: Enhance error messages with more context
4. **Documentation**: Create API documentation as we implement endpoints
5. **Development Mode**: Consider a mode that bypasses container for easier debugging

## References

- [Cronium Agent Architecture v2](./cronium_agent_architecture_v2.md)
- [Go Orchestrator Project Plan](./go_orchestrator_project_plan.md)
- [Orchestrator Phase 1 Summary](./orchestrator_phase_1_summary.md)
- [Phase 1 Architecture Analysis](./phase1-current-architecture-analysis.md)
- [Phase 1 Technical Debt Inventory](./phase1-technical-debt-inventory.md)
- [Phase 1 Risk Assessment](./phase1-migration-risk-assessment.md)
