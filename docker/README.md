# Docker Configuration for Cronium

This directory contains Docker configuration files for containerizing Cronium's execution environment.

## Overview

The containerization setup includes:

- **Main Application Container**: Runs the Next.js app and WebSocket server
- **Executor Container**: Isolated environment for running user scripts

## Quick Start

### Production

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

### Development

```bash
# Use development overrides
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# Rebuild after changes
docker-compose build
```

## Architecture

### Main Application Container (cronium)

- Based on Debian 12 slim
- Runs Next.js on port 5001
- Runs WebSocket server on port 3001
- Non-root user execution
- Standalone Next.js build for optimized size

### Executor Container (cronium-executor)

- Based on Debian 12 slim
- Node.js 20 LTS and Python 3 installed
- Isolated execution environment
- Resource limits enforced
- Security hardened with:
  - Dropped capabilities
  - Read-only root filesystem
  - Seccomp profile
  - Non-root user

## Configuration

### Environment Variables

Copy `.env.docker.example` to `.env.docker` and configure:

- Database connection
- NextAuth settings
- Encryption keys
- Container settings

### Resource Limits

Default limits for executor container:

- CPU: 2 cores max, 0.5 cores reserved
- Memory: 2GB max, 512MB reserved
- Temp storage: 100MB

### Security

The executor container uses:

- Custom seccomp profile to limit system calls
- Dropped Linux capabilities
- Read-only filesystem with specific tmpfs mounts
- Network isolation within Docker network

## Customization

### Adding Languages/Tools

Edit `docker/executor/Dockerfile` to add more runtime environments or tools.

### Adjusting Resource Limits

Modify the `deploy` section in `docker-compose.yml` to change CPU/memory limits.

### Custom Security Profiles

Update `docker/executor/seccomp-profile.json` to modify allowed system calls.

## Troubleshooting

### Container Won't Start

- Check logs: `docker-compose logs executor`
- Verify all required files exist
- Ensure Docker has sufficient resources

### Permission Errors

- Verify file ownership in mounted volumes
- Check that the non-root user has necessary permissions

### Performance Issues

- Monitor resource usage: `docker stats`
- Adjust resource limits if needed
- Consider enabling container pooling for high-frequency events
