# SSH Runner Integration: Comprehensive Change List

## Overview

This document outlines all changes required across the Cronium codebase to integrate the proposed SSH runner architecture. Each section details specific modifications needed and key decisions that must be made.

## 1. Database Schema Changes

### New Tables Required

```sql
-- Runner artifacts and versions
CREATE TABLE runner_artifacts (
  id UUID PRIMARY KEY,
  version VARCHAR(255) NOT NULL,
  os VARCHAR(50) NOT NULL,
  arch VARCHAR(50) NOT NULL,
  checksum VARCHAR(255) NOT NULL,
  signature TEXT,
  binary_path TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  UNIQUE(version, os, arch)
);

-- Runner deployments tracking
CREATE TABLE runner_deployments (
  id UUID PRIMARY KEY,
  server_id UUID REFERENCES servers(id),
  runner_version VARCHAR(255) NOT NULL,
  deployed_at TIMESTAMP NOT NULL,
  last_health_check TIMESTAMP,
  status VARCHAR(50) NOT NULL, -- active, failed, updating
  metadata JSONB
);

-- Payload cache
CREATE TABLE execution_payloads (
  id UUID PRIMARY KEY,
  event_id UUID REFERENCES events(id),
  event_version INTEGER NOT NULL,
  checksum VARCHAR(255) NOT NULL,
  payload_path TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  last_used TIMESTAMP,
  size_bytes BIGINT
);
```

### Existing Table Modifications

```sql
-- Jobs table additions
ALTER TABLE jobs ADD COLUMN runner_id UUID REFERENCES runner_deployments(id);
ALTER TABLE jobs ADD COLUMN payload_id UUID REFERENCES execution_payloads(id);
ALTER TABLE jobs ADD COLUMN execution_mode VARCHAR(50); -- 'direct-ssh', 'runner-ssh', 'container'

-- Logs table additions  
ALTER TABLE logs ADD COLUMN runner_version VARCHAR(255);
ALTER TABLE logs ADD COLUMN stream_started_at TIMESTAMP;
ALTER TABLE logs ADD COLUMN partial_output TEXT; -- For streaming logs
ALTER TABLE logs ADD COLUMN runner_metadata JSONB; -- Runner diagnostics
```

## 2. Log System Changes

### Log Streaming Infrastructure

**New Components:**
- `src/server/runner-websocket.ts` - WebSocket handler for runner log streams
- `src/lib/services/log-stream-service.ts` - Manages streaming log sessions
- `src/lib/services/log-aggregator.ts` - Aggregates partial logs into complete records

**Modified Components:**
- `src/server/logs-websocket.ts` - Add runner stream support
- `src/lib/services/log-service.ts` - Handle partial log updates
- `src/shared/schema.ts` - Add new log statuses: STREAMING, PARTIAL

### UI Components

**EventLogsTab.tsx Modifications:**
```typescript
// Add real-time log streaming
const [streamingLogs, setStreamingLogs] = useState<Map<string, string>>();
const [isStreaming, setIsStreaming] = useState<boolean>(false);

// WebSocket connection for live logs
useEffect(() => {
  if (selectedLog?.status === 'RUNNING' || selectedLog?.status === 'STREAMING') {
    const ws = new WebSocket(`/api/logs/stream/${selectedLog.id}`);
    // Handle streaming updates
  }
}, [selectedLog]);
```

**New Status Types:**
- PENDING - Job claimed by runner, not started
- STREAMING - Execution started, logs streaming
- PARTIAL - Execution interrupted, partial results available

## 3. Workflow System Changes

### Workflow Executor Modifications

**src/lib/workflows/workflow-executor.ts:**
- Add runner assignment logic for SSH nodes
- Handle runner communication failures
- Implement retry logic for runner deployments
- Support parallel execution on multiple runners

**New Workflow Node Properties:**
```typescript
interface WorkflowNode {
  // Existing properties...
  executionMode?: 'auto' | 'direct-ssh' | 'runner-ssh' | 'container';
  runnerRequirements?: {
    minVersion?: string;
    capabilities?: string[];
  };
}
```

### Workflow Condition Handling
- Modify condition evaluation to work with streaming data
- Add support for partial results in condition checks
- Implement timeout handling for runner communication

## 4. API Endpoint Changes

### New API Routes

```typescript
// Runner management endpoints
router.get('/api/runners/artifacts/:os/:arch/latest')
router.post('/api/runners/deployments/:serverId/status')
router.get('/api/runners/health/:deploymentId')

// Payload management
router.post('/api/payloads/generate')
router.get('/api/payloads/:id/download')

// Helper API for runners
router.post('/api/helpers/variables/:id')
router.get('/api/helpers/download/:type/:version')

// Streaming endpoints
router.ws('/api/logs/stream/:logId')
router.post('/api/logs/:logId/partial')
```

### Modified Endpoints

**src/server/api/routers/events.ts:**
- Add runner deployment status to event execution info
- Include payload generation in event save/update

**src/server/api/routers/system.ts:**
- Add runner health metrics
- Include runner deployment statistics

## 5. UI Component Updates

### New Components

```typescript
// Runner status indicator
components/runner/RunnerStatusBadge.tsx
components/runner/RunnerHealthIndicator.tsx

// Streaming log viewer
components/logs/StreamingLogViewer.tsx
components/logs/LogStreamIndicator.tsx

// Runner management
components/admin/RunnerManagement.tsx
components/admin/RunnerDeployments.tsx
```

### Modified Components

**EventDetailsPage.tsx:**
- Add runner status section
- Show execution mode selector
- Display runner deployment warnings

