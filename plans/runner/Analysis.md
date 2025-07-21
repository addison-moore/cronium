# Analysis: SSH Runner Architecture Recommendation

## Executive Summary

This document provides a comprehensive analysis of the proposed SSH Runner architecture for Cronium, examining its impact on the current system architecture, implementation considerations, and potential consequences. The proposal represents a significant architectural shift from direct SSH script execution to a managed runner-based model that would enhance security, reliability, and feature parity with containerized execution.

## Current Architecture Overview

### Job Execution Flow
Cronium currently employs a decoupled job execution architecture:
1. **Job Creation**: Events trigger job creation in a PostgreSQL queue
2. **Orchestrator Polling**: Go-based orchestrators poll and claim jobs
3. **Execution Routing**: Jobs are routed to either container or SSH executors
4. **Status Updates**: Real-time updates via WebSocket to the UI

### SSH Execution Limitations
The current SSH implementation has several critical limitations:
- **No Runtime Helper Support**: Although helper code is injected, it's not fully functional
- **Security Concerns**: Direct script execution without sandboxing
- **No Real-time Streaming**: Logs are only available after completion
- **Limited Resource Control**: No ability to enforce memory/CPU limits
- **Tool Action Exposure**: Unintended security risk on untrusted hosts

## Proposed Architecture Analysis

### Core Improvements
The runner-based architecture addresses fundamental limitations:
1. **Security**: Signed binaries and payloads with cosign verification
2. **Feature Parity**: Full runtime helper support via API calls
3. **Resource Control**: Ability to enforce limits via ulimit or systemd
4. **Real-time Communication**: Streaming logs and status updates
5. **Tool Action Isolation**: Explicit blocking of tool actions on SSH targets

### Implementation Complexity
The proposal introduces significant complexity in several areas:
1. **Binary Management**: Cross-compilation for multiple architectures
2. **Caching Strategy**: Per-host runner caching with version management
3. **Payload Generation**: Dynamic payload creation on event changes
4. **Authentication**: JWT-based auth for helper API calls
5. **Network Tunneling**: SSH port forwarding for helper communication

## Impact Analysis

### Positive Impacts

#### Enhanced Security
- Signed binaries prevent tampering
- JWT-scoped access to variables and APIs
- Isolation between job executions
- No direct database access from remote hosts

#### Improved User Experience
- Real-time log streaming
- Consistent behavior across execution modes
- Better error reporting and diagnostics
- Resource usage monitoring

#### Operational Benefits
- Reduced SSH connection overhead
- Better job tracking and monitoring
- Simplified debugging with runner logs
- Centralized artifact management

### Challenges and Risks

#### Implementation Complexity
- Significant development effort (6 phases)
- Complex build and signing pipeline
- Multiple runtime helper delivery modes
- SSH tunnel management complexity

#### Operational Overhead
- Runner binary distribution and updates
- Artifact storage and cleanup
- Additional monitoring requirements
- Increased troubleshooting complexity

#### Compatibility Concerns
- Breaking change for existing SSH executions
- Migration period with dual-mode support
- Potential issues with restrictive SSH environments
- Dependencies on host capabilities (temp storage, execution permissions)

## Unintended Consequences

### System-Wide Changes Required

#### Database Schema
- New tables for runner artifacts and versions
- Extended job payload structure
- Runner deployment tracking

#### API Modifications
- New endpoints for runner communication
- Helper API with JWT validation
- Artifact download endpoints

#### UI Components
- Real-time log viewer updates
- Runner status indicators
- New error states and messages
- Migration warnings for users

#### Monitoring and Alerting
- Runner health metrics
- Signature verification failures
- Artifact cache performance
- SSH tunnel stability

### Workflow System Impact
- Modified execution flow for SSH targets
- Potential latency increase from runner setup
- Complex error handling for runner failures
- Changes to workflow condition evaluation

### Log Management
- Streaming log architecture changes
- Partial log storage during execution
- Log aggregation from multiple sources
- Retention policy adjustments

## Alternative Approaches

### Minimal Enhancement Option
Instead of full runner architecture:
- Implement streaming logs via SSH
- Add basic resource limits via SSH commands
- Improve helper injection security
- Keep direct SSH execution model

### Hybrid Approach
- Use runners only for complex scripts
- Direct SSH for simple commands
- Gradual migration path
- Lower implementation risk

## Recommendations

### Implementation Strategy
1. **Phase 0**: Prototype runner with basic functionality
2. **Measure Impact**: Test performance and compatibility
3. **Gradual Rollout**: Start with opt-in beta
4. **Feature Flags**: Allow fallback to direct SSH
5. **Monitoring First**: Implement comprehensive monitoring before full rollout

### Risk Mitigation
1. **Extensive Testing**: Cover various SSH configurations
2. **Rollback Plan**: Maintain direct SSH path during transition
3. **Documentation**: Comprehensive guides for troubleshooting
4. **Support Tools**: Runner diagnostic utilities

### Success Criteria
- Performance parity with direct SSH
- 90%+ runner deployment success rate
- Real-time log delivery < 500ms latency
- Zero security incidents from runner vulnerabilities

## Conclusion

The SSH Runner architecture represents a significant improvement in security, functionality, and user experience. However, it introduces substantial complexity that must be carefully managed. The implementation should prioritize:

1. **Security**: The primary benefit justifying the complexity
2. **Reliability**: Ensuring runner deployment doesn't become a failure point
3. **Performance**: Maintaining or improving execution speed
4. **User Experience**: Seamless transition with clear benefits

The phased migration approach is sound, but each phase should include comprehensive testing and the ability to pause or rollback if issues arise. The architecture should be implemented with careful consideration of the operational burden it introduces and the need for robust monitoring and troubleshooting capabilities.