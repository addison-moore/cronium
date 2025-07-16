# Containerized Execution Fix Plan

## Overview

This plan addresses the issues identified in the Docker logs analysis. The primary blocker is the missing runtime-api Docker image, with several secondary issues that should be addressed for production readiness.

## Priority Classification

- **P0 (Critical)**: Blocks all job execution
- **P1 (High)**: Affects core functionality but has workarounds
- **P2 (Medium)**: Improves reliability and performance
- **P3 (Low)**: Nice to have, development quality improvements

## Issues to Fix

### P0 - Critical Issues

#### 1. Missing Runtime API Docker Image

**Problem**: Jobs fail to execute with "No such image: cronium/runtime-api:latest"

**Impact**: Complete blocker - no jobs can execute

**Fix Checklist**:

- [ ] Verify runtime-api source code exists in runtime/runtime-api directory
- [ ] Check if Dockerfile exists in runtime/runtime-api
- [ ] Build the Docker image with proper tag
- [ ] Verify image is available locally
- [ ] Update docker-compose.dev.yml if needed to ensure image availability
- [ ] Test job execution after image is built

**Verification Steps**:

- [ ] Run docker images and confirm cronium/runtime-api:latest exists
- [ ] Create a test Bash event and verify it executes successfully
- [ ] Check orchestrator logs for successful job completion
- [ ] Verify job status updates to "completed" in database

### P1 - High Priority Issues

#### 2. WebSocket Connection Timeouts

**Problem**: WebSocket connections fail with i/o timeout errors

**Impact**: Real-time log streaming doesn't work, but job execution continues via HTTP polling

**Fix Checklist**:

- [ ] Verify Socket.IO server is properly initialized on port 5002
- [ ] Check WebSocket endpoint configuration in orchestrator
- [ ] Ensure CORS headers allow WebSocket upgrades
- [ ] Verify network connectivity between services in Docker network
- [ ] Add proper error handling for WebSocket failures
- [ ] Implement reconnection with exponential backoff

**Verification Steps**:

- [ ] WebSocket connects without timeout errors
- [ ] Real-time logs appear in the UI during job execution
- [ ] Reconnection works after temporary network issues

### P2 - Medium Priority Issues

#### 3. Service Singleton Pattern

**Problem**: Credential encryption and scheduler services are recreated on each request

**Impact**: Performance degradation and potential memory leaks

**Fix Checklist**:

- [ ] Identify where services are being instantiated
- [ ] Implement proper singleton pattern for credential encryption
- [ ] Implement proper singleton pattern for scheduler service
- [ ] Ensure services are initialized once at startup
- [ ] Add logging to verify single instance creation

**Verification Steps**:

- [ ] Log messages show services initialized only once
- [ ] Memory usage remains stable over time
- [ ] No duplicate scheduler jobs created

#### 4. Next.js 15 Dynamic Route Warnings

**Problem**: Dynamic route parameters need to be awaited

**Impact**: Development warnings, potential issues in production

**Fix Checklist**:

- [ ] Identify all dynamic API routes using params
- [ ] Update routes to await params before use
- [ ] Test all updated routes
- [ ] Verify no warnings in development logs

**Verification Steps**:

- [ ] No "params should be awaited" warnings in logs
- [ ] All API routes function correctly
- [ ] No TypeScript errors related to params

### P3 - Low Priority Issues

#### 5. Tool Credential Validation

**Problem**: Invalid credentials format for tools

**Impact**: Tool integrations (Slack, Discord, Email) may not work

**Fix Checklist**:

- [ ] Review tool credential schema
- [ ] Add validation for credential formats
- [ ] Handle missing credentials gracefully
- [ ] Add clear error messages for invalid formats

**Verification Steps**:

- [ ] No "Invalid credentials format" errors in logs
- [ ] Tools with valid credentials work properly
- [ ] Clear error messages for configuration issues

## Implementation Order

1. **Phase 1 - Unblock Execution** (P0)
   - Build and deploy runtime-api Docker image
   - Verify end-to-end job execution works

2. **Phase 2 - Restore Full Functionality** (P1)
   - Fix WebSocket connections for log streaming
   - Ensure all user-facing features work properly

3. **Phase 3 - Improve Reliability** (P2)
   - Implement singleton patterns
   - Fix Next.js warnings
   - Optimize performance

4. **Phase 4 - Polish** (P3)
   - Fix tool credential validation
   - Clean up any remaining warnings

## Success Criteria

### Minimum Success (P0 Complete)

- [ ] Jobs execute successfully in containers
- [ ] Job status updates properly in database
- [ ] Basic functionality restored

### Full Success (P0-P2 Complete)

- [ ] Jobs execute with real-time log streaming
- [ ] No memory leaks or performance issues
- [ ] No warnings in development logs
- [ ] System is production-ready

## Testing Plan

### Smoke Tests (After P0)

1. Create a Bash event that echoes "Hello World"
2. Execute the event manually
3. Verify job completes successfully
4. Check logs show expected output

### Integration Tests (After P1)

1. Create events of each type (Bash, Python, Node.js, HTTP)
2. Execute each event and verify completion
3. Verify real-time logs appear in UI
4. Test job failure scenarios

### Load Tests (After P2)

1. Create multiple concurrent jobs
2. Verify system handles load properly
3. Monitor memory usage over time
4. Ensure no duplicate executions

## Rollback Plan

If issues arise during fixes:

1. **Runtime API Image Issues**
   - Revert to previous working image if exists
   - Disable containerized execution temporarily
   - Fall back to direct execution (security risk)

2. **WebSocket Issues**
   - Continue using HTTP polling only
   - Disable real-time features temporarily
   - Add user notification about degraded functionality

3. **Service Pattern Issues**
   - Accept performance impact temporarily
   - Monitor for memory issues
   - Plan proper refactoring in next sprint

## Post-Fix Verification

After all fixes are complete:

1. **Functionality Verification**
   - [ ] All event types execute successfully
   - [ ] Logs stream in real-time
   - [ ] Job status updates are accurate
   - [ ] No errors in service logs

2. **Performance Verification**
   - [ ] API response times < 200ms
   - [ ] Memory usage stable over 24 hours
   - [ ] No duplicate job executions
   - [ ] Efficient database queries

3. **User Experience Verification**
   - [ ] UI shows job progress in real-time
   - [ ] Error messages are clear and actionable
   - [ ] System feels responsive
   - [ ] All features work as expected

## Documentation Updates

After fixes are complete:

- [ ] Update deployment documentation
- [ ] Document runtime-api build process
- [ ] Add troubleshooting guide for common issues
- [ ] Update architecture diagrams if needed
