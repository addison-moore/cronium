# Runtime Helpers Migration Plan

## Overview

This document outlines the plan to complete the migration from the file-based runtime helper system to the API-based communication system. The new system is mostly implemented for containerized execution but requires completion for SSH execution and cleanup of legacy code.

## Current State Summary

### Completed Components

- Runtime API service (Go) with all endpoints
- HTTP-based runtime helper clients (Python, Node.js, Bash)
- Container orchestration with sidecar pattern
- JWT authentication and network isolation
- Container images with pre-installed helpers
- Database migration for events

### Remaining Work

- SSH execution still uses file-based helpers
- Legacy file-based helpers need removal
- Tool Actions integration incomplete
- Documentation updates needed

## Migration Phases

### Phase 1: SSH Execution Migration

#### 1.1 Analyze SSH Execution Requirements

- [ ] Review current SSH executor implementation in `/src/lib/ssh/script-executor.ts`
- [ ] Document how runtime helpers are currently injected for SSH
- [ ] Identify security constraints for SSH execution
- [ ] Determine if Runtime API can be exposed for SSH jobs

#### 1.2 Design SSH Runtime Helper Solution

- [ ] Evaluate options:
  - Option A: Deploy Runtime API service accessible to SSH targets
  - Option B: Keep file-based for SSH but modernize implementation
  - Option C: Hybrid approach with fallback mechanism
- [ ] Document chosen approach with rationale
- [ ] Create security model for SSH runtime helper access

#### 1.3 Implement SSH Runtime Helper Updates

- [ ] Update SSH executor to use chosen approach
- [ ] Ensure backward compatibility during transition
- [ ] Update job payload builder for SSH jobs
- [ ] Handle authentication for SSH runtime API access (if applicable)

### Phase 2: Legacy Code Removal

#### 2.1 Identify Legacy Dependencies

- [ ] Search codebase for references to `/src/runtime-helpers/`
- [ ] List all files importing or using old runtime helpers
- [ ] Identify any hardcoded file paths or legacy constants
- [ ] Check for any UI components displaying old runtime helper code

#### 2.2 Remove File-Based Runtime Helpers

- [ ] Delete `/src/runtime-helpers/cronium.js`
- [ ] Delete `/src/runtime-helpers/cronium.py`
- [ ] Delete `/src/runtime-helpers/cronium.sh`
- [ ] Remove any utility functions for file-based communication
- [ ] Clean up unused imports and dependencies

#### 2.3 Update References

- [ ] Update any documentation referencing old runtime helpers
- [ ] Remove or update example scripts using old syntax
- [ ] Update error messages mentioning file-based helpers
- [ ] Clean up any migration-specific code no longer needed

### Phase 3: Tool Actions Integration

#### 3.1 Review Tool Actions Requirements

- [ ] Analyze current tool action execution flow
- [ ] Identify gaps in Runtime API support for tool actions
- [ ] Document bidirectional communication needs
- [ ] Review security requirements for tool execution

#### 3.2 Enhance Runtime API for Tool Actions

- [ ] Add any missing endpoints for tool action support
- [ ] Implement proper error handling for tool failures
- [ ] Ensure tool output is properly captured
- [ ] Add support for tool-specific environment variables

#### 3.3 Update Tool Action Execution

- [ ] Modify tool action executor to use Runtime API
- [ ] Update tool templates to use new runtime helpers
- [ ] Ensure conditional actions work with tool outputs
- [ ] Validate data flow between tools and events

### Phase 4: System Integration

#### 4.1 Update Job Processing

- [ ] Review job payload structure for all job types
- [ ] Ensure consistent runtime helper injection across all executors
- [ ] Update job transformer for new runtime helper format
- [ ] Validate environment variable propagation

#### 4.2 Orchestrator Updates

- [ ] Review orchestrator's runtime API sidecar creation
- [ ] Ensure proper cleanup of runtime API containers
- [ ] Update network isolation for all execution types
- [ ] Validate JWT token generation and expiration

#### 4.3 Error Handling and Monitoring

- [ ] Implement proper error messages for runtime helper failures
- [ ] Add logging for runtime API communication
- [ ] Create alerts for runtime API service issues
- [ ] Document troubleshooting procedures

