# Phase 3: API Mode Implementation Progress

## Overview

This document summarizes the progress made on implementing API mode for runtime helpers in the SSH executor.

## Completed Tasks

### 1. JWT Token Generation

- Created `JWTManager` in `apps/orchestrator/internal/auth/jwt.go`
- Generates JWT tokens with job execution context (jobID, executionID, userID, eventID)
- Tokens are valid for 1 hour (sufficient for most script executions)

### 2. SSH Reverse Tunnel Implementation

- Created `TunnelManager` in `apps/orchestrator/internal/executors/ssh/tunnel.go`
- Establishes reverse SSH tunnels to allow remote scripts to access local runtime API
- Forwards connections from remote port (9090) to local runtime port (8089)
- Handles connection forwarding in both directions

### 3. SSH Executor API Mode Integration

- Modified `executeWithRunner` to support API mode with automatic fallback
- Generates JWT tokens for each execution
- Establishes SSH reverse tunnel when API mode is enabled
- Falls back to bundled mode if tunnel establishment fails
- Passes API configuration via environment variables:
  - `CRONIUM_HELPER_MODE=api`
  - `CRONIUM_API_ENDPOINT=http://127.0.0.1:9090`
  - `CRONIUM_API_TOKEN=<jwt-token>`
  - `CRONIUM_EXECUTION_ID=<execution-id>`

### 4. Runner Helper Configuration

- Updated `SetupHelpers` to check environment variables first, then manifest
- Environment variables take precedence over manifest values
- Supports both API and bundled modes based on configuration
- Logs configuration details for debugging

## Architecture

### API Mode Flow

1. Orchestrator receives SSH job with runner execution
2. SSH executor establishes connection to remote server
3. If API mode is enabled (runtime port and JWT secret configured):
   - Establishes SSH reverse tunnel (remote:9090 -> local:8089)
   - Generates JWT token with execution context
   - Sets environment variables for API mode
4. Runner is deployed to remote server (if not already present)
5. Payload is copied to remote server
6. Runner executes with API mode configuration
7. Runtime helpers communicate with local runtime API via tunnel
8. After execution, tunnel is closed

### Fallback Mechanism

- If tunnel establishment fails, automatically falls back to bundled mode
- If JWT generation fails, falls back to bundled mode
- Bundled mode uses file-based communication (no network required)

## Key Files Modified

1. **JWT Manager**: `apps/orchestrator/internal/auth/jwt.go`
   - JWT token generation for runtime helpers

2. **Tunnel Manager**: `apps/orchestrator/internal/executors/ssh/tunnel.go`
   - SSH reverse tunnel implementation

3. **SSH Executor**: `apps/orchestrator/internal/executors/ssh/executor.go`
   - API mode integration with automatic fallback
   - Environment variable configuration

4. **Runner Helper Setup**: `apps/runner/cronium-runner/internal/executor/helpers.go`
   - Environment variable precedence
   - Configuration logging

## Next Steps

1. **Update Runtime Service** (Pending)
   - Implement execution context endpoints
   - Handle JWT token validation
   - Support helper API calls with execution context

2. **Test API Mode** (Pending)
   - Test with real SSH connections
   - Verify tunnel establishment and communication
   - Test fallback scenarios

3. **Performance Optimization**
   - Consider connection pooling for runtime API
   - Optimize tunnel port allocation
   - Add metrics and monitoring

## Configuration

To enable API mode:

1. Set runtime port in orchestrator config (default: 8089)
2. Set JWT secret in container runtime config
3. Ensure runtime service is accessible on configured port

API mode will be automatically enabled when both runtime port and JWT secret are configured.
