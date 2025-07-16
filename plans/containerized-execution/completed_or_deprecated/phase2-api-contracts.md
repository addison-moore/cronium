# Phase 2: API Contracts Specification

## Overview

This document defines the API contracts between the Cronium backend (Next.js) and the Go orchestrator. These APIs enable job queue management, status updates, log streaming, and system monitoring.

## Authentication

All API requests from the orchestrator to the backend must include authentication:

```http
Authorization: Bearer <service-token>
X-Service-Name: cronium-orchestrator
X-Service-Version: 1.0.0
```

## Base Configuration

```yaml
# API Base URLs
api:
  baseUrl: http://localhost:5001/api/internal
  wsUrl: ws://localhost:5001/api/socket
  timeout: 30s
  retryAttempts: 3
```

## 1. Job Queue API

### 1.1 Poll Pending Jobs

Retrieves pending jobs from the queue for execution.

**Endpoint:** `GET /api/internal/jobs/queue`

**Query Parameters:**

```typescript
interface PollJobsParams {
  limit?: number; // Max jobs to retrieve (default: 10, max: 50)
  priority?: number; // Minimum priority (0-10)
  types?: JobType[]; // Filter by job types
  orchestratorId: string; // Unique orchestrator instance ID
}
```

**Response:**

```typescript
interface PollJobsResponse {
  jobs: QueuedJob[];
  metadata: {
    timestamp: string;
    nextPollAfter?: string; // Suggested next poll time
    queueSize: number; // Total pending jobs
  };
}

interface QueuedJob {
  id: string;
  type: "script" | "http" | "workflow";
  priority: number;
  createdAt: string;
  scheduledFor?: string;
  attempts: number;
  execution: ExecutionConfig;
  metadata: Record<string, any>;
}

interface ExecutionConfig {
  target: {
    type: "local" | "server";
    serverId?: string;
    serverDetails?: ServerDetails;
  };
  script?: {
    type: "bash" | "python" | "node";
    content: string;
    workingDirectory?: string;
  };
  http?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: any;
  };
  environment: Record<string, string>;
  timeout: number; // seconds
  resources?: {
    cpuLimit?: number; // CPU cores (e.g., 0.5, 1.0)
    memoryLimit?: number; // Bytes
    diskLimit?: number; // Bytes
  };
  retryPolicy?: {
    maxAttempts: number;
    backoffType: "fixed" | "exponential";
    backoffDelay: number; // seconds
  };
}

interface ServerDetails {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKey: string; // Base64 encoded
  passphrase?: string; // Encrypted
}
```

**Example Request:**

```bash
GET /api/internal/jobs/queue?limit=10&priority=5&orchestratorId=orch-abc123
Authorization: Bearer <token>
```

**Example Response:**

```json
{
  "jobs": [
    {
      "id": "job-123",
      "type": "script",
      "priority": 8,
      "createdAt": "2024-01-15T10:00:00Z",
      "attempts": 0,
      "execution": {
        "target": {
          "type": "local"
        },
        "script": {
          "type": "bash",
          "content": "echo 'Hello World'",
          "workingDirectory": "/tmp"
        },
        "environment": {
          "USER_VAR": "value"
        },
        "timeout": 300,
        "resources": {
          "cpuLimit": 0.5,
          "memoryLimit": 536870912
        }
      }
    }
  ],
  "metadata": {
    "timestamp": "2024-01-15T10:00:00Z",
    "nextPollAfter": "2024-01-15T10:00:01Z",
    "queueSize": 15
  }
}
```

### 1.2 Acknowledge Job Receipt

Confirms that the orchestrator has received and will process a job.

**Endpoint:** `POST /api/internal/jobs/{jobId}/acknowledge`

**Request Body:**

```typescript
interface AcknowledgeRequest {
  orchestratorId: string;
  timestamp: string;
  estimatedStartTime?: string;
}
```

**Response:**

```typescript
interface AcknowledgeResponse {
  success: boolean;
  lease: {
    expiresAt: string; // Job lease expiration
    renewalToken: string; // Token for lease renewal
  };
}
```

### 1.3 Renew Job Lease

Extends the processing lease for long-running jobs.

**Endpoint:** `POST /api/internal/jobs/{jobId}/lease/renew`

**Request Body:**

```typescript
interface RenewLeaseRequest {
  renewalToken: string;
  extensionSeconds: number;
  progress?: {
    percentage?: number;
    message?: string;
  };
}
```

## 2. Job Status API

### 2.1 Update Job Status

Updates the execution status of a job.

**Endpoint:** `PUT /api/internal/jobs/{jobId}/status`

**Request Body:**

