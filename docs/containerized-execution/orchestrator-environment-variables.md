# Orchestrator Environment Variables with CRONIUM\_ Prefix

This document details which environment variables in the Cronium orchestrator expect the `CRONIUM_` prefix and how they map to the internal configuration structure.

## How Environment Variables Work

The orchestrator uses the `envconfig` library to process environment variables. In `config.go` line 300:

```go
if err := envconfig.Process("CRONIUM", config); err != nil {
    return nil, fmt.Errorf("failed to process environment variables: %w", err)
}
```

This means all environment variables are expected to start with the `CRONIUM_` prefix, followed by the configuration path using underscores as separators.

## Environment Variable Mapping

The mapping follows this pattern:

- Prefix: `CRONIUM_`
- Struct path converted to uppercase with underscores
- Example: `api.endpoint` → `CRONIUM_API_ENDPOINT`

### Complete List of CRONIUM\_ Environment Variables

#### Orchestrator Configuration

- `CRONIUM_ORCHESTRATOR_ID` - Orchestrator instance ID (default: "auto")
- `CRONIUM_ORCHESTRATOR_NAME` - Human-readable name
- `CRONIUM_ORCHESTRATOR_ENVIRONMENT` - Environment (production/staging/development)
- `CRONIUM_ORCHESTRATOR_REGION` - Region identifier
- `CRONIUM_ORCHESTRATOR_TAGS` - Comma-separated tags

#### API Configuration

- `CRONIUM_API_ENDPOINT` - Backend API URL (required)
- `CRONIUM_API_TOKEN` - Service authentication token (required)
- `CRONIUM_API_WS_ENDPOINT` - WebSocket endpoint
- `CRONIUM_API_TIMEOUT` - Request timeout (default: "30s")
- `CRONIUM_API_RETRY_MAX_ATTEMPTS` - Max retry attempts
- `CRONIUM_API_RETRY_BACKOFF_TYPE` - Retry backoff type
- `CRONIUM_API_RETRY_INITIAL_DELAY` - Initial retry delay
- `CRONIUM_API_RETRY_MAX_DELAY` - Maximum retry delay
- `CRONIUM_API_RATE_LIMIT_ENABLED` - Enable rate limiting
- `CRONIUM_API_RATE_LIMIT_REQUESTS_PER_SECOND` - Rate limit

#### Jobs Configuration

- `CRONIUM_JOBS_POLL_INTERVAL` - Job polling interval
- `CRONIUM_JOBS_POLL_BATCH_SIZE` - Jobs per poll
- `CRONIUM_JOBS_MAX_CONCURRENT` - Max concurrent executions
- `CRONIUM_JOBS_DEFAULT_TIMEOUT` - Default job timeout
- `CRONIUM_JOBS_QUEUE_STRATEGY` - Queue strategy (priority/fifo/lifo)
- `CRONIUM_JOBS_LEASE_RENEWAL` - Lease renewal interval

#### Container Configuration

