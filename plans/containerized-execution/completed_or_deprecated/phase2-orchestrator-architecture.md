# Phase 2: Orchestrator Architecture Design

## Overview

This document defines the architecture for the Cronium Go orchestrator, focusing on secure containerized execution, real-time log streaming, and efficient job management. The design addresses all critical issues identified in Phase 1 while maintaining simplicity for self-hosted deployments.

## Core Architecture Principles

1. **Security First**: All executions isolated in containers with resource limits
2. **Real-time Feedback**: WebSocket-based log streaming during execution
3. **Parallel Execution**: Support for concurrent job processing
4. **Fault Tolerance**: Robust error handling and recovery mechanisms
5. **Observability**: Comprehensive logging, metrics, and monitoring

## System Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cronium Backend (Next.js)                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │   Web UI    │  │   tRPC API   │  │  WebSocket Server      │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
└─────────────────────────┬────────────────┬─────────────────────┘
                          │                │
                          │ HTTP/REST      │ WebSocket
                          │                │
┌─────────────────────────┴────────────────┴─────────────────────┐
│                    Cronium Orchestrator (Go)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Job Queue   │  │   Executor   │  │   Log Streamer         │ │
│  │ Poller      │  │   Manager    │  │                        │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
│         │                 │                                      │
│  ┌──────┴─────┐  ┌───────┴──────┐  ┌────────────────────────┐ │
│  │  API       │  │  Container   │  │    SSH                 │ │
│  │  Client    │  │  Executor    │  │    Executor            │ │
│  └────────────┘  └──────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                          │                    │
                          │                    │
                    ┌─────▼─────┐        ┌────▼─────┐
                    │  Docker   │        │  Remote  │
                    │  Daemon   │        │  Servers │
                    └───────────┘        └──────────┘
```

### Component Responsibilities

#### 1. Job Queue Poller

- Polls `/api/internal/jobs/queue` endpoint for pending jobs
- Manages job acquisition and acknowledgment
- Implements exponential backoff for empty queues
- Handles job priority and scheduling

#### 2. Executor Manager

- Orchestrates job execution lifecycle
- Routes jobs to appropriate executors (Container/SSH)
- Manages parallel execution with configurable concurrency
- Tracks execution state and metrics

#### 3. Container Executor

- Manages Docker container lifecycle
- Implements resource limits and security constraints
- Handles volume mounting for scripts and data
- Captures real-time output streams

#### 4. SSH Executor

- Manages SSH connection pooling
- Executes scripts on remote servers
- Implements circuit breaker pattern
- Streams output in real-time

#### 5. Log Streamer

- Captures stdout/stderr from executors
- Streams logs via WebSocket to backend
- Implements buffering and retry logic
- Handles connection failures gracefully

#### 6. API Client

- Authenticates with backend using service token
- Updates job status in real-time
- Handles API failures with retry logic
- Implements circuit breaker for API calls

## Executor Interface Design

### Core Interface

```go
// Executor defines the interface for all execution strategies
type Executor interface {
    // Execute runs the job and returns a result channel for streaming updates
    Execute(ctx context.Context, job *Job) (<-chan ExecutionUpdate, error)

    // Validate checks if the executor can handle the job
    Validate(job *Job) error

    // Cleanup performs any necessary cleanup after execution
    Cleanup(ctx context.Context, job *Job) error
}

// ExecutionUpdate represents a real-time update during execution
type ExecutionUpdate struct {
    Type      UpdateType    // Log, Status, Progress, Error, Complete
    Timestamp time.Time
    Data      interface{}   // LogEntry, StatusUpdate, etc.
}

// UpdateType defines the type of execution update
type UpdateType string

const (
    UpdateTypeLog      UpdateType = "log"
    UpdateTypeStatus   UpdateType = "status"
    UpdateTypeProgress UpdateType = "progress"
    UpdateTypeError    UpdateType = "error"
    UpdateTypeComplete UpdateType = "complete"
)

// LogEntry represents a log line from execution
type LogEntry struct {
    Stream    string    // stdout, stderr
    Line      string    // The actual log line
    Timestamp time.Time
}

// StatusUpdate represents a status change
type StatusUpdate struct {
    Status    JobStatus
    Message   string
    ExitCode  *int
}
```

### Job Structure

```go
// Job represents a job to be executed
type Job struct {
    ID            string
    Type          JobType      // container, ssh
    Target        Target       // local, server details
    Script        Script       // script content and metadata
    Environment   Environment  // env vars, working dir
    Resources     Resources    // CPU, memory limits
    Timeout       time.Duration
    RetryPolicy   RetryPolicy
    Priority      int
}