**LogDetailsPage.tsx:**
- Real-time streaming log viewer
- Runner diagnostics panel
- Partial result handling

**ServerDetailsPage.tsx:**
- Runner deployment status
- Runner version management
- Deployment history

## 6. Monitoring and Telemetry

### New Metrics

```typescript
// Runner metrics
runner_deployments_total
runner_deployments_failed
runner_health_check_duration
runner_artifact_cache_hits
runner_artifact_cache_misses
runner_payload_generation_duration

// Execution metrics
ssh_runner_execution_duration
ssh_runner_connection_failures
streaming_log_latency
partial_log_recovery_count
```

### Health Checks

```typescript
interface RunnerHealthCheck {
  runnerId: string;
  serverId: string;
  version: string;
  lastCheck: Date;
  status: 'healthy' | 'degraded' | 'unhealthy';
  metrics: {
    cpuUsage: number;
    memoryUsage: number;
    diskSpace: number;
    executionQueue: number;
  };
}
```

## 7. Service Layer Changes

### New Services

**src/lib/services/runner-service.ts:**
```typescript
class RunnerService {
  deployRunner(serverId: string, version?: string): Promise<DeploymentResult>
  checkRunnerHealth(deploymentId: string): Promise<HealthStatus>
  updateRunnerStatus(deploymentId: string, status: RunnerStatus): Promise<void>
  getCompatibleRunner(serverId: string, requirements?: RunnerRequirements): Promise<RunnerDeployment>
}
```

**src/lib/services/payload-service.ts:**
```typescript
class PayloadService {
  generatePayload(event: Event): Promise<Payload>
  cachePayload(payload: Payload): Promise<void>
  getPayload(eventId: string, version: number): Promise<Payload | null>
  cleanupOldPayloads(ttlDays: number): Promise<number>
}
```

### Modified Services

**JobService:**
- Add runner assignment logic
- Handle runner-specific job states
- Support streaming status updates

**SSHService:**
- Separate runner deployment from script execution
- Add runner binary transfer methods
- Implement SSH tunnel management

## 8. Configuration Changes

### Environment Variables

```bash
# Runner configuration
RUNNER_ARTIFACT_PATH=/var/cronium/runners
RUNNER_CACHE_TTL_DAYS=90
RUNNER_DEFAULT_VERSION=1.0.0
RUNNER_HEALTH_CHECK_INTERVAL=60

# Helper API configuration
HELPER_API_PORT=8081
HELPER_JWT_SECRET=<secret>
HELPER_DOWNLOAD_TIMEOUT=30

# Streaming configuration
LOG_STREAM_BUFFER_SIZE=65536
LOG_STREAM_TIMEOUT=300
```

### Application Settings

```typescript
interface RunnerSettings {
  enabled: boolean;
  defaultExecutionMode: 'auto' | 'direct-ssh' | 'runner-ssh';
  artifactCachePath: string;
  deploymentTimeout: number;
  healthCheckInterval: number;
  fallbackToDirect: boolean;
}
```

## 9. Migration Strategy

### Feature Flags

```typescript
enum FeatureFlag {
  SSH_RUNNER_ENABLED = 'ssh_runner_enabled',
  SSH_RUNNER_STREAMING_LOGS = 'ssh_runner_streaming_logs',
  SSH_RUNNER_AUTO_DEPLOY = 'ssh_runner_auto_deploy',
  SSH_RUNNER_FALLBACK = 'ssh_runner_fallback'
}
```

### Migration Steps

1. **Phase 1**: Deploy runner infrastructure (artifacts, deployments)
2. **Phase 2**: Enable runner for new events only
3. **Phase 3**: Migrate existing events with user consent
4. **Phase 4**: Enable streaming logs
5. **Phase 5**: Deprecate direct SSH execution

## 10. Key Decisions Required

### Architecture Decisions

1. **Runner Version Strategy**
   - Auto-update vs manual deployment
   - Version compatibility matrix
   - Rollback mechanisms

2. **Caching Strategy**
   - Payload retention period
   - Cache invalidation rules
   - Storage location (S3, local, hybrid)

3. **Security Model**
   - JWT token lifetime for helpers
   - Certificate management for signing
   - Network isolation requirements

### Operational Decisions

1. **Monitoring Thresholds**
   - Runner health check frequency
   - Failure tolerance before fallback
   - Alert escalation rules

2. **Resource Limits**
   - Maximum concurrent runners per server
   - Payload size limits
   - Stream buffer sizes

3. **User Experience**
   - Migration communication strategy
   - Opt-in vs opt-out for new features
   - Backward compatibility duration

## 11. Testing Requirements

### New Test Suites

```typescript
// Runner deployment tests
src/tests/runner/deployment.test.ts
src/tests/runner/health-check.test.ts

// Streaming log tests
src/tests/logs/streaming.test.ts
src/tests/logs/aggregation.test.ts

// Integration tests
src/tests/integration/runner-workflow.test.ts
src/tests/integration/runner-fallback.test.ts
```

### E2E Test Scenarios

1. Runner deployment and job execution
2. Streaming log delivery latency
3. Fallback to direct SSH on runner failure
4. Multi-runner workflow execution
5. Runner version upgrade process

## Conclusion

The SSH runner integration requires extensive changes across all layers of the application. The most critical areas are:

1. **Database schema** for tracking runners and payloads
2. **Log streaming infrastructure** for real-time updates
3. **UI components** for monitoring runner status
4. **Service layer** for managing runner lifecycle
5. **API endpoints** for runner communication

Success depends on careful planning of the migration strategy, comprehensive testing, and clear communication with users about the benefits and changes.