# Cronium Container Images

This directory contains the Docker container images for the Cronium runtime environment. These images provide secure, isolated execution environments for user scripts with the Cronium SDK pre-installed.

## Images

### Base Image (`cronium/base`)

- Minimal Alpine Linux base with security hardening
- Non-root user setup (cronium:1000)
- Tini for proper signal handling
- Foundation for other images

### Python Image (`cronium/python`)

- Python 3.12 runtime
- Pre-installed cronium SDK with requests and aiohttp
- Health check included
- Available variants:
  - `cronium/python:latest` - Standard image
  - `cronium/python:latest-slim` - Multi-stage build, smaller size

### Node.js Image (`cronium/nodejs`)

- Node.js 20 runtime
- Pre-installed cronium SDK with axios
- TypeScript definitions included
- Available variants:
  - `cronium/nodejs:latest` - Standard image
  - `cronium/nodejs:latest-slim` - Multi-stage build, package managers removed

### Bash Image (`cronium/bash`)

- Alpine Linux with Bash, curl, jq
- Cronium shell functions pre-loaded
- Suitable for shell scripts
- Available variants:
  - `cronium/bash:latest` - Standard image
  - `cronium/bash:latest-minimal` - Minimal image built from scratch

## Building Images

### Quick Build

```bash
# Build all images
./build-images.sh

# Build with custom prefix and tag
IMAGE_PREFIX=myorg/cronium TAG=v1.0.0 ./build-images.sh

# Build with multi-platform support
USE_BUILDX=true PLATFORMS=linux/amd64,linux/arm64 ./build-images.sh
```

### Individual Builds

```bash
# Build specific image
docker build -t cronium/python:latest ./python

# Build slim variant
docker build -f ./python/Dockerfile.multistage -t cronium/python:slim ./python
```

## Testing Images

### Automated Tests

```bash
# Run all tests
./test-images.sh

# Build and test
BUILD_IMAGES=true ./test-images.sh

# Test with custom prefix
IMAGE_PREFIX=myorg/cronium ./test-images.sh
```

### Manual Testing

```bash
# Test Python image
docker run --rm cronium/python:latest python3 -c "import cronium; print('SDK loaded')"

# Test Node.js image
docker run --rm cronium/nodejs:latest node -e "require('cronium'); console.log('SDK loaded')"

# Test Bash image
docker run --rm cronium/bash:latest bash -c "source /usr/local/bin/cronium.sh && cronium_info"
```

### Integration Testing

```bash
# Start test environment with mock API
docker-compose -f docker-compose.test.yml up

# Run individual service
docker-compose -f docker-compose.test.yml run python-test
```

## Security Features

All images include:

- **Non-root user**: Runs as `cronium` (UID 1000)
- **No package managers**: Removed in production variants
- **Minimal packages**: Only essential binaries included
- **Read-only filesystem**: Supports read-only root with tmpfs
- **Security profiles**: Compatible with seccomp and AppArmor
- **Health checks**: Built-in health check scripts

### Running with Security Options

```bash
# Run with read-only filesystem
docker run --read-only --tmpfs /tmp --tmpfs /app \
  cronium/python:latest python3 script.py

# Run with seccomp profile
docker run --security-opt seccomp=./security/seccomp-default.json \
  cronium/python:latest python3 script.py

# Run with all security options
docker run \
  --read-only \
  --tmpfs /tmp \
  --tmpfs /app \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --security-opt seccomp=./security/seccomp-strict.json \
  --user 1000:1000 \
  cronium/python:latest python3 script.py
```

## Environment Variables

Required for runtime:

- `CRONIUM_RUNTIME_API`: URL of the Runtime API service
- `CRONIUM_EXECUTION_TOKEN`: JWT token for authentication
- `CRONIUM_EXECUTION_ID`: Unique execution identifier

Optional:

- `TZ`: Timezone (default: UTC)
- `LANG`: Locale (default: C.UTF-8)

## Usage in Orchestrator

These images are designed to be used by the Cronium Orchestrator:

```go
// Example container configuration
container := &container.Config{
    Image: "cronium/python:latest",
    Env: []string{
        fmt.Sprintf("CRONIUM_RUNTIME_API=%s", runtimeAPI),
        fmt.Sprintf("CRONIUM_EXECUTION_TOKEN=%s", token),
        fmt.Sprintf("CRONIUM_EXECUTION_ID=%s", executionID),
    },
    User: "1000:1000",
    WorkingDir: "/app",
}

// Host configuration with security options
host := &container.HostConfig{
    ReadonlyRootfs: true,
    CapDrop: []string{"ALL"},
    SecurityOpt: []string{
        "no-new-privileges:true",
        "seccomp=./security/seccomp-default.json",
    },
    Resources: container.Resources{
        Memory: 512 * 1024 * 1024, // 512MB
        CpuQuota: 100000,          // 1 CPU
    },
    Tmpfs: map[string]string{
        "/tmp": "size=100M",
        "/app": "size=50M",
    },
}
```

## Maintenance

### Updating SDKs

1. Update the SDK files in `../runtime-helpers/`
2. Copy updated files to respective image directories
3. Rebuild images
4. Run tests to verify functionality

### Security Updates

```bash
# Check for updates
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image cronium/python:latest

# Rebuild with latest base images
docker build --pull -t cronium/python:latest ./python
```

### Version Management

- Use semantic versioning for tags
- Keep `latest` pointing to stable version
- Tag security updates immediately
- Document breaking changes

## Troubleshooting

### Image Build Failures

- Ensure Docker daemon is running
- Check available disk space
- Verify network connectivity for package downloads
- Review Dockerfile syntax

### Runtime Issues

- Verify environment variables are set
- Check Runtime API connectivity
- Review container logs: `docker logs <container>`
- Test with minimal security options first

### Performance

- Use slim variants for smaller image size
- Enable BuildKit for faster builds: `DOCKER_BUILDKIT=1`
- Consider multi-stage builds for optimization
- Monitor resource usage during execution