// JobType defines the execution type
type JobType string

const (
    JobTypeContainer JobType = "container"
    JobTypeSSH       JobType = "ssh"
)

// Target defines where to execute the job
type Target struct {
    Type     TargetType
    ServerID *string      // For SSH execution
    Config   interface{}  // Type-specific configuration
}

// Script contains the script to execute
type Script struct {
    Type     ScriptType  // bash, python, node
    Content  string
    Helpers  []Helper    // Runtime helpers to inject
}

// Resources defines resource constraints
type Resources struct {
    CPULimit    float64  // CPU cores (e.g., 0.5, 1.0)
    MemoryLimit int64    // Memory in bytes
    DiskLimit   int64    // Disk I/O limit
}
```

## Container Executor Design

### Container Lifecycle Management

```go
// ContainerExecutor implements container-based execution
type ContainerExecutor struct {
    client        *docker.Client
    imageCache    *ImageCache
    volumeManager *VolumeManager
    config        ContainerConfig
}

// ContainerConfig defines container execution settings
type ContainerConfig struct {
    BaseImages    map[ScriptType]string
    Network       string
    DNSServers    []string
    Labels        map[string]string
    SecurityOpts  []string
}
```

### Execution Flow

1. **Prepare Phase**
   - Validate job configuration
   - Select appropriate base image
   - Create temporary execution directory
   - Prepare script with runtime helpers

2. **Container Creation**
   - Create container with resource limits
   - Mount volumes for script and data
   - Set environment variables
   - Configure security options

3. **Execution Phase**
   - Start container
   - Attach to stdout/stderr streams
   - Stream logs in real-time
   - Monitor container status

4. **Cleanup Phase**
   - Copy output data from container
   - Remove container
   - Clean up temporary files
   - Report final status

### Security Configuration

```go
// Container security settings
containerConfig := &container.Config{
    User:           "1000:1000",  // Non-root user
    WorkingDir:     "/workspace",
    Env:            envVars,
    AttachStdout:   true,
    AttachStderr:   true,
    NetworkDisabled: false,  // May need network access
}

hostConfig := &container.HostConfig{
    Resources: container.Resources{
        CPUQuota:   int64(job.Resources.CPULimit * 100000),
        Memory:     job.Resources.MemoryLimit,
        MemorySwap: job.Resources.MemoryLimit,
        DiskQuota:  job.Resources.DiskLimit,
    },
    SecurityOpt: []string{
        "no-new-privileges:true",
        "seccomp=default",
    },
    CapDrop: []string{"ALL"},
    CapAdd:  []string{}, // No additional capabilities
    ReadonlyRootfs: false, // Scripts may need to write temp files
}
```

## SSH Executor Design

### Connection Pool Management

```go
// SSHExecutor implements SSH-based execution
type SSHExecutor struct {
    pools    map[string]*ConnectionPool
    config   SSHConfig
    mu       sync.RWMutex
}

// ConnectionPool manages SSH connections for a server
type ConnectionPool struct {
    serverID    string
    connections chan *SSHConnection
    factory     ConnectionFactory
    health      *HealthChecker
    breaker     *CircuitBreaker
}

// SSHConnection wraps an SSH client connection
type SSHConnection struct {
    client    *ssh.Client
    serverID  string
    created   time.Time
    lastUsed  time.Time
    healthy   bool
}
```

### Connection Pool Features

1. **Connection Reuse**
   - Maintain pool of active connections per server
   - Reuse connections for multiple executions
   - Automatic connection validation

2. **Health Checking**
   - Periodic keepalive checks
   - Remove unhealthy connections
   - Automatic reconnection attempts

3. **Circuit Breaker**
   - Prevent repeated connection attempts to failing servers
   - Automatic recovery after timeout
   - Configurable failure thresholds

### Execution Flow

1. **Connection Acquisition**
   - Get connection from pool or create new
   - Validate connection health
   - Handle circuit breaker state

2. **Script Upload**
   - Create temporary directory on remote
   - Upload script and runtime helpers
   - Set appropriate permissions

3. **Execution**
   - Create SSH session
   - Execute script with proper shell
   - Stream output in real-time

4. **Cleanup**
   - Download output files
   - Remove temporary directory
   - Return connection to pool

## Real-time Log Streaming

### WebSocket Protocol

```go
// LogStreamer handles real-time log streaming
type LogStreamer struct {
    wsClient   *WebSocketClient
    buffer     *CircularBuffer
    batchSize  int
    flushTimer time.Duration
}