### Phase 5: Data Migration

#### 5.1 Identify Affected Data

- [ ] List any stored scripts using old runtime helper syntax
- [ ] Identify workflows dependent on file-based helpers
- [ ] Find any templates with hardcoded helper imports

#### 5.2 Create Migration Strategy

- [ ] Decide on automatic vs manual migration approach
- [ ] Create backup strategy for existing events/workflows
- [ ] Plan rollback procedure if needed
- [ ] Document breaking changes for users

#### 5.3 Execute Data Updates

- [ ] Update event scripts to remove file-based imports
- [ ] Modify workflow configurations as needed
- [ ] Update any stored templates
- [ ] Validate all migrated data works correctly

### Phase 6: Documentation and Communication

#### 6.1 Update Technical Documentation

- [ ] Update `/docs/runtime-helpers/` documentation
- [ ] Revise API documentation for Runtime API
- [ ] Update execution flow documentation
- [ ] Create migration guide for developers

#### 6.2 Update User Documentation

- [ ] Revise getting started guides
- [ ] Update runtime helper examples
- [ ] Create troubleshooting guide
- [ ] Document any breaking changes

#### 6.3 Update UI Help Text

- [ ] Review all UI components mentioning runtime helpers
- [ ] Update inline help and tooltips
- [ ] Ensure example code snippets are current
- [ ] Update any error messages shown to users

### Phase 7: Cleanup and Optimization

#### 7.1 Code Cleanup

- [ ] Remove any temporary migration code
- [ ] Delete unused configuration options
- [ ] Clean up environment variable definitions
- [ ] Remove deprecated API endpoints

#### 7.2 Performance Optimization

- [ ] Profile Runtime API performance
- [ ] Optimize caching strategies
- [ ] Review container startup times
- [ ] Minimize runtime helper client size

#### 7.3 Security Hardening

- [ ] Review JWT token expiration policies
- [ ] Audit network isolation rules
- [ ] Validate input sanitization
- [ ] Ensure no sensitive data in logs

## Implementation Guidelines

### Priority Order

1. SSH execution migration (Phase 1) - Critical for feature parity
2. Tool Actions integration (Phase 3) - Required for full functionality
3. Legacy code removal (Phase 2) - Clean up technical debt
4. System integration (Phase 4) - Ensure robustness
5. Data migration (Phase 5) - Handle existing data
6. Documentation (Phase 6) - User communication
7. Cleanup (Phase 7) - Final optimization

### Breaking Changes

Since the application is in early development with no deployed users:

- We can make breaking changes to event scripts
- Existing workflows may need updates
- No need for extensive backward compatibility

### Rollback Strategy

- Keep file-based helpers available until Phase 2 completion
- Maintain feature flag for runtime helper system if needed
- Document how to manually revert if issues arise

### Success Criteria

- All execution types use the new Runtime API
- No references to file-based helpers in active code
- Tool actions fully integrated with Runtime API
- Documentation reflects current implementation
- All existing events/workflows function correctly

## Timeline Estimation

- Phase 1: 2-3 days (SSH execution migration)
- Phase 2: 1 day (Legacy code removal)
- Phase 3: 2-3 days (Tool Actions integration)
- Phase 4: 2 days (System integration)
- Phase 5: 1 day (Data migration)
- Phase 6: 1-2 days (Documentation)
- Phase 7: 1 day (Cleanup)

**Total: 11-15 days of development work**

## Risk Mitigation

### Technical Risks

- SSH execution may have unique constraints requiring special handling
- Tool action integration complexity may be underestimated
- Performance impact of Runtime API for high-frequency jobs

### Mitigation Strategies

- Implement comprehensive logging during migration
- Create feature flags for gradual rollout if needed
- Monitor system performance during migration
- Have rollback procedures documented

## Conclusion

This plan provides a systematic approach to completing the runtime helpers migration. The focus is on achieving feature parity across all execution types while removing technical debt from the file-based system. By following this plan, we'll have a robust, secure, and maintainable runtime helper system that supports all current and future execution scenarios.