- `CRONIUM_CONTAINER_DOCKER_ENDPOINT` - Docker daemon endpoint
- `CRONIUM_CONTAINER_DOCKER_VERSION` - Docker API version
- `CRONIUM_CONTAINER_DOCKER_TLS_VERIFY` - Enable TLS verification
- `CRONIUM_CONTAINER_DOCKER_CERT_PATH` - TLS certificate path
- `CRONIUM_CONTAINER_IMAGES_<TYPE>` - Container images by type
- `CRONIUM_CONTAINER_RESOURCES_DEFAULTS_CPU` - Default CPU allocation
- `CRONIUM_CONTAINER_RESOURCES_DEFAULTS_MEMORY` - Default memory
- `CRONIUM_CONTAINER_RESOURCES_DEFAULTS_DISK` - Default disk space
- `CRONIUM_CONTAINER_RESOURCES_DEFAULTS_PIDS` - Default PID limit
- `CRONIUM_CONTAINER_RESOURCES_LIMITS_CPU` - Max CPU allocation
- `CRONIUM_CONTAINER_RESOURCES_LIMITS_MEMORY` - Max memory
- `CRONIUM_CONTAINER_RESOURCES_LIMITS_DISK` - Max disk space
- `CRONIUM_CONTAINER_RESOURCES_LIMITS_PIDS` - Max PID limit
- `CRONIUM_CONTAINER_SECURITY_USER` - Container user
- `CRONIUM_CONTAINER_SECURITY_NO_NEW_PRIVILEGES` - Prevent privilege escalation
- `CRONIUM_CONTAINER_SECURITY_DROP_CAPABILITIES` - Capabilities to drop
- `CRONIUM_CONTAINER_SECURITY_READ_ONLY_ROOTFS` - Read-only root filesystem
- `CRONIUM_CONTAINER_SECURITY_SECCOMP_PROFILE` - Seccomp profile
- `CRONIUM_CONTAINER_VOLUMES_BASE_PATH` - Execution data path
- `CRONIUM_CONTAINER_VOLUMES_TEMP_PATH` - Temporary path
- `CRONIUM_CONTAINER_VOLUMES_RETENTION` - Data retention period
- `CRONIUM_CONTAINER_NETWORK_MODE` - Network mode
- `CRONIUM_CONTAINER_NETWORK_ENABLE_ICC` - Inter-container communication
- `CRONIUM_CONTAINER_NETWORK_DNS` - DNS servers
- `CRONIUM_CONTAINER_RUNTIME_IMAGE` - Runtime API image
- `CRONIUM_CONTAINER_RUNTIME_BACKEND_URL` - Backend URL for runtime
- `CRONIUM_CONTAINER_RUNTIME_VALKEY_URL` - Valkey/Redis URL
- `CRONIUM_CONTAINER_RUNTIME_JWT_SECRET` - JWT secret for runtime
- `CRONIUM_CONTAINER_RUNTIME_ISOLATE_NETWORK` - Network isolation

#### SSH Configuration

- `CRONIUM_SSH_CONNECTION_POOL_MAX_PER_SERVER` - Max connections per server
- `CRONIUM_SSH_CONNECTION_POOL_MIN_PER_SERVER` - Min connections per server
- `CRONIUM_SSH_CONNECTION_POOL_IDLE_TIMEOUT` - Idle timeout
- `CRONIUM_SSH_CONNECTION_POOL_HEALTH_CHECK_INTERVAL` - Health check interval
- `CRONIUM_SSH_CONNECTION_POOL_CONNECTION_TIMEOUT` - Connection timeout
- `CRONIUM_SSH_EXECUTION_DEFAULT_SHELL` - Default shell
- `CRONIUM_SSH_EXECUTION_TEMP_DIR` - Temporary directory
- `CRONIUM_SSH_EXECUTION_CLEANUP_AFTER` - Cleanup after execution
- `CRONIUM_SSH_EXECUTION_PTY_MODE` - PTY mode
- `CRONIUM_SSH_CIRCUIT_BREAKER_ENABLED` - Enable circuit breaker
- `CRONIUM_SSH_CIRCUIT_BREAKER_FAILURE_THRESHOLD` - Failure threshold
- `CRONIUM_SSH_CIRCUIT_BREAKER_SUCCESS_THRESHOLD` - Success threshold
- `CRONIUM_SSH_CIRCUIT_BREAKER_TIMEOUT` - Circuit breaker timeout
- `CRONIUM_SSH_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS` - Half-open requests
- `CRONIUM_SSH_SECURITY_STRICT_HOST_KEY_CHECKING` - Strict host key checking
- `CRONIUM_SSH_SECURITY_KNOWN_HOSTS_FILE` - Known hosts file
- `CRONIUM_SSH_SECURITY_ALLOWED_CIPHERS` - Allowed SSH ciphers
- `CRONIUM_SSH_SECURITY_ALLOWED_KEY_EXCHANGES` - Allowed key exchanges

#### Logging Configuration