// LogMessage represents a log entry sent via WebSocket
type LogMessage struct {
    JobID     string    `json:"jobId"`
    Stream    string    `json:"stream"`
    Line      string    `json:"line"`
    Timestamp int64     `json:"timestamp"`
    Sequence  int64     `json:"sequence"`
}

// WebSocket message format
type WSMessage struct {
    Type    string      `json:"type"`    // "log", "status", "error"
    Payload interface{} `json:"payload"`
}
```

### Streaming Features

1. **Buffering**
   - Buffer logs to reduce WebSocket messages
   - Flush on size or time threshold
   - Preserve log order with sequence numbers

2. **Reliability**
   - Automatic reconnection on disconnect
   - Replay buffered logs after reconnection
   - Acknowledgment mechanism

3. **Performance**
   - Batch multiple log lines per message
   - Compress large payloads
   - Rate limiting for high-volume output

## Job Queue Integration

### API Contract

```go
// JobQueueAPI defines the interface for job queue operations
type JobQueueAPI interface {
    // PollJobs retrieves pending jobs from the queue
    PollJobs(ctx context.Context, limit int) ([]Job, error)

    // AcknowledgeJob marks a job as received
    AcknowledgeJob(ctx context.Context, jobID string) error

    // UpdateJobStatus updates the job execution status
    UpdateJobStatus(ctx context.Context, jobID string, status JobStatus, details interface{}) error

    // StreamLogs sends log entries for a job
    StreamLogs(ctx context.Context, jobID string, logs []LogEntry) error
}
```

### Polling Strategy

1. **Adaptive Polling**
   - Fast polling when jobs are available
   - Exponential backoff when queue is empty
   - Configurable min/max intervals

2. **Batch Processing**
   - Poll multiple jobs per request
   - Process jobs concurrently
   - Respect server capacity

3. **Priority Handling**
   - Request high-priority jobs first
   - Implement local priority queue
   - Fair scheduling across priorities

## Error Handling Strategy

### Error Types

```go
// Error types for better error handling
type ErrorType string

const (
    ErrorTypeValidation   ErrorType = "validation"
    ErrorTypeDocker       ErrorType = "docker"
    ErrorTypeSSH          ErrorType = "ssh"
    ErrorTypeAPI          ErrorType = "api"
    ErrorTypeTimeout      ErrorType = "timeout"
    ErrorTypeResource     ErrorType = "resource"
    ErrorTypeScript       ErrorType = "script"
)

// ExecutionError provides detailed error information
type ExecutionError struct {
    Type      ErrorType
    Message   string
    Details   map[string]interface{}
    Retryable bool
    Timestamp time.Time
}
```

### Recovery Mechanisms

1. **Automatic Retry**
   - Configurable retry policies per job type
   - Exponential backoff with jitter
   - Different strategies for different error types

2. **Graceful Degradation**
   - Continue processing other jobs on failure
   - Quarantine problematic jobs
   - Alert on repeated failures

3. **Resource Recovery**
   - Clean up containers on crash
   - Release SSH connections on failure
   - Prevent resource leaks

## Configuration Design

### Configuration Structure

```yaml
# cronium-orchestrator.yaml
orchestrator:
  # API configuration
  api:
    endpoint: "${CRONIUM_API_URL}"
    token: "${CRONIUM_SERVICE_TOKEN}"
    timeout: 30s
    retry:
      maxAttempts: 3
      backoff: exponential

  # Job processing
  jobs:
    pollInterval: 1s
    pollBatchSize: 10
    maxConcurrent: 5
    defaultTimeout: 3600s

  # Container execution
  container:
    docker:
      endpoint: "unix:///var/run/docker.sock"
      version: "1.41"
    images:
      bash: "cronium/runner:bash-alpine"
      python: "cronium/runner:python-alpine"
      node: "cronium/runner:node-alpine"
    resources:
      defaultCPU: 0.5
      defaultMemory: 512MB
      maxCPU: 2.0
      maxMemory: 2GB
    security:
      user: "1000:1000"
      readOnlyRootFS: false
      dropCapabilities: ["ALL"]

  # SSH execution
  ssh:
    connectionPool:
      maxPerServer: 5
      idleTimeout: 5m
      healthCheckInterval: 30s
    execution:
      defaultShell: "/bin/bash"
      tempDir: "/tmp/cronium"
    circuitBreaker:
      failureThreshold: 5
      recoveryTimeout: 60s

  # Log streaming
  logging:
    websocket:
      endpoint: "${CRONIUM_WS_URL}"
      reconnectInterval: 5s
      pingInterval: 30s
    buffer:
      size: 1000
      flushInterval: 100ms
      batchSize: 50

  # Monitoring
  monitoring:
    metrics:
      enabled: true
      port: 9090
      path: "/metrics"
    health:
      port: 8080
      path: "/health"
    logging:
      level: "info"
      format: "json"