```typescript
interface UpdateStatusRequest {
  status: JobStatus;
  timestamp: string;
  details?: {
    message?: string;
    exitCode?: number;
    error?: ErrorDetails;
    output?: OutputSummary;
    metrics?: ExecutionMetrics;
  };
}

type JobStatus =
  | "acknowledged"
  | "preparing"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

interface ErrorDetails {
  type: string;
  message: string;
  stack?: string;
  retryable: boolean;
}

interface OutputSummary {
  stdout: {
    lines: number;
    bytes: number;
    truncated: boolean;
  };
  stderr: {
    lines: number;
    bytes: number;
    truncated: boolean;
  };
}

interface ExecutionMetrics {
  startTime: string;
  endTime?: string;
  duration?: number; // milliseconds
  resourceUsage?: {
    peakCpu?: number; // percentage
    peakMemory?: number; // bytes
    networkRx?: number; // bytes
    networkTx?: number; // bytes
  };
}
```

**Response:**

```typescript
interface UpdateStatusResponse {
  success: boolean;
  timestamp: string;
  nextAction?: "retry" | "cancel" | "continue";
}
```

### 2.2 Complete Job Execution

Marks a job as fully completed with final results.

**Endpoint:** `POST /api/internal/jobs/{jobId}/complete`

**Request Body:**

```typescript
interface CompleteJobRequest {
  status: "completed" | "failed";
  exitCode: number;
  output: {
    stdout: string; // Base64 encoded if binary
    stderr: string; // Base64 encoded if binary
  };
  artifacts?: {
    variables?: Record<string, any>;
    files?: FileArtifact[];
  };
  metrics: ExecutionMetrics;
  timestamp: string;
}

interface FileArtifact {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  content?: string; // Base64 encoded for small files
  uploadUrl?: string; // Pre-signed URL for large files
}
```

## 3. Log Streaming API

### 3.1 WebSocket Connection

Establishes WebSocket connection for real-time log streaming.

**Endpoint:** `ws://localhost:5001/api/socket/orchestrator`

**Connection Protocol:**

```typescript
// Initial handshake
interface HandshakeMessage {
  type: "authenticate";
  payload: {
    token: string;
    orchestratorId: string;
    version: string;
  };
}

// Log streaming message
interface LogMessage {
  type: "logs";
  payload: {
    jobId: string;
    entries: LogEntry[];
  };
}

interface LogEntry {
  timestamp: string;
  stream: "stdout" | "stderr";
  line: string;
  sequence: number; // For ordering
}

// Status update via WebSocket
interface StatusMessage {
  type: "status";
  payload: {
    jobId: string;
    status: JobStatus;
    timestamp: string;
    details?: any;
  };
}

// Heartbeat/Ping
interface PingMessage {
  type: "ping";
  payload: {
    timestamp: string;
  };
}

// Server acknowledgment
interface AckMessage {
  type: "ack";
  payload: {
    messageId: string;
    success: boolean;
    error?: string;
  };
}
```

**Example WebSocket Flow:**

```javascript
// 1. Connect and authenticate
ws.send({
  type: "authenticate",
  payload: {
    token: "service-token",
    orchestratorId: "orch-123",
    version: "1.0.0",
  },
});

// 2. Stream logs
ws.send({
  type: "logs",
  payload: {
    jobId: "job-123",
    entries: [
      {
        timestamp: "2024-01-15T10:00:01.123Z",
        stream: "stdout",
        line: "Starting process...",
        sequence: 1,
      },
      {
        timestamp: "2024-01-15T10:00:01.234Z",
        stream: "stdout",
        line: "Process initialized",
        sequence: 2,
      },
    ],
  },
});

// 3. Receive acknowledgment
ws.on("message", (data) => {
  const msg = JSON.parse(data);
  if (msg.type === "ack") {
    console.log("Message acknowledged:", msg.payload);
  }
});
```

### 3.2 Batch Log Upload (Fallback)

For situations where WebSocket is unavailable or for historical logs.

**Endpoint:** `POST /api/internal/jobs/{jobId}/logs`

**Request Body:**

```typescript
interface BatchLogUpload {
  entries: LogEntry[];
  metadata: {
    orchestratorId: string;
    uploadTime: string;
    sequenceStart: number;
    sequenceEnd: number;
    isComplete: boolean;
  };
}
```

## 4. Monitoring API

### 4.1 Orchestrator Health Report

Reports orchestrator health status to the backend.

**Endpoint:** `POST /api/internal/orchestrator/health`

**Request Body:**

```typescript
interface HealthReport {
  orchestratorId: string;
  timestamp: string;
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  uptime: number; // seconds
  components: {
    docker?: ComponentHealth;
    sshPools?: ComponentHealth;
    api?: ComponentHealth;
    websocket?: ComponentHealth;
  };
  metrics: {
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
    queuedJobs: number;
    cpuUsage: number; // percentage
    memoryUsage: number; // bytes
    goroutines: number;
  };
}

interface ComponentHealth {
  status: "healthy" | "degraded" | "unhealthy";
  lastCheck: string;
  message?: string;
  metadata?: Record<string, any>;
}
```

