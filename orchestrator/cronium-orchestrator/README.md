# Cronium Orchestrator

A secure job orchestrator for Cronium that executes scripts and commands in isolated Docker containers with real-time log streaming and comprehensive monitoring.

## Features

- **Secure Execution**: All scripts run in isolated Docker containers with resource limits
- **Multi-Language Support**: Execute Bash, Python, and Node.js scripts
- **SSH Execution**: Run scripts on remote servers with connection pooling
- **Real-time Logs**: Stream execution logs via WebSocket during execution
- **Resource Management**: CPU, memory, and disk I/O limits per execution
- **Circuit Breakers**: Automatic failure detection and recovery
- **Monitoring**: Prometheus metrics and health check endpoints
- **Configuration**: Flexible configuration via files and environment variables

## Architecture

The orchestrator consists of several key components:

- **Job Queue Poller**: Fetches pending jobs from the Cronium API
- **Executor Manager**: Routes jobs to appropriate executors (Container/SSH)
- **Container Executor**: Manages Docker container lifecycle
- **SSH Executor**: Handles remote server executions
- **Log Streamer**: Streams logs in real-time via WebSocket
- **Health Checker**: Monitors component health
- **Metrics Collector**: Tracks execution metrics

## Quick Start

### Prerequisites

- Go 1.21 or later
- Docker daemon running
- Access to Cronium backend API

### Building

```bash
# Clone the repository
git clone https://github.com/addison-more/cronium/orchestrator.git
cd orchestrator/cronium-orchestrator

# Download dependencies
go mod download

# Build the binary
go build -o cronium-agent cmd/cronium-agent/*.go
```

### Running

```bash
# Set required environment variables
export CRONIUM_API_URL=http://localhost:5001/api/internal
export CRONIUM_SERVICE_TOKEN=your-service-token

# Run with default configuration
./cronium-agent

# Run with custom config file
./cronium-agent --config /path/to/config.yaml

# Validate configuration
./cronium-agent validate --config /path/to/config.yaml
```

## Configuration

The orchestrator can be configured via:

1. Configuration file (YAML)
2. Environment variables
3. Command-line flags

See `configs/cronium-orchestrator.yaml` for a complete example.

### Key Configuration Options

```yaml
# API Configuration
api:
  endpoint: ${CRONIUM_API_URL}
  token: ${CRONIUM_SERVICE_TOKEN}

# Job Processing
jobs:
  maxConcurrent: 5
  pollInterval: 1s

# Container Settings
container:
  resources:
    defaults:
      cpu: 0.5
      memory: 512MB
```

### Environment Variables

All configuration options can be set via environment variables with the prefix `CRONIUM_`:

- `CRONIUM_API_ENDPOINT`: Backend API URL
- `CRONIUM_API_TOKEN`: Service authentication token
- `CRONIUM_JOBS_MAX_CONCURRENT`: Maximum concurrent executions
- `CRONIUM_LOGGING_LEVEL`: Log level (debug, info, warn, error)

## Container Images

The orchestrator uses Alpine-based images for script execution:

- `cronium/runner:bash-alpine`: Bash script execution
- `cronium/runner:python-alpine`: Python script execution
- `cronium/runner:node-alpine`: Node.js script execution

### Building Images

```bash
cd runtime-images
docker build -t cronium/runner:bash-alpine -f Dockerfile.bash .
docker build -t cronium/runner:python-alpine -f Dockerfile.python .
docker build -t cronium/runner:node-alpine -f Dockerfile.node .
```

## Monitoring

### Health Check

```bash
curl http://localhost:8080/health
```

Response:

```json
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
        "latency": "45ms"
      }
    }
  }
}
```

### Metrics

Prometheus metrics are exposed at `http://localhost:9090/metrics`:

- `cronium_jobs_received_total`: Total jobs received
- `cronium_jobs_completed_total`: Successfully completed jobs
- `cronium_jobs_failed_total`: Failed jobs
- `cronium_job_duration_seconds`: Job execution duration
- `cronium_jobs_active`: Currently executing jobs

## Security

### Container Security

- Containers run as non-root user (1000:1000)
- All Linux capabilities dropped by default
- Resource limits enforced (CPU, memory, PIDs)
- Network isolation between containers

### SSH Security

- Key-based authentication only
- Known hosts verification
- Connection encryption
- Circuit breaker for failing connections

## Development

### Project Structure

```
cronium-orchestrator/
├── cmd/cronium-agent/      # Main application entry point
├── internal/               # Internal packages
│   ├── api/               # API client
│   ├── config/            # Configuration management
│   ├── executors/         # Job executors
│   ├── health/            # Health checking
│   ├── jobs/              # Job queue management
│   ├── logger/            # Logging and log streaming
│   └── metrics/           # Metrics collection
├── pkg/                   # Public packages
│   ├── errors/            # Error types
│   ├── types/             # Shared types
│   └── utils/             # Utilities
├── configs/               # Configuration examples
├── scripts/               # Build and deployment scripts
└── test/                  # Test files
```

### Running Tests

```bash
# Run all tests
go test ./...

# Run with coverage
go test -cover ./...

# Run integration tests
go test -tags=integration ./...
```

### Building for Production

```bash
# Build with version information
VERSION=$(git describe --tags --always)
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git rev-parse HEAD)

go build -ldflags="-X main.Version=$VERSION -X main.BuildTime=$BUILD_TIME -X main.GitCommit=$GIT_COMMIT" \
  -o cronium-agent cmd/cronium-agent/*.go
```

## Deployment

### Docker

```dockerfile
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY . .
RUN go build -o cronium-agent cmd/cronium-agent/*.go

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/cronium-agent /usr/local/bin/
ENTRYPOINT ["cronium-agent"]
```

### Docker Compose

```yaml
version: "3.8"
services:
  orchestrator:
    build: .
    environment:
      - CRONIUM_API_URL=http://backend:5001/api/internal
      - CRONIUM_SERVICE_TOKEN=${SERVICE_TOKEN}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./configs:/etc/cronium
    command: --config /etc/cronium/cronium-orchestrator.yaml
```

## Troubleshooting

### Common Issues

1. **Docker connection failed**
   - Ensure Docker daemon is running
   - Check Docker socket permissions
   - Verify DOCKER_HOST environment variable

2. **API authentication failed**
   - Verify CRONIUM_SERVICE_TOKEN is set
   - Check API endpoint URL
   - Ensure orchestrator has proper permissions

3. **Container execution failed**
   - Check Docker image availability
   - Verify resource limits are reasonable
   - Review container security settings

### Debug Mode

Enable debug logging:

```bash
export CRONIUM_LOGGING_LEVEL=debug
./cronium-agent
```

## License

Copyright (c) 2024 Cronium. All rights reserved.