```

### Environment Variables

```bash
# Required environment variables
CRONIUM_API_URL=http://localhost:5001/api/internal
CRONIUM_WS_URL=ws://localhost:5001/api/socket
CRONIUM_SERVICE_TOKEN=<generated-token>

# Optional overrides
CRONIUM_MAX_CONCURRENT=10
CRONIUM_LOG_LEVEL=debug
CRONIUM_DOCKER_HOST=unix:///var/run/docker.sock
```

## Monitoring and Observability

### Metrics

```go
// Key metrics to track
type Metrics struct {
    // Job metrics
    JobsReceived      Counter
    JobsCompleted     Counter
    JobsFailed        Counter
    JobDuration       Histogram
    JobQueueSize      Gauge

    // Executor metrics
    ContainerStarts   Counter
    ContainerFailures Counter
    SSHConnections    Gauge
    SSHFailures       Counter

    // System metrics
    GoroutineCount    Gauge
    MemoryUsage       Gauge
    CPUUsage          Gauge

    // API metrics
    APIRequests       Counter
    APILatency        Histogram
    APIErrors         Counter
}
```

### Health Checks

```go
// Health check endpoint response
type HealthStatus struct {
    Status     string                 `json:"status"`      // healthy, degraded, unhealthy
    Timestamp  time.Time              `json:"timestamp"`
    Components map[string]Component   `json:"components"`
}

type Component struct {
    Status  string                 `json:"status"`
    Details map[string]interface{} `json:"details,omitempty"`
}

// Example health check response
{
    "status": "healthy",
    "timestamp": "2024-01-15T10:30:00Z",
    "components": {
        "docker": {
            "status": "healthy",
            "details": {
                "version": "24.0.7",
                "containers": 5
            }
        },
        "api": {
            "status": "healthy",
            "details": {
                "latency": "45ms",
                "lastPoll": "2024-01-15T10:29:55Z"
            }
        },
        "ssh_pools": {
            "status": "healthy",
            "details": {
                "totalConnections": 3,
                "activeServers": 2
            }
        }
    }
}
```

### Structured Logging

```go
// Structured log entry
type LogEntry struct {
    Level      string                 `json:"level"`
    Time       time.Time              `json:"time"`
    Message    string                 `json:"message"`
    Component  string                 `json:"component"`
    JobID      string                 `json:"job_id,omitempty"`
    Error      string                 `json:"error,omitempty"`
    Duration   float64                `json:"duration,omitempty"`
    Metadata   map[string]interface{} `json:"metadata,omitempty"`
}

// Example log entry
{
    "level": "info",
    "time": "2024-01-15T10:30:00Z",
    "message": "Job completed successfully",
    "component": "executor",
    "job_id": "job-123",
    "duration": 45.3,
    "metadata": {
        "type": "container",
        "exit_code": 0,
        "output_size": 1024
    }
}
```

## Security Considerations

### 1. Container Security

- Run containers as non-root user
- Drop all Linux capabilities
- Use read-only root filesystem where possible
- Network isolation for sensitive executions
- Resource limits to prevent DoS

### 2. API Security

- Service token authentication
- TLS for all communications
- Request signing for integrity
- Rate limiting per service

### 3. SSH Security

- Key-based authentication only
- Known hosts verification
- Connection encryption
- Audit logging for all operations

### 4. Data Security

- Temporary file cleanup
- Secure secret injection
- No credential logging
- Encrypted data at rest

## Performance Optimizations

### 1. Container Optimization

- Pre-pulled base images
- Layer caching
- Minimal base images (Alpine)
- Container reuse (Phase 2)

### 2. Connection Pooling

- Reuse SSH connections
- Preemptive connection warming
- Connection health monitoring
- Optimal pool sizing

### 3. Log Streaming

- Batch log messages
- Compression for large outputs
- Efficient buffering
- Async processing

### 4. Concurrency

- Parallel job execution
- Non-blocking I/O
- Efficient goroutine usage
- Resource-aware scheduling

## Summary

This architecture design provides:

1. **Security**: Complete isolation through containers
2. **Performance**: Parallel execution and connection pooling
3. **Reliability**: Comprehensive error handling and recovery
4. **Observability**: Real-time logs, metrics, and monitoring
5. **Simplicity**: Single binary deployment with embedded orchestrator

The design addresses all critical issues identified in Phase 1 while maintaining the simplicity required for self-hosted deployments.
