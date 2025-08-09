# SSH Runner Implementation - Complete Summary

## Overview

The SSH runner implementation has been successfully completed across 5 phases, transforming Cronium's remote script execution from a simple SSH command executor to a sophisticated, production-ready system with payload caching, runtime helpers, multi-server support, and comprehensive error handling.

## Key Changes Made

### 1. Core Infrastructure

#### Runner Binary (`apps/runner/cronium-runner`)

- **Standalone Go binary** (3-5 MB) that executes on remote servers
- **No dependencies** - statically compiled for portability
- **Multi-architecture support** - Linux AMD64/ARM64
- **Manifest-driven execution** - Reads YAML configuration for script metadata
- **Built-in runtime helpers** - Bundled implementations for offline execution

#### Payload System (`apps/cronium-app/src/lib/services/payload-service.ts`)

- **Tar.gz archives** containing manifest.yaml and user script
- **SHA256 checksumming** for integrity verification
- **Filesystem caching** in `storage/payloads/` directory
- **Version tracking** via `payload_version` column in events table
- **Automatic regeneration** on script changes

#### SSH Executor (`apps/orchestrator/internal/executors/ssh/`)

- **Connection pooling** for efficient SSH connection reuse
- **Runner deployment caching** to avoid redundant transfers
- **Multi-server parallel execution** with result aggregation
- **Retry logic** with exponential backoff
- **Comprehensive metrics** tracking execution and deployment statistics

### 2. Runtime Helper System

The system provides two modes for runtime helpers:

#### Bundled Mode (Default)

- Helpers compiled into the runner binary
- File-based communication (input.json, output.json, variables.json)
- Works completely offline
- No external dependencies

#### API Mode (When Available)

- SSH reverse tunnel to runtime service
- JWT-authenticated REST API calls
- Real-time access to platform data
- Live variable updates
- Tool action execution

#### Available Helpers

```bash
cronium.input <key>           # Get input data from previous events
cronium.output <key> <value>  # Set output data for next events
cronium.getVariable <name>    # Retrieve user/global variables
cronium.setVariable <name> <value>  # Update variables
cronium.event <field>         # Access event metadata (id, name, etc.)
```

### 3. Database Schema Updates

```sql
-- New column in events table
ALTER TABLE events ADD COLUMN payload_version INTEGER DEFAULT 1 NOT NULL;

-- New table for payload tracking
CREATE TABLE runner_payloads (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES events(id),
    version INTEGER,
    hash VARCHAR(64),
    path VARCHAR(512),
    size INTEGER,
    created_at TIMESTAMP
);
```

## Execution Flow

### 1. Event Trigger

```mermaid
User/Schedule → Cronium App → Job Queue → Orchestrator
```

### 2. Job Preparation (Cronium App)

```typescript
1. Generate payload if needed (PayloadService)
   - Create manifest.yaml with event metadata
   - Bundle user script
   - Create tar.gz archive
   - Calculate SHA256 hash
   - Store in filesystem

2. Transform job for orchestrator
   - Add payload path to metadata
   - Include server credentials
   - Set execution parameters
```

### 3. SSH Execution (Orchestrator)

```go
1. Connection Management
   - Get connection from pool or create new
   - Authenticate with private key

2. Runner Deployment (with caching)
   - Check RunnerCache for existing deployment
   - If not cached or outdated:
     - Create /tmp/cronium directory
     - Transfer runner binary via SCP
     - Make executable (chmod +x)
     - Verify deployment
   - Update cache entry

3. Payload Transfer
   - Copy payload.tar.gz to remote server
   - Place in /tmp/cronium/payloads/

4. API Mode Setup (if configured)
   - Generate JWT token for execution
   - Establish SSH reverse tunnel
   - Configure environment variables:
     CRONIUM_API_ENDPOINT=http://localhost:9090
     CRONIUM_API_TOKEN=<jwt-token>
     CRONIUM_EXECUTION_ID=<exec-id>

5. Script Execution
   - Run: /tmp/cronium-runner-<version> /tmp/cronium/payloads/<job-id>.tar.gz
   - Stream stdout/stderr in real-time
   - Monitor for timeout (context deadline)
   - Handle cancellation gracefully

6. Cleanup
   - Remove payload file
   - Close SSH session
   - Return connection to pool
   - Record metrics
```

### 4. Runner Execution (On Remote Server)

```go
1. Extract Payload
   - Untar payload.tar.gz
   - Parse manifest.yaml
   - Validate structure

2. Setup Helpers
   - Check for API mode (env vars)
   - If API mode: Configure HTTP client
   - If bundled: Prepare file I/O

3. Prepare Environment
   - Write input.json
   - Write variables.json
   - Set PATH for helper binaries

4. Execute Script
   - Detect script type (bash, python, node, etc.)
   - Run with appropriate interpreter
   - Capture output

5. Collect Results
   - Read output.json
   - Read updated variables.json
   - Package execution results
```

### 5. Multi-Server Execution

```go
For multiple servers:
1. Deploy runner to all servers (parallel, with caching)
2. Execute on all servers concurrently (goroutines)
3. Aggregate results:
   - Collect logs with server prefixes
   - Track individual exit codes
   - Determine overall status:
     - All success → SUCCESS
     - Some success → PARTIAL SUCCESS
     - All fail → FAILED
4. Report aggregated metrics
```