### 4.2 Metrics Export

Exports Prometheus-compatible metrics.

**Endpoint:** `GET /metrics` (Orchestrator exposes this)

**Format:** Prometheus text format

```
# HELP cronium_jobs_total Total number of jobs processed
# TYPE cronium_jobs_total counter
cronium_jobs_total{status="completed"} 1234
cronium_jobs_total{status="failed"} 56

# HELP cronium_job_duration_seconds Job execution duration
# TYPE cronium_job_duration_seconds histogram
cronium_job_duration_seconds_bucket{le="10"} 100
cronium_job_duration_seconds_bucket{le="30"} 200
cronium_job_duration_seconds_bucket{le="60"} 250
```

## 5. Error Handling

### Standard Error Response

All APIs use a consistent error response format:

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    timestamp: string;
    traceId?: string;
  };
}
```

### Error Codes

```typescript
enum ErrorCode {
  // Authentication errors (401)
  AUTH_INVALID_TOKEN = "AUTH_INVALID_TOKEN",
  AUTH_EXPIRED_TOKEN = "AUTH_EXPIRED_TOKEN",

  // Authorization errors (403)
  AUTHZ_INSUFFICIENT_PERMISSIONS = "AUTHZ_INSUFFICIENT_PERMISSIONS",

  // Resource errors (404)
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  RESOURCE_ALREADY_PROCESSED = "RESOURCE_ALREADY_PROCESSED",

  // Validation errors (400)
  VALIDATION_INVALID_PARAMS = "VALIDATION_INVALID_PARAMS",
  VALIDATION_MISSING_FIELD = "VALIDATION_MISSING_FIELD",

  // Rate limiting (429)
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",

  // Server errors (500)
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",

  // Service errors (503)
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  SERVICE_DEGRADED = "SERVICE_DEGRADED",
}
```

## 6. Rate Limiting

API endpoints implement rate limiting:

```yaml
rateLimits:
  pollJobs:
    requests: 60
    window: 60s # 1 request per second
  updateStatus:
    requests: 600
    window: 60s # 10 requests per second
  streamLogs:
    requests: 1000
    window: 60s # ~16 requests per second
  health:
    requests: 60
    window: 300s # 1 request per 5 seconds
```

Rate limit headers:

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1642248000
```

## 7. Backward Compatibility

### Version Negotiation

The orchestrator includes version information in all requests:

```http
X-Service-Version: 1.0.0
Accept: application/json; version=1
```

### Deprecation Policy

- APIs are versioned using URL paths when breaking changes occur
- Deprecated endpoints return `Sunset` headers
- Minimum 3-month deprecation notice
- Migration guides provided for breaking changes

Example deprecation header:

```http
Sunset: Sat, 31 Dec 2024 23:59:59 GMT
Link: </api/internal/v2/jobs/queue>; rel="successor-version"
```

## 8. Security Considerations

### 1. Authentication

- Service tokens are rotated regularly
- Tokens are never logged or exposed
- Failed auth attempts are rate-limited

### 2. Authorization

- Orchestrator has limited scope (job operations only)
- Cannot access user data or admin functions
- Audit logging for all operations

### 3. Data Protection

- TLS required for production
- Sensitive data encrypted in transit
- No credentials in log messages

### 4. Input Validation

- All inputs validated against schema
- Script content sanitized
- Resource limits enforced

## 9. Implementation Notes

### Retry Strategy

```go
// Exponential backoff with jitter
backoff := time.Duration(math.Pow(2, float64(attempt))) * time.Second
jitter := time.Duration(rand.Float64() * float64(backoff) * 0.1)
time.Sleep(backoff + jitter)
```

### Circuit Breaker

```go
// Circuit breaker configuration
breaker := circuit.NewBreaker(circuit.Config{
    Timeout:         30 * time.Second,
    MaxRequests:     100,
    Interval:        10 * time.Second,
    ReadyToTrip: func(counts circuit.Counts) bool {
        failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
        return counts.Requests >= 10 && failureRatio >= 0.5
    },
})
```

### Connection Pooling

```go
// HTTP client with connection pooling
client := &http.Client{
    Transport: &http.Transport{
        MaxIdleConns:        100,
        MaxIdleConnsPerHost: 10,
        IdleConnTimeout:     90 * time.Second,
        DisableKeepAlives:   false,
    },
    Timeout: 30 * time.Second,
}
```

## Summary

These API contracts provide:

1. **Clear communication** between orchestrator and backend
2. **Real-time updates** through WebSocket streaming
3. **Robust error handling** with consistent formats
4. **Security** through authentication and rate limiting
5. **Observability** through health reports and metrics

The design ensures reliable job execution while maintaining system visibility and control.