- `CRONIUM_LOGGING_LEVEL` - Log level (debug/info/warn/error)
- `CRONIUM_LOGGING_FORMAT` - Log format (json/text)
- `CRONIUM_LOGGING_OUTPUT` - Log output (stdout/file)
- `CRONIUM_LOGGING_FILE_ENABLED` - Enable file logging
- `CRONIUM_LOGGING_FILE_PATH` - Log file path
- `CRONIUM_LOGGING_FILE_MAX_SIZE` - Max file size
- `CRONIUM_LOGGING_FILE_MAX_BACKUPS` - Max backup files
- `CRONIUM_LOGGING_FILE_MAX_AGE` - Max file age
- `CRONIUM_LOGGING_WEBSOCKET_ENABLED` - Enable WebSocket logging
- `CRONIUM_LOGGING_WEBSOCKET_BUFFER_SIZE` - Log buffer size
- `CRONIUM_LOGGING_WEBSOCKET_FLUSH_INTERVAL` - Flush interval
- `CRONIUM_LOGGING_WEBSOCKET_BATCH_SIZE` - Batch size
- `CRONIUM_LOGGING_WEBSOCKET_COMPRESSION` - Enable compression

#### Monitoring Configuration

- `CRONIUM_MONITORING_ENABLED` - Enable monitoring
- `CRONIUM_MONITORING_METRICS_PORT` - Metrics port
- `CRONIUM_MONITORING_HEALTH_PORT` - Health check port
- `CRONIUM_MONITORING_TRACING_ENABLED` - Enable tracing
- `CRONIUM_MONITORING_TRACING_PROVIDER` - Tracing provider
- `CRONIUM_MONITORING_TRACING_ENDPOINT` - Trace endpoint
- `CRONIUM_MONITORING_TRACING_SAMPLING_RATE` - Sampling rate
- `CRONIUM_MONITORING_PROFILING_ENABLED` - Enable profiling
- `CRONIUM_MONITORING_PROFILING_PORT` - Profiling port

#### Security Configuration

- `CRONIUM_SECURITY_TLS_ENABLED` - Enable TLS
- `CRONIUM_SECURITY_TLS_CERT_FILE` - Certificate file
- `CRONIUM_SECURITY_TLS_KEY_FILE` - Key file
- `CRONIUM_SECURITY_TLS_CA_FILE` - CA file
- `CRONIUM_SECURITY_AUTHENTICATION_TOKEN_ROTATION` - Token rotation
- `CRONIUM_SECURITY_AUTHENTICATION_TOKEN_TTL` - Token TTL
- `CRONIUM_SECURITY_ENCRYPTION_ALGORITHM` - Encryption algorithm
- `CRONIUM_SECURITY_ENCRYPTION_KEY_DERIVATION` - Key derivation

#### Feature Flags

- `CRONIUM_FEATURES_CONTAINER_POOLING` - Container pooling
- `CRONIUM_FEATURES_ADVANCED_SCHEDULING` - Advanced scheduling
- `CRONIUM_FEATURES_DISTRIBUTED_TRACING` - Distributed tracing
- `CRONIUM_FEATURES_EXPERIMENTAL_SSH` - Experimental SSH features

## Usage Examples

### Docker Compose

```yaml
environment:
  - CRONIUM_API_ENDPOINT=http://backend:5001/api/internal
  - CRONIUM_API_TOKEN=${SERVICE_TOKEN}
  - CRONIUM_JOBS_MAX_CONCURRENT=10
  - CRONIUM_LOGGING_LEVEL=debug
```

### Shell

```bash
export CRONIUM_API_ENDPOINT=http://localhost:5001/api/internal
export CRONIUM_API_TOKEN=your-service-token
export CRONIUM_JOBS_MAX_CONCURRENT=5
./cronium-agent
```

### Kubernetes ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orchestrator-config
data:
  CRONIUM_API_ENDPOINT: "http://cronium-backend:5001/api/internal"
  CRONIUM_JOBS_MAX_CONCURRENT: "10"
  CRONIUM_LOGGING_LEVEL: "info"
```

## Important Notes

1. **Required Variables**: Only `CRONIUM_API_ENDPOINT` and `CRONIUM_API_TOKEN` are required. All others have defaults.

2. **Variable Precedence**: Environment variables override configuration file values.

3. **Complex Types**:
   - Arrays (like tags, DNS servers) should be comma-separated
   - Durations use Go duration format (e.g., "30s", "5m", "1h")
   - Memory sizes can use units (e.g., "512MB", "2GB")

4. **Special Variables**: Some variables shown in the YAML config (like `${DOCKER_HOST}`, `${LOG_LEVEL}`) are direct environment variables, not CRONIUM\_ prefixed.

5. **Runtime API Variables**: The runtime API container uses different variables without the CRONIUM\_ prefix as it's a separate service.
