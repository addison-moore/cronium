# Cronium Runtime Service

The Runtime Service provides a secure API for script executions to interact with Cronium's variable system, workflow control, and tool actions. It replaces the file-based runtime helpers with a modern HTTP-based approach.

## Features

- **JWT Authentication**: Secure, execution-scoped tokens
- **Valkey Caching**: High-performance caching for variables and execution data
- **Rate Limiting**: Per-execution rate limits to prevent abuse
- **Audit Logging**: Complete audit trail of all operations
- **Tool Actions**: Execute integrated tools directly from scripts
- **Health Monitoring**: Prometheus metrics and health endpoints

## API Endpoints

### Authentication

All endpoints (except health/metrics) require a valid JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

### Core Endpoints

- `GET /executions/{id}/input` - Get execution input data
- `POST /executions/{id}/output` - Set execution output data
- `GET /executions/{id}/variables/{key}` - Get variable value
- `PUT /executions/{id}/variables/{key}` - Set variable value
- `POST /executions/{id}/condition` - Set workflow condition
- `GET /executions/{id}/context` - Get execution context
- `POST /tool-actions/execute` - Execute a tool action

### Monitoring

- `GET /health` - Health check endpoint
- `GET /metrics` - Prometheus metrics

## Configuration

The service can be configured via:

1. YAML configuration file (`config.yaml`)
2. Environment variables (override YAML values)

### Environment Variables

- `RUNTIME_PORT` - HTTP server port (default: 8081)
- `RUNTIME_JWT_SECRET` - JWT signing secret (required)
- `RUNTIME_VALKEY_URL` - Valkey connection URL
- `RUNTIME_BACKEND_URL` - Cronium backend API URL
- `RUNTIME_BACKEND_TOKEN` - Backend service authentication token
- `RUNTIME_LOG_LEVEL` - Logging level (debug, info, warn, error)

## Running the Service

### Development

```bash
# Set required environment variables
export RUNTIME_JWT_SECRET="your-secret-key"
export RUNTIME_BACKEND_TOKEN="backend-service-token"

# Run the service
go run cmd/runtime/main.go
```

### Production

```bash
# Build the binary
go build -o cronium-runtime cmd/runtime/main.go

# Run with config file
CONFIG_FILE=/path/to/config.yaml ./cronium-runtime
```

### Docker

```bash
# Build image
docker build -t cronium/runtime:latest .

# Run container
docker run -p 8081:8081 \
  -e RUNTIME_JWT_SECRET="your-secret-key" \
  -e RUNTIME_BACKEND_TOKEN="backend-token" \
  -e RUNTIME_VALKEY_URL="valkey://valkey:6379" \
  -e RUNTIME_BACKEND_URL="http://backend:5001" \
  cronium/runtime:latest
```

## Security

- All endpoints require valid JWT authentication
- Tokens are execution-scoped and time-limited
- Rate limiting prevents abuse
- CORS can be configured for browser-based access
- TLS support for production deployments

## Development

### Prerequisites

- Go 1.23 or higher
- Valkey/Redis instance
- Access to Cronium backend API

### Testing

```bash
# Run unit tests
go test ./...

# Run with coverage
go test -cover ./...

# Run integration tests
go test -tags=integration ./...
```

### Building

```bash
# Build for current platform
go build -o cronium-runtime cmd/runtime/main.go

# Build for Linux
GOOS=linux GOARCH=amd64 go build -o cronium-runtime-linux cmd/runtime/main.go

# Build with version info
go build -ldflags "-X main.Version=1.0.0" -o cronium-runtime cmd/runtime/main.go
```

## Architecture

The Runtime Service acts as a bridge between executing scripts and the Cronium backend:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Container     │────▶│ Runtime Service │────▶│   Backend API   │
│   (Script)      │     │   (This API)    │     │   (Storage)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │     Valkey      │
                        │    (Cache)      │
                        └─────────────────┘
```

## License

See LICENSE file in the root of the Cronium project.