## Error Handling & Recovery

### Deployment Failures

- **3 retry attempts** with exponential backoff (2s, 4s, 8s)
- **Partial deployment cleanup** on failure
- **Verification step** after deployment
- **Cache invalidation** on errors

### Execution Timeouts

- **Configurable timeout** per job (default: 1 hour)
- **Graceful shutdown** sequence (SIGTERM → wait 5s → SIGKILL)
- **Timeout vs cancellation** detection
- **Proper cleanup** even on timeout

### Connection Management

- **Connection pool** with health checks
- **Automatic reconnection** on failure
- **Pool size limits** to prevent resource exhaustion
- **Idle connection timeout** (5 minutes)

### Multi-Server Failures

- **Independent execution** per server
- **Partial success handling**
- **Detailed failure reporting** per server
- **Continue on failure** option

## Performance Optimizations

### Caching Strategies

1. **Runner Deployment Cache**
   - Avoids redeploying runner on every execution
   - 24-hour cache validity
   - Version-based invalidation

2. **Payload Cache**
   - Reuses payloads for unchanged scripts
   - SHA256-based change detection
   - Automatic cleanup of old payloads

3. **Connection Pool**
   - Reuses SSH connections
   - Reduces authentication overhead
   - Configurable pool size (default: 10)

### Parallel Processing

- Multi-server deployments in parallel
- Concurrent script execution
- Async log streaming
- Batch metric recording

## Metrics & Monitoring

### Tracked Metrics

```go
type ExecutorMetrics struct {
    // Execution metrics
    totalExecutions      int64
    successfulExecutions int64
    failedExecutions     int64
    timeoutExecutions    int64

    // Deployment metrics
    totalDeployments      int64
    successfulDeployments int64
    failedDeployments     int64
    cachedDeployments     int64

    // Performance metrics
    executionDurations   map[string]time.Duration
    deploymentDurations  map[string]time.Duration
}
```

### Observability

- Runner version logged at execution start
- Deployment attempts logged with retry count
- Cache hit/miss rates calculated
- Periodic metric dumps (every 10 executions)

## Testing Coverage

### Unit Tests

- `executor_test.go` - SSH executor logic
- `runner_cache_test.go` - Cache operations
- `metrics_test.go` - Metric tracking

### Integration Tests

- `helpers_test.sh` - Runtime helper functionality
- Multi-server execution scenarios
- Timeout and cancellation handling
- Error recovery patterns

### Test Helpers

```bash
# Run Go tests
cd apps/orchestrator
go test ./internal/executors/ssh/...

# Run helper tests
cd apps/runner/cronium-runner
./test/helpers_test.sh
```

## Future Improvements

### High Priority

1. **Runner Auto-Updates**
   - Implement version checking on execution
   - Automatic runner binary updates
   - Gradual rollout support
   - Rollback capability

2. **Enhanced Security**
   - Code signing for runner binaries (cosign)
   - Encrypted payload storage
   - Audit logging for all operations
   - SSH key rotation support

3. **Performance Enhancements**
   - Runner binary compression (UPX)
   - Differential payload updates
   - Persistent runner process (daemon mode)
   - WebSocket-based log streaming

### Medium Priority

4. **Extended Platform Support**
   - Windows runner support
   - macOS runner support
   - Additional architectures (MIPS, RISC-V)
   - Container-based execution option

5. **Advanced Features**
   - Script dependency management
   - Resource limit enforcement (CPU, memory)
   - Execution checkpointing/resume
   - Distributed execution coordination

6. **Developer Experience**
   - Local runner testing mode
   - Script debugging support
   - Performance profiling
   - Execution replay capability

### Low Priority

7. **Operational Features**
   - Runner health checks
   - Automatic cleanup scheduling
   - Deployment verification cron
   - Metric export (Prometheus/OpenTelemetry)

8. **Integration Enhancements**
   - Direct cloud provider integration (AWS SSM, GCP OS Login)
   - Kubernetes job execution
   - Ansible playbook support
   - Terraform provider

## Migration Path

For existing Cronium installations:

1. **Database Migration Required**

   ```bash
   cd apps/cronium-app
   pnpm db:push  # Adds payload_version column and runner_payloads table
   ```

2. **No Breaking Changes**
   - Old SSH execution still works (backward compatible)
   - Gradual migration to runner-based execution
   - Existing scripts continue to function

3. **Recommended Steps**
   - Run database migration
   - Test with single server first
   - Enable multi-server execution gradually
   - Monitor metrics for performance validation

## Conclusion

The SSH runner implementation transforms Cronium's remote execution capabilities from a basic SSH command executor to an enterprise-ready system with:

- **Reliability**: Retry logic, timeout handling, graceful degradation
- **Performance**: Caching, connection pooling, parallel execution
- **Scalability**: Multi-server support, resource management
- **Observability**: Comprehensive metrics, detailed logging
- **Security**: Isolated execution, JWT authentication, secure transfers
- **Developer-Friendly**: Runtime helpers, multiple language support

The system is production-ready and provides a solid foundation for Cronium's automation platform, enabling reliable script execution across distributed infrastructure while maintaining security and performance.
